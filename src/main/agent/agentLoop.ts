import {
  AGENT_INITIAL_LOOP_LIMIT,
  AGENT_LOOP_EXTENSION,
  AGENT_TASK_PROMPT_MAX_LENGTH,
  isAgentTaskActive,
  type AgentTaskContinueDecision,
  type AgentTaskEndReason,
  type AgentTaskPhase,
  type AgentTaskStartResult,
  type AgentTaskState,
  type AgentTaskStatus
} from '@shared/agent'
import { isAgentPermissionMode, type AgentPermissionMode } from '@shared/security'
import type { AuditEvent } from '../security/audit/auditEvent'
import type { RawExternalSendRequest } from '../security/externalSend/externalSendContext'
import type { ExternalSendOutcome } from '../security/externalSend/externalSendGate'
import {
  isSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import { redactSecretText } from '../security/secret/secretMasking'
import {
  AGENT_ANSWER_MAX_LENGTH,
  parseAgentTurn,
  type AgentAction,
  type AgentActionType
} from './agentAction'
import { agentActionKey } from './agentActionKey'
import { agentActionRejectedEvent, agentStoppedEvent } from './agentAudit'
import { createAgentContext, type AgentContext } from './agentContext'
import type { AgentProvider } from './agentProvider'
import { retryClassOf, runAgentTool, type AgentToolbox } from './agentTools'

/**
 * FN Agent の Agent Loop（Security Core v1 の STEP9。Electron に依存しない ── Main 側の
 * 道具はすべて引数で受け取る）。
 *
 * ```
 * 利用者の指示
 *   ↓
 * ┌─ Context を組み立てる（Budget の中へ畳む。agentContext.ts）
 * │   ↓ External Send Gate（STEP5）     検査して伏せた Safe Payload だけが Provider へ
 * │   ↓ Provider（STEP9 は Scripted）   1回 = 1 Loop
 * │   ↓ Runtime Schema Validation       Action 1つ（agentAction.ts）
 * │   ↓ 拒否済みの Action か            同じ Action は二度と実行しない
 * │   ↓ Security Core                   Read Tool Gate / File Write Gate / Terminal Runner
 * │   ↓ 結果を Context へ（伏せた後のもの）
 * └─ 次のターンへ（complete / 停止 / 上限 / 失敗で終わる）
 * ```
 *
 * ## 決めてあること（2026-09-23 確定）
 *
 * - **AI に Security Core を通すかどうかを選ばせない。** Action は閉じた集合で、どれも
 *   Security Core の入口にしかつながっていない（agentTools.ts）
 * - **1ターン1 Action。** 並列の Tool Call は `parallel-action` で拒む
 * - **Loop = Provider を1回呼ぶこと。** 初期 20 回。上限に達したら自動で続けず、利用者に
 *   「続けるか」を尋ねる。続けるなら +10。無制限の自動継続は無い
 * - **再試行は原則 最大2回。** 利用者の拒否・Security Core の deny・Boundary / Secret の違反を
 *   受けた Action は、同じものをもう一度実行しない（`repeated-action`）。ファイルの競合は
 *   読み直しを促す。壊れた出力が3回続いたら止める
 * - **副作用のある操作は同時に1件だけ。** Loop は1つずつ順に進めるうえ、強制は Security Core の
 *   共有ロック（sideEffect/）が行う。`complete` は承認待ち・実行中が残っていれば受け付けない
 * - **停止したら新しい Action を始めない。** 承認待ちは取り消す。実行中の Terminal は
 *   kill せず、終わる（または 120 秒で打ち切られる）のを待ってから `stopped` にする
 *   （STEP8 / STEP9 の決定。古い Scope Decision の「Tool へ中断 Signal を伝播」より優先）。
 *   作業の signal は File Write / Terminal の Gate と Approval Manager まで渡し、**止めた後に
 *   新しい承認・新しい副作用を始めない**ためだけに使う（2026-09-24。起動済みのプロセスは見ない）
 * - **状態はメモリだけ。** 再起動・クラッシュの後に途中の作業を復元しない。承認も復元しない
 */

/** 同じ原因での再試行の上限。 */
export const AGENT_MAX_RETRIES = 2

/** パネルに出す対象の1行の上限。 */
export const AGENT_SUBJECT_MAX_LENGTH = 200

/** Main 側の道具。 */
export interface AgentLoopDependencies {
  /** その作業で使う Provider を作る（使えなければ `null`）。 */
  readonly createProvider: () => AgentProvider | null
  /** Provider を使えるか（パネルの表示用。作らずに答える）。 */
  readonly isProviderAvailable: () => boolean
  /** Agent 全体の ON / OFF（Main が設定から毎回読み直す）。 */
  readonly isAgentEnabled: () => boolean
  /** Workspace が開いているか。 */
  readonly hasWorkspace: () => boolean
  /** 今効いている Permission（AI への指示文に書くため。判定は Gate が行う）。 */
  readonly readPermissionMode: () => AgentPermissionMode
  /** External Send Gate（STEP5）を通して Provider へ渡す。 */
  readonly sendToProvider: <T>(
    request: RawExternalSendRequest,
    deliver: (payload: SafeExternalPayload) => Promise<T>
  ) => Promise<ExternalSendOutcome<T>>
  /** Security Core の入口。 */
  readonly toolbox: AgentToolbox
  /** 副作用のある操作が承認待ち・実行中か（共有ロック）。 */
  readonly isSideEffectInProgress: () => boolean
  /** 残っている承認をすべて取り消す（停止のとき）。 */
  readonly cancelPendingApprovals: () => number
  /** Audit Event を1件記録する。成否は返さない。 */
  readonly recordEvent: (event: AuditEvent) => void
  /** Renderer へ状態を知らせる。 */
  readonly emitState: (state: AgentTaskState) => void
}

export interface AgentLoop {
  /** 作業を始める（すぐに返る。作業は裏で進む）。 */
  readonly start: (prompt: unknown) => AgentTaskStartResult
  /** 利用者の停止。 */
  readonly stop: () => void
  /** Loop の上限での利用者の返事。 */
  readonly continueTask: (decision: unknown) => void
  /** 利用者以外の理由で止める（Workspace の切り替え）。 */
  readonly halt: (reason: Extract<AgentTaskEndReason, 'workspace-changed'>) => void
  readonly getState: () => AgentTaskState
  /** 今の作業が終わるまで待つ（テスト・終了処理用）。 */
  readonly whenIdle: () => Promise<void>
}

interface Task {
  readonly provider: AgentProvider
  readonly context: AgentContext
  readonly abort: AbortController
  status: AgentTaskStatus
  phase: AgentTaskPhase | null
  subject: string | null
  loopsUsed: number
  loopLimit: number
  finalAnswer: string | null
  endReason: AgentTaskEndReason | null
  /** 止める理由（止めることが決まったら入る）。 */
  stopReason: AgentTaskEndReason | null
  continueWaiter: ((decision: AgentTaskContinueDecision) => void) | null
  /** もう実行しない Action の鍵。 */
  readonly blocked: Set<string>
  /** Action ごとの失敗の回数。 */
  readonly failures: Map<string, number>
  /** 壊れた出力・拒否済みの再提案が続いた回数。 */
  rejectedStreak: number
  /** Provider の呼び出しが続けて失敗した回数。 */
  providerFailures: number
}

export function createAgentLoop(deps: AgentLoopDependencies): AgentLoop {
  let task: Task | null = null
  let running: Promise<void> = Promise.resolve()

  function state(): AgentTaskState {
    return Object.freeze({
      status: task?.status ?? 'idle',
      phase: task?.phase ?? null,
      subject: task?.subject ?? null,
      loopsUsed: task?.loopsUsed ?? 0,
      loopLimit: task?.loopLimit ?? AGENT_INITIAL_LOOP_LIMIT,
      finalAnswer: task?.finalAnswer ?? null,
      endReason: task?.endReason ?? null,
      agentEnabled: safely(deps.isAgentEnabled, false),
      providerAvailable: safely(deps.isProviderAvailable, false)
    })
  }

  function emit(): void {
    try {
      deps.emitState(state())
    } catch {
      // 知らせられなかった。作業の進み方は変えない。
    }
  }

  function record(event: AuditEvent): void {
    try {
      deps.recordEvent(event)
    } catch {
      // 記録できなかったことで結論は変わらない。
    }
  }

  function permissionMode(): AgentPermissionMode {
    const mode = safely(deps.readPermissionMode, 'read' as AgentPermissionMode)

    return isAgentPermissionMode(mode) ? mode : 'read'
  }

  function start(prompt: unknown): AgentTaskStartResult {
    if (
      typeof prompt !== 'string' ||
      prompt.trim().length === 0 ||
      prompt.length > AGENT_TASK_PROMPT_MAX_LENGTH
    ) {
      return rejected('invalid-prompt')
    }

    if (task !== null && isAgentTaskActive(task.status)) {
      return rejected('busy')
    }

    if (!safely(deps.isAgentEnabled, false)) {
      return rejected('agent-disabled')
    }

    if (!safely(deps.hasWorkspace, false)) {
      return rejected('no-workspace')
    }

    const provider = safely(deps.createProvider, null)

    if (provider === null) {
      return rejected('provider-unavailable')
    }

    const current: Task = {
      provider,
      context: createAgentContext(prompt, provider.contextWindowTokens),
      abort: new AbortController(),
      status: 'running',
      phase: 'thinking',
      subject: null,
      loopsUsed: 0,
      loopLimit: AGENT_INITIAL_LOOP_LIMIT,
      finalAnswer: null,
      endReason: null,
      stopReason: null,
      continueWaiter: null,
      blocked: new Set(),
      failures: new Map(),
      rejectedStreak: 0,
      providerFailures: 0
    }

    task = current
    emit()
    running = run(current)

    return Object.freeze({ started: true as const })
  }

  /** 止めることを決める。新しい Action は始めず、承認待ちは取り消す。 */
  function requestStop(reason: AgentTaskEndReason): void {
    const current = task

    if (current === null || !isAgentTaskActive(current.status) || current.stopReason !== null) {
      return
    }

    current.stopReason = reason
    current.status = 'stopping'
    current.abort.abort()

    try {
      deps.cancelPendingApprovals()
    } catch {
      // 取り消せなかった承認も、期限（5 分）で失効する。Loop はもう次へ進まない。
    }

    current.continueWaiter?.('stop')
    emit()
  }

  function stop(): void {
    const current = task

    if (current === null || !isAgentTaskActive(current.status) || current.stopReason !== null) {
      return
    }

    record(agentStoppedEvent(permissionMode()))
    requestStop('user-stopped')
  }

  function continueTask(decision: unknown): void {
    const waiter = task?.status === 'awaiting-continue' ? task.continueWaiter : null

    if (waiter === null || waiter === undefined) {
      return
    }

    waiter(decision === 'continue' ? 'continue' : 'stop')
  }

  async function run(current: Task): Promise<void> {
    try {
      await loop(current)
    } catch {
      finish(current, 'failed', 'internal-error')
    }
  }

  async function loop(current: Task): Promise<void> {
    for (;;) {
      if (current.stopReason !== null) {
        return finish(current, 'stopped', current.stopReason)
      }

      if (!safely(deps.isAgentEnabled, false)) {
        return finish(current, 'stopped', 'agent-disabled')
      }

      // Loop の上限。自動では続けない。
      if (current.loopsUsed >= current.loopLimit) {
        const decision = await askToContinue(current)

        if (current.stopReason !== null) {
          return finish(current, 'stopped', current.stopReason)
        }

        if (decision !== 'continue') {
          return finish(current, 'stopped', 'loop-limit-declined')
        }

        current.loopLimit += AGENT_LOOP_EXTENSION
        update(current, { status: 'running' })
        continue
      }

      update(current, { phase: 'thinking', subject: null })

      const output = await askProvider(current)

      if (current.stopReason !== null) {
        return finish(current, 'stopped', current.stopReason)
      }

      if (output.kind === 'end') {
        return finish(current, 'failed', output.reason)
      }

      if (output.kind === 'retry') {
        continue
      }

      const parsed = parseAgentTurn(output.value)

      if (!parsed.ok) {
        reject(current, parsed.reason, parsed.actionType, parsed.problem)

        if (current.rejectedStreak > AGENT_MAX_RETRIES) {
          return finish(current, 'failed', 'too-many-invalid-actions')
        }

        continue
      }

      const action = parsed.action

      if (action.type === 'complete') {
        /*
          FN 側でも、承認待ち・実行中の副作用が残っていないことを確かめてから終える。
          Loop は1つずつ進めるため通常は残らないが、共有ロックで確かめる（分からなければ残っている側）。
        */
        if (safely(deps.isSideEffectInProgress, true)) {
          current.context.add(current.loopsUsed, {
            category: 'error',
            label: 'complete',
            header: 'action: complete\nstatus: rejected\nreason: side-effect-in-progress',
            detail: 'problem: A file write or command is still waiting for approval or running.'
          })
          continue
        }

        return finish(current, 'completed', 'completed', action.answer)
      }

      const key = agentActionKey(action)

      if (current.blocked.has(key)) {
        reject(
          current,
          'repeated-action',
          action.type,
          'This exact action was already declined or denied. Do not propose it again.'
        )

        if (current.rejectedStreak > AGENT_MAX_RETRIES) {
          return finish(current, 'failed', 'too-many-invalid-actions')
        }

        continue
      }

      current.rejectedStreak = 0

      // 実行の直前にもう一度。停止・OFF の後は新しい Action を始めない。
      if (current.stopReason !== null) {
        return finish(current, 'stopped', current.stopReason)
      }

      if (!safely(deps.isAgentEnabled, false)) {
        return finish(current, 'stopped', 'agent-disabled')
      }

      await execute(current, action, key)
    }
  }

  /** Provider を1回呼ぶ（External Send Gate を通して）。 */
  async function askProvider(
    current: Task
  ): Promise<
    | { readonly kind: 'value'; readonly value: unknown }
    | { readonly kind: 'retry' }
    | { readonly kind: 'end'; readonly reason: AgentTaskEndReason }
  > {
    const built = current.context.build({
      providerId: current.provider.id,
      permissionMode: permissionMode(),
      loopsUsed: current.loopsUsed,
      loopLimit: current.loopLimit
    })

    if (!built.ok) {
      return { kind: 'end', reason: 'context-budget-exceeded' }
    }

    current.loopsUsed += 1
    emit()

    try {
      const sent = await deps.sendToProvider(built.request, async (payload) => {
        // Gate が発行した Payload 以外を Provider へ渡さない（型だけに頼らない）。
        if (!isSafeExternalPayload(payload)) {
          throw new Error('the payload was not issued by the External Send Gate')
        }

        return await current.provider.next(payload, current.abort.signal)
      })

      if (sent.decision === 'deny') {
        // 送れない Context（Secret ファイル・検査できない）。同じ Context を送り直しても通らない。
        return { kind: 'end', reason: 'context-denied' }
      }

      current.providerFailures = 0

      return { kind: 'value', value: sent.delivered }
    } catch {
      if (current.stopReason !== null) {
        return { kind: 'retry' }
      }

      current.providerFailures += 1

      return current.providerFailures > AGENT_MAX_RETRIES
        ? { kind: 'end', reason: 'provider-failed' }
        : { kind: 'retry' }
    }
  }

  /** Action を Security Core へ渡し、結果を Context へ入れる。 */
  async function execute(
    current: Task,
    action: Exclude<AgentAction, { readonly type: 'complete' }>,
    key: string
  ): Promise<void> {
    update(current, { phase: phaseOf(action), subject: subjectOf(action) })

    /*
      作業の signal を Gate まで渡す。止める（stop / halt）と abort され、Gate はその後に
      新しい承認を作らず・副作用を始めない。止めた時点で承認がまだ作られていなくても
      （Gate がロックを取った後・承認を求める前の I/O の途中でも）止まる。
    */
    const result = await runAgentTool(deps.toolbox, action, current.abort.signal)

    current.context.add(current.loopsUsed, result.context)

    if (result.status === 'ok') {
      current.failures.delete(key)

      if (result.context.key !== undefined) {
        current.context.resolve(result.context.key)
      }

      return
    }

    switch (retryClassOf(result.reason)) {
      case 'blocked':
        // 利用者の拒否・Security Core の deny。同じ Action は二度と実行しない。
        current.blocked.add(key)
        return

      case 'refresh':
      case 'retryable': {
        const failures = (current.failures.get(key) ?? 0) + 1

        current.failures.set(key, failures)

        if (failures > AGENT_MAX_RETRIES) {
          current.blocked.add(key)
        }

        return
      }
    }
  }

  /** Action を実行せずに拒む（Audit に残し、AI へは短い説明だけ返す）。 */
  function reject(
    current: Task,
    reason: 'invalid-action' | 'parallel-action' | 'repeated-action',
    actionType: AgentActionType | null,
    problem: string
  ): void {
    current.rejectedStreak += 1
    record(agentActionRejectedEvent(reason, actionType, permissionMode()))
    current.context.add(current.loopsUsed, {
      category: 'error',
      label: `rejected ${actionType ?? 'output'}`,
      header: [
        `action: ${actionType ?? '(unreadable)'}`,
        'status: rejected',
        `reason: ${reason}`
      ].join('\n'),
      detail: `problem: ${problem}`
    })
  }

  function askToContinue(current: Task): Promise<AgentTaskContinueDecision> {
    return new Promise((resolve) => {
      current.continueWaiter = (decision) => {
        current.continueWaiter = null
        resolve(decision)
      }

      update(current, { status: 'awaiting-continue', phase: null, subject: null })
    })
  }

  function update(
    current: Task,
    change: Partial<Pick<Task, 'status' | 'phase' | 'subject'>>
  ): void {
    if (task !== current) {
      return
    }

    if (current.stopReason !== null && change.status !== undefined) {
      // 止めると決まった後は、status を動かさない（stopping のまま終わりを待つ）。
      return
    }

    Object.assign(current, change)
    emit()
  }

  function finish(
    current: Task,
    status: Extract<AgentTaskStatus, 'completed' | 'stopped' | 'failed'>,
    reason: AgentTaskEndReason,
    answer?: string
  ): void {
    current.status = status
    current.phase = null
    current.subject = null
    current.endReason = reason
    current.finalAnswer =
      answer === undefined ? null : bounded(redactSecretText(answer), AGENT_ANSWER_MAX_LENGTH)
    current.continueWaiter = null
    current.abort.abort()

    if (task === current) {
      emit()
    }
  }

  return Object.freeze({
    start,
    stop,
    continueTask,
    halt: (reason: Extract<AgentTaskEndReason, 'workspace-changed'>) => requestStop(reason),
    getState: state,
    whenIdle: () => running
  })
}

function phaseOf(action: Exclude<AgentAction, { readonly type: 'complete' }>): AgentTaskPhase {
  switch (action.type) {
    case 'workspace_status':
    case 'workspace_list':
      return 'investigating'
    case 'file_read':
      return 'reading'
    case 'file_search':
      return 'searching'
    case 'file_write':
      return 'proposing-change'
    case 'terminal_run':
      return 'running-command'
  }
}

/** パネルに出す対象（伏せて短くした後）。 */
function subjectOf(action: Exclude<AgentAction, { readonly type: 'complete' }>): string | null {
  const raw = (() => {
    switch (action.type) {
      case 'workspace_status':
        return null
      case 'workspace_list':
        return action.path === '' ? '(root)' : action.path
      case 'file_read':
      case 'file_write':
        return action.path
      case 'file_search':
        return action.query
      case 'terminal_run':
        return [action.command, ...action.args].join(' ')
    }
  })()

  return raw === null ? null : bounded(redactSecretText(raw), AGENT_SUBJECT_MAX_LENGTH)
}

function bounded(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function rejected(
  reason: Extract<AgentTaskStartResult, { started: false }>['reason']
): AgentTaskStartResult {
  return Object.freeze({ started: false as const, reason })
}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}
