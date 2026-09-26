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
import type { SafeExternalPayload } from '../security/externalSend/safeExternalPayload'
import { redactSecretText } from '../security/secret/secretMasking'
import {
  AGENT_ANSWER_MAX_LENGTH,
  parseAgentTurn,
  type AgentAction,
  type AgentActionType
} from './agentAction'
import { agentActionKey } from './agentActionKey'
import { agentActionRejectedEvent, agentProviderFailedEvent, agentStoppedEvent } from './agentAudit'
import { createAgentContext, type AgentContext } from './agentContext'
import {
  AGENT_PROVIDER_CALL_POLICY,
  AGENT_PROVIDER_MAX_ATTEMPTS,
  AGENT_PROVIDER_RETRY_AFTER_MAX_MS,
  AGENT_PROVIDER_RETRY_POLICY,
  isRetryableProviderFailure,
  readRetryAfterMs,
  type AgentProvider,
  type AgentProviderCallPolicy,
  type AgentProviderCallResult,
  type AgentProviderFailure,
  type AgentProviderRetryPolicy
} from './agentProvider'
import { callAgentProvider } from './agentProviderCall'
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
 * │   ↓ callAgentProvider（STEP10-2）   Payload・providerId の照合、abort / timeout、応答の上限
 * │     失敗なら再試行の Policy（STEP10-3）  呼び直すのは3つの分類だけ・最大3回・待機は止められる
 * │   ↓ Provider（STEP9 は Scripted）   通った応答1つ = 1 Loop（呼び直しは数えない）
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
 * - **Loop（Turn）= Provider から通った応答を1つ受け取ること。** 初期 20 回。上限に達したら
 *   自動で続けず、利用者に「続けるか」を尋ねる。続けるなら +10。無制限の自動継続は無い。
 *   **Provider への試み（Attempt）とは別に数える**（STEP10-4。2026-09-24）── 回数の制限・一時的な
 *   失敗・通信の失敗での呼び直しは Turn を使わない。呼び直しは1回の応答を得るまでに最大3回
 *   （AGENT_PROVIDER_RETRY_POLICY）で、使い切れば Turn を進めずに終える
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
  /**
   * Provider の呼び出しの Policy（timeout・応答の上限。STEP10-2）。省略すると
   * `AGENT_PROVIDER_CALL_POLICY`。
   */
  readonly providerCallPolicy?: AgentProviderCallPolicy
  /**
   * Provider の呼び直しの Policy（回数・待ち時間。STEP10-3）。省略すると
   * `AGENT_PROVIDER_RETRY_POLICY`。呼び直してよい失敗かは Policy ではなく
   * `isRetryableProviderFailure` が決める（ここからは変えられない）。
   */
  readonly providerRetryPolicy?: AgentProviderRetryPolicy
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
  /**
   * Provider の識別子（始めたときに1度だけ読んだもの）。Context の宛先と Audit の subject に使う。
   * 呼ぶときの照合は callAgentProvider が Provider からもう一度読んで行う。
   */
  readonly providerId: string
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
  /** このターンで Provider の呼び出しが続けて失敗した回数（呼び直しの数え方。成功で 0）。 */
  providerFailures: number
}

export function createAgentLoop(deps: AgentLoopDependencies): AgentLoop {
  const providerCallPolicy = deps.providerCallPolicy ?? AGENT_PROVIDER_CALL_POLICY
  const retryPolicy = readRetryPolicy(deps.providerRetryPolicy ?? AGENT_PROVIDER_RETRY_POLICY)
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
      providerId: readProviderId(provider),
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

      if (output.kind === 'wait') {
        /*
          呼び直してよい失敗（STEP10-3）。すぐには叩き直さず、Policy の時間だけ待つ。待っている間に
          止めれば（stop / halt）すぐに戻り、Loop の先頭で stopped になる ── 次の呼び出しは始めない。
          呼び直しも Context → External Send Gate → 新しい Payload → 境界、の正規の経路を通る。
        */
        await waitBeforeRetry(current, output.delayMs)
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

  /** Provider を1回呼ぶ（External Send Gate を通して）。通った応答だけが Turn を1つ使う。 */
  async function askProvider(
    current: Task
  ): Promise<
    | { readonly kind: 'value'; readonly value: string }
    | { readonly kind: 'retry' }
    | { readonly kind: 'wait'; readonly delayMs: number }
    | { readonly kind: 'end'; readonly reason: AgentTaskEndReason }
  > {
    const built = current.context.build({
      providerId: current.providerId,
      permissionMode: permissionMode(),
      loopsUsed: current.loopsUsed,
      loopLimit: current.loopLimit
    })

    if (!built.ok) {
      return { kind: 'end', reason: 'context-budget-exceeded' }
    }

    let called: AgentProviderCallResult

    try {
      /*
        Provider は直に await しない。Payload の確かめ直し・providerId の照合・abort / timeout・
        応答の大きさは callAgentProvider（STEP10-2）が持ち、ここは分類済みの結果だけを受け取る。
        Provider が signal を守らなくても、止めた時点・timeout の時点でここへ戻る。
      */
      const sent = await deps.sendToProvider(built.request, (payload) =>
        callAgentProvider(current.provider, payload, current.abort.signal, providerCallPolicy)
      )

      if (sent.decision === 'deny') {
        // 送れない Context（Secret ファイル・検査できない）。同じ Context を送り直しても通らない。
        return { kind: 'end', reason: 'context-denied' }
      }

      called = sent.delivered
    } catch {
      // Gate・境界は投げない作り。投げたら中身の分からない失敗として、送り直さずに終える。
      return current.stopReason !== null
        ? { kind: 'retry' }
        : { kind: 'end', reason: 'provider-failed' }
    }

    if (called.ok) {
      /*
        Turn を数えるのは、通った応答を受け取ったときだけ（STEP10-4）。呼び直し（Attempt）・
        失敗・中断は Turn を使わない。呼び直しは最大3回で必ず終わるため、Turn を使わなくても
        無制限には続かない。
      */
      current.providerFailures = 0
      current.loopsUsed += 1
      emit()

      return { kind: 'value', value: called.text }
    }

    const failure = called.failure

    if (failure === 'aborted') {
      // 作業の signal を abort するのは停止・halt・終わりだけ。Loop の先頭で stopped になる。
      return current.stopReason !== null
        ? { kind: 'retry' }
        : { kind: 'end', reason: 'provider-failed' }
    }

    // 何回目の呼び出しで失敗したか（1 から）。Audit へは分類と回数と識別子だけを渡す。
    const attempt = current.providerFailures + 1

    record(agentProviderFailedEvent(current.providerId, failure, attempt, permissionMode()))

    /*
      呼び直すのは、分類が呼び直してよいもの（回数の制限・一時的な失敗・通信の失敗）で、
      まだ回数が残っているときだけ（STEP10-3）。それ以外はその場で終える。
    */
    if (isRetryableProviderFailure(failure) && attempt < retryPolicy.maxAttempts) {
      const wait = retryWaitOf(called.retryAfterMs)

      /*
        Provider が FN の上限（30 秒）より長く待つよう求めた。上限まで縮めて早く送り直すことも、
        長く待つこともせず、ここで終える（呼び直さない。STEP10-6）。
      */
      if (wait.kind === 'retry-after-exceeds-policy') {
        current.providerFailures = 0

        return { kind: 'end', reason: endReasonOfProviderFailure(failure) }
      }

      current.providerFailures = attempt

      return { kind: 'wait', delayMs: wait.delayMs }
    }

    current.providerFailures = 0

    return { kind: 'end', reason: endReasonOfProviderFailure(failure) }
  }

  /**
   * 呼び直す前にどれだけ待つか（STEP10-6。2026-09-26 確定）。**Provider が求めた時間より早く
   * 送り直さない。**
   *
   * ```
   * Retry-After が無い・読めない            retryDelayMs（固定 1 秒）待って呼び直す
   * Retry-After ≦ maxRetryAfterMs（30 秒）  max(Retry-After, retryDelayMs) 待って呼び直す
   * Retry-After ＞ maxRetryAfterMs          呼び直さない（retry-after-exceeds-policy）
   * ```
   *
   * 上限まで縮めて早く送り直すことも、上限を超えて長く待つこともしない。Policy に上限が無ければ、
   * 上限は `retryDelayMs` として扱う（それより長い Retry-After では呼び直さない）。
   * Adapter は巨大な値を `AGENT_PROVIDER_RETRY_AFTER_MAX_MS` に飽和させて渡すが、上限は必ずそれより
   * 小さい（readRetryPolicy）ので、飽和した値は常に「上限を超える」側になる。
   */
  function retryWaitOf(retryAfterMs: unknown): RetryWait {
    const hinted = readRetryAfterMs(retryAfterMs)

    if (hinted === undefined) {
      return { kind: 'wait', delayMs: retryPolicy.retryDelayMs }
    }

    const cap = retryPolicy.maxRetryAfterMs ?? retryPolicy.retryDelayMs

    if (hinted > cap) {
      return { kind: 'retry-after-exceeds-policy' }
    }

    return { kind: 'wait', delayMs: Math.max(hinted, retryPolicy.retryDelayMs) }
  }

  /** 呼び直す前に待つ。作業の signal が止まれば（stop / halt・終わり）すぐに戻る。 */
  function waitBeforeRetry(current: Task, delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const signal = current.abort.signal

      if (signal.aborted) {
        resolve()
        return
      }

      const done = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, delayMs)

      signal.addEventListener('abort', done, { once: true })
    })
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

/**
 * Renderer へ見せる終わりの理由（閉じた集合）。timeout・大きすぎる応答（STEP10-3）と、
 * 認証・権限の失敗（STEP10-4）を分け、残りは `provider-failed` にまとめる（2026-09-24 確定）。
 * Provider の文字列は含まない ── 画面の文言は Renderer の固定文だけ。
 */
function endReasonOfProviderFailure(
  failure: Exclude<AgentProviderFailure, 'aborted'>
): AgentTaskEndReason {
  switch (failure) {
    case 'timeout':
      return 'provider-timeout'
    case 'response-too-large':
      return 'provider-response-too-large'
    case 'authentication-failed':
      return 'provider-authentication-failed'
    case 'authorization-failed':
      return 'provider-authorization-failed'
    default:
      return 'provider-failed'
  }
}

/**
 * 呼び直す前の待ち方（閉じた内部の状態。STEP10-6）。Renderer へは出ない ── 呼び直さずに終えるときの
 * 終わりの理由は、今までどおり失敗の分類から決まる（`provider-failed` など）。
 */
type RetryWait =
  | { readonly kind: 'wait'; readonly delayMs: number }
  | { readonly kind: 'retry-after-exceeds-policy' }

/** setTimeout が扱える上限。 */
const TIMER_MAX_MS = 2_147_483_647

/**
 * 呼び直しの Policy を1度だけ読む。**回数は天井（初回 ＋ 2 回）を超えない。** 読めない・
 * 使えない値なら呼び直さない（1回だけ呼ぶ）側へ倒す。
 */
function readRetryPolicy(policy: unknown): AgentProviderRetryPolicy {
  const noRetry = Object.freeze({ maxAttempts: 1, retryDelayMs: 0 })

  try {
    if (typeof policy !== 'object' || policy === null) {
      return noRetry
    }

    const { maxAttempts, retryDelayMs, maxRetryAfterMs } = policy as Record<string, unknown>

    if (
      typeof maxAttempts !== 'number' ||
      !Number.isSafeInteger(maxAttempts) ||
      maxAttempts < 1 ||
      typeof retryDelayMs !== 'number' ||
      !Number.isSafeInteger(retryDelayMs) ||
      retryDelayMs < 1 ||
      retryDelayMs > TIMER_MAX_MS
    ) {
      return noRetry
    }

    /*
      Retry-After の上限（STEP10-6）。読めない・`retryDelayMs` より短い・天井以上の値なら持たない
      （上限は `retryDelayMs` として扱われ、それより長い Retry-After では呼び直さない）。
      天井ちょうどを許さないのは、Adapter が天井に飽和させた値（本当はもっと長い）を
      上限の中と取り違えないため。
    */
    const retryAfterCap =
      typeof maxRetryAfterMs === 'number' &&
      Number.isSafeInteger(maxRetryAfterMs) &&
      maxRetryAfterMs >= retryDelayMs &&
      maxRetryAfterMs < AGENT_PROVIDER_RETRY_AFTER_MAX_MS
        ? maxRetryAfterMs
        : undefined

    return Object.freeze({
      maxAttempts: Math.min(maxAttempts, AGENT_PROVIDER_MAX_ATTEMPTS),
      retryDelayMs,
      ...(retryAfterCap === undefined ? {} : { maxRetryAfterMs: retryAfterCap })
    })
  } catch {
    return noRetry
  }
}

/** Provider の識別子を1度だけ読む（読めなければ空。External Send Gate が invalid-provider で拒む）。 */
function readProviderId(provider: AgentProvider): string {
  try {
    const id: unknown = provider.id

    return typeof id === 'string' ? id : ''
  } catch {
    return ''
  }
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
