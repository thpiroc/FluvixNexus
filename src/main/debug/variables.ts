import {
  isDebugVariableHandleShape,
  DEBUG_VARIABLE_HANDLES_MAX_PER_STOP,
  DEBUG_VARIABLES_MAX_PER_RESPONSE,
  type DebugScope,
  type DebugScopesResult,
  type DebugVariable,
  type DebugVariableHandle,
  type DebugVariablesResult,
  type DebugVariablesUnavailableReason
} from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import {
  getDebugCallStackFrameHandle,
  onDebugCallStackChange,
  type DebugCallStackFrameHandle
} from './callStack'
import type { DapRequestOutcome } from './dapConnection'
import {
  createScopesArguments,
  createVariablesArguments,
  parseScopesResponse,
  parseVariablesResponse
} from './dapVariables'
import {
  getDebugSessionGeneration,
  getDebugSessionState,
  getDebugSessionStopGeneration,
  getDebugSessionVariablesChannel,
  onDebugSessionStateChange,
  onDebugSessionStopped,
  type DebugSessionState,
  type DebugSessionStoppedListener,
  type DebugSessionVariablesChannel
} from './debugSessionManager'

/**
 * Main が控える handle 1件。
 *
 * **`reference`（DAP の `variablesReference`）はこの表の外へ出ない。** Renderer が
 * 持つのは表の key（`DebugVariableHandle`）だけで、それを返されたとき Main は
 * 下の欄をすべて現在値と照らしてから DAP の request へ戻す。
 */
interface VariableHandleEntry {
  readonly reference: number
  readonly origin: 'scope' | 'variable' | 'evaluate'
  readonly workspaceId: string
  readonly sessionGeneration: number
  readonly stopGeneration: number
  /** 表を捨てた回数。捨てる前に発行したものは、同じ停止の中でも通さない。 */
  readonly epoch: number
}

/**
 * evaluate（Session 6-7）が handle を載せるときに添える、送った時点の素性。
 *
 * `epoch` は **request を送る前に** `currentEpoch()` で控えたもの。表が捨てられた後に
 * 返ってきた応答は、ここが今の値と食い違うので handle を貰えない。
 */
export interface DebugVariableHandleScope {
  readonly workspaceId: string
  readonly sessionGeneration: number
  readonly stopGeneration: number
  readonly epoch: number
}

export interface DebugVariablesStore {
  readonly listScopes: (rawFrameId: unknown) => Promise<DebugScopesResult>
  readonly listVariables: (rawHandle: unknown) => Promise<DebugVariablesResult>
  /**
   * 今の epoch（Session 6-7）。
   *
   * evaluate は自分の request を送る前にこれを控え、応答が返った時点で
   * `registerEvaluateResult` に渡す ── 表が捨てられていれば handle は発行されない。
   */
  readonly currentEpoch: () => number
  /**
   * evaluate の結果を**同じ表**へ載せる（Session 6-7）。
   *
   * 別の表を持たせない理由は、持たせた瞬間に「どちらの表の handle か」を
   * `listVariables` が見分ける必要が生まれ、捨てる契機も二重になるため。
   * evaluate の結果から辿った子は、Scope から辿った子とまったく同じ経路
   * （`listVariables`）に乗る。
   *
   * 素性が今と食い違う（epoch / Workspace / 世代 / 停止）か、表が一杯なら null。
   * null は「展開できない値」として扱う ── evaluate 自体は成功のまま返す。
   */
  readonly registerEvaluateResult: (
    scope: DebugVariableHandleScope,
    reference: number
  ) => DebugVariableHandle | null
  readonly start: (
    onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
  ) => void
  /** テストが表の大きさを見るためのもの。 */
  readonly handleCount: () => number
}

export interface DebugVariablesStoreDependencies {
  readonly getWorkspace: () => WorkspaceFolder | null
  readonly getDebugState: () => DebugSessionState
  readonly getDebugGeneration: () => number
  readonly getDebugStopGeneration: () => number
  /** Session 6-5 の frame 検証（現在の snapshot・stopped・世代・Workspace）。 */
  readonly getFrameHandle: (rawFrameId: unknown) => DebugCallStackFrameHandle | null
  readonly getChannel: () => DebugSessionVariablesChannel | null
  readonly onDebugStateChange: (listener: (state: DebugSessionState) => void) => () => void
  readonly onDebugStopped: (listener: DebugSessionStoppedListener) => () => void
  readonly onCallStackChange: (listener: () => void) => () => void
  readonly log?: (level: 'warn' | 'debug', message: string) => void
  /** 以下2つはテストが小さくするためのもの。既定は shared/debug/variables.ts の定数。 */
  readonly maxHandles?: number
  readonly maxPerResponse?: number
}

/**
 * Variables / Scopes の Main 側（Session 6-6）。
 *
 * ```
 * Renderer                     Main（ここ）                          adapter
 * debug:list-scopes {frameId}
 *   ──────────────────────────▶ frame を 6-5 の経路で確かめる
 *                               scopes {frameId} ───────────────────▶
 *                               ◀─────────────────────────────────── scopes[]
 *                               variablesReference → handle を発行
 *   ◀────────────────────────── DebugScope[]（handle だけ）
 * debug:list-variables {handle}
 *   ──────────────────────────▶ 表を引き、世代 / Workspace / epoch を確かめる
 *                               variables {variablesReference} ─────▶
 *                               ◀─────────────────────────────────── variables[]
 *   ◀────────────────────────── DebugVariable[]（子の handle を新しく発行）
 * ```
 *
 * ## 表を捨てるとき
 *
 * `variablesReference` は **stopped の間だけ有効**（DAP の仕様）。次のどれかが
 * 起きたら表を捨て、epoch を進める ── 途中で返ってきた応答は、epoch が違うので
 * handle を発行せずに `stale` にする。
 *
 * - stopped 以外への状態変化（Continue / Step / running / terminating / idle
 *   ── adapter の異常・終了・アプリの片付け・セッションの入れ替えはどれもここを通る）
 * - 新しい `stopped` event（stopped のまま次の停止が来ることがある）
 * - Call Stack snapshot の差し替え
 * - Workspace の切り替え
 */
export function createDebugVariablesStore(
  dependencies: DebugVariablesStoreDependencies
): DebugVariablesStore {
  const maxHandles = dependencies.maxHandles ?? DEBUG_VARIABLE_HANDLES_MAX_PER_STOP
  const maxPerResponse = dependencies.maxPerResponse ?? DEBUG_VARIABLES_MAX_PER_RESPONSE
  let workspace: WorkspaceFolder | null = null
  let epoch = 0
  /** handle の通し番号。表を捨てても戻さない ── 古い handle が新しいものと重ならない。 */
  let nextHandle = 0
  let handles = new Map<DebugVariableHandle, VariableHandleEntry>()

  async function listScopes(rawFrameId: unknown): Promise<DebugScopesResult> {
    ensureWorkspace()

    const current = workspace

    if (current === null || dependencies.getDebugState() !== 'stopped') {
      return unavailable('not-stopped')
    }

    const frame = dependencies.getFrameHandle(rawFrameId)
    const channel = dependencies.getChannel()

    if (
      frame === null ||
      frame.workspaceId !== current.id ||
      channel === null ||
      channel.generation !== frame.sessionGeneration ||
      channel.stopGeneration !== frame.stopGeneration
    ) {
      return unavailable('stale')
    }

    const requestedEpoch = epoch
    const outcome = await channel.requestScopes(createScopesArguments(frame.frameId))
    const scope = { workspaceId: current.id, channel, epoch: requestedEpoch }

    if (!isCurrent(scope)) {
      return unavailable('stale')
    }

    const failure = describeFailure('scopes', outcome)

    if (failure !== null) {
      return unavailable(failure)
    }

    const parsed = parseScopesResponse(successBody(outcome), maxPerResponse)

    if (parsed === null) {
      log('warn', 'ignored a malformed scopes response.')
      return unavailable('failed')
    }

    const scopes: DebugScope[] = parsed.entries.map((entry) => ({
      handle: issueHandle(scope, entry.reference, 'scope'),
      ...entry.scope
    }))

    return { status: 'ok', scopes }
  }

  async function listVariables(rawHandle: unknown): Promise<DebugVariablesResult> {
    ensureWorkspace()

    const current = workspace

    if (current === null || dependencies.getDebugState() !== 'stopped') {
      return unavailable('not-stopped')
    }

    const entry = isDebugVariableHandleShape(rawHandle) ? handles.get(rawHandle) : undefined
    const channel = dependencies.getChannel()

    if (
      entry === undefined ||
      channel === null ||
      entry.epoch !== epoch ||
      entry.workspaceId !== current.id ||
      entry.sessionGeneration !== dependencies.getDebugGeneration() ||
      entry.stopGeneration !== dependencies.getDebugStopGeneration() ||
      channel.generation !== entry.sessionGeneration ||
      channel.stopGeneration !== entry.stopGeneration
    ) {
      return unavailable('stale')
    }

    /*
      表が一杯なら adapter へ送らずに断る。子に1つでも中身があれば handle が要り、
      一杯のまま読むと「開けそうに見えて開けない」行ばかりになる。
    */
    if (handles.size >= maxHandles) {
      log('warn', `the variable handle limit (${String(maxHandles)}) was reached for this stop.`)
      return unavailable('limit')
    }

    const requestedEpoch = epoch
    const outcome = await channel.requestVariables(
      createVariablesArguments(entry.reference, channel.supportsVariablePaging, maxPerResponse)
    )
    const scope = { workspaceId: current.id, channel, epoch: requestedEpoch }

    if (!isCurrent(scope)) {
      return unavailable('stale')
    }

    const failure = describeFailure('variables', outcome)

    if (failure !== null) {
      return unavailable(failure)
    }

    const parsed = parseVariablesResponse(successBody(outcome), maxPerResponse)

    if (parsed === null) {
      log('warn', 'ignored a malformed variables response.')
      return unavailable('failed')
    }

    let handleLimitHit = false
    const variables: DebugVariable[] = parsed.entries.map((child) => {
      const handle = issueHandle(scope, child.reference, 'variable')

      if (child.reference > 0 && handle === null) {
        handleLimitHit = true
      }

      return { handle, ...child.variable }
    })

    if (handleLimitHit) {
      log('warn', `the variable handle limit (${String(maxHandles)}) was reached for this stop.`)
    }

    return { status: 'ok', variables, truncated: parsed.truncated || handleLimitHit }
  }

  /**
   * evaluate（Session 6-7）から呼ばれる。`issueHandle` と同じ表・同じ通し番号を使う。
   *
   * 呼ぶ側は自分の前提（stopped・frame・Workspace）を既に確かめているが、
   * **ここでももう一度確かめる** ── 表に載せてよいかを決めるのは表の持ち主で、
   * 呼び出し側の確認を信じる形にすると、次に呼ぶ人が同じ確認を書き落とせてしまう。
   */
  function registerEvaluateResult(
    scope: DebugVariableHandleScope,
    reference: number
  ): DebugVariableHandle | null {
    ensureWorkspace()

    const current = workspace

    if (
      current === null ||
      scope.epoch !== epoch ||
      scope.workspaceId !== current.id ||
      dependencies.getDebugState() !== 'stopped' ||
      dependencies.getDebugGeneration() !== scope.sessionGeneration ||
      dependencies.getDebugStopGeneration() !== scope.stopGeneration
    ) {
      return null
    }

    return issueHandle(
      {
        workspaceId: scope.workspaceId,
        channel: {
          generation: scope.sessionGeneration,
          stopGeneration: scope.stopGeneration
        },
        epoch: scope.epoch
      },
      reference,
      'evaluate'
    )
  }

  interface RequestScope {
    readonly workspaceId: string
    readonly channel: {
      readonly generation: number
      readonly stopGeneration: number
    }
    readonly epoch: number
  }

  function isCurrent(scope: RequestScope): boolean {
    return (
      scope.epoch === epoch &&
      workspace?.id === scope.workspaceId &&
      dependencies.getWorkspace()?.id === scope.workspaceId &&
      dependencies.getDebugState() === 'stopped' &&
      dependencies.getDebugGeneration() === scope.channel.generation &&
      dependencies.getDebugStopGeneration() === scope.channel.stopGeneration
    )
  }

  /** 中身のある（`reference > 0`）ものにだけ発行する。表が一杯なら null（葉として見せる）。 */
  function issueHandle(
    scope: RequestScope,
    reference: number,
    origin: VariableHandleEntry['origin']
  ): DebugVariableHandle | null {
    if (reference <= 0 || handles.size >= maxHandles) {
      return null
    }

    nextHandle += 1
    const handle = `dv-${String(nextHandle)}`

    handles.set(handle, {
      reference,
      origin,
      workspaceId: scope.workspaceId,
      sessionGeneration: scope.channel.generation,
      stopGeneration: scope.channel.stopGeneration,
      epoch: scope.epoch
    })

    return handle
  }

  function invalidate(): void {
    epoch += 1

    if (handles.size > 0) {
      handles = new Map()
    }
  }

  function ensureWorkspace(): void {
    const current = dependencies.getWorkspace()

    if (current?.id === workspace?.id) {
      return
    }

    workspace = current
    invalidate()
  }

  function start(
    onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
  ): void {
    onWorkspaceChange((next) => {
      workspace = next
      invalidate()
    })

    dependencies.onDebugStateChange((state) => {
      if (state !== 'stopped') {
        invalidate()
      }
    })

    dependencies.onDebugStopped(() => {
      invalidate()
    })

    dependencies.onCallStackChange(() => {
      invalidate()
    })
  }

  function describeFailure(
    command: 'scopes' | 'variables',
    outcome: DapRequestOutcome
  ): DebugVariablesUnavailableReason | null {
    switch (outcome.status) {
      case 'success':
        return null

      case 'failure':
        /* adapter の文言は絶対パスを含みうる。Main のログにだけ残し、Renderer へは分類だけ返す。 */
        log(
          'warn',
          `${command} request failed: ${outcome.message ?? 'adapter rejected the request.'}`
        )
        return 'failed'

      case 'closed':
        return 'stale'
    }
  }

  function log(level: 'warn' | 'debug', message: string): void {
    dependencies.log?.(level, message)
  }

  /**
   * 今の epoch（Session 6-7）。
   *
   * **`ensureWorkspace()` を先に通す。** Workspace の取り込みは要求のたびに遅れて
   * 行われる（`start` の購読は「変わったとき」しか来ない）ため、通さずに返すと
   * 「epoch を控える → 最初の要求で表が捨てられる → 控えた epoch が古くなる」に
   * なり、evaluate の結果が必ず handle を貰えなくなる。
   */
  function currentEpoch(): number {
    ensureWorkspace()

    return epoch
  }

  return {
    listScopes,
    listVariables,
    currentEpoch,
    registerEvaluateResult,
    start,
    handleCount: () => handles.size
  }
}

function successBody(outcome: DapRequestOutcome): unknown {
  return outcome.status === 'success' ? outcome.body : undefined
}

function unavailable(reason: DebugVariablesUnavailableReason): {
  readonly status: 'unavailable'
  readonly reason: DebugVariablesUnavailableReason
} {
  return { status: 'unavailable', reason }
}

const log = createLogger('debug-variables')

const defaultStore = createDebugVariablesStore({
  getWorkspace: getCurrentWorkspaceFolder,
  getDebugState: getDebugSessionState,
  getDebugGeneration: getDebugSessionGeneration,
  getDebugStopGeneration: getDebugSessionStopGeneration,
  getFrameHandle: getDebugCallStackFrameHandle,
  getChannel: getDebugSessionVariablesChannel,
  onDebugStateChange: onDebugSessionStateChange,
  onDebugStopped: onDebugSessionStopped,
  onCallStackChange: onDebugCallStackChange,
  log: (level, message) => {
    if (level === 'warn') {
      log.warn(message)
    } else {
      log.debug(message)
    }
  }
})

export function listDebugScopes(rawFrameId: unknown): Promise<DebugScopesResult> {
  return defaultStore.listScopes(rawFrameId)
}

export function listDebugVariables(rawHandle: unknown): Promise<DebugVariablesResult> {
  return defaultStore.listVariables(rawHandle)
}

/** 今の handle 表の epoch（Session 6-7。evaluate が request の前に控える）。 */
export function getDebugVariableHandleEpoch(): number {
  return defaultStore.currentEpoch()
}

/** evaluate の結果を同じ handle 表へ載せる（Session 6-7）。 */
export function registerDebugEvaluateHandle(
  scope: DebugVariableHandleScope,
  reference: number
): DebugVariableHandle | null {
  return defaultStore.registerEvaluateResult(scope, reference)
}

/** Call Stack（Session 6-5）より後に張る。lifecycle.ts から1度だけ呼ぶ。 */
export function startDebugVariablesHosting(
  onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
): void {
  defaultStore.start(onWorkspaceChange)
}
