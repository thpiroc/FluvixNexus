import {
  isDebugEvaluateContext,
  isDebugEvaluateExpressionShape,
  type DebugEvaluateContext,
  type DebugEvaluateResult,
  type DebugEvaluateUnavailableReason,
  type DebugVariableHandle
} from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { getDebugCallStackFrameHandle, type DebugCallStackFrameHandle } from './callStack'
import type { DapRequestOutcome } from './dapConnection'
import { createEvaluateArguments, parseEvaluateResponse } from './dapEvaluate'
import {
  getDebugSessionEvaluateChannel,
  getDebugSessionGeneration,
  getDebugSessionState,
  getDebugSessionStopGeneration,
  type DebugSessionEvaluateChannel,
  type DebugSessionState
} from './debugSessionManager'
import {
  getDebugVariableHandleEpoch,
  registerDebugEvaluateHandle,
  type DebugVariableHandleScope
} from './variables'

/**
 * 待てる時間（Session 6-7）。
 *
 * 実行制御（`DEBUG_SESSION_CONTROL_TIMEOUT_MS`）と同じ 10 秒にしてある。式の評価は
 * 利用者のプログラムを走らせうる操作で、**返らないことがありうる**
 * （無限ループを呼ぶ式、入力を待つ関数）。過ぎたら Renderer へは `timeout` を返し、
 * 遅れて届いた応答は捨てる ── ただし adapter へ取り消しは送らない（DAP に
 * `evaluate` を取り消す手立ては無い）。
 */
export const DEBUG_EVALUATE_TIMEOUT_MS = 10_000

export interface DebugEvaluateStore {
  readonly evaluate: (
    rawExpression: unknown,
    rawFrameId: unknown,
    rawContext: unknown
  ) => Promise<DebugEvaluateResult>
}

export interface DebugEvaluateStoreDependencies {
  readonly getWorkspace: () => WorkspaceFolder | null
  readonly getDebugState: () => DebugSessionState
  readonly getDebugGeneration: () => number
  readonly getDebugStopGeneration: () => number
  /** Session 6-5 の frame 検証（現在の snapshot・stopped・世代・Workspace）。 */
  readonly getFrameHandle: (rawFrameId: unknown) => DebugCallStackFrameHandle | null
  readonly getChannel: () => DebugSessionEvaluateChannel | null
  /** Session 6-6 の handle 表（**同じ表**を使う。別の表を持たない）。 */
  readonly getHandleEpoch: () => number
  readonly registerHandle: (
    scope: DebugVariableHandleScope,
    reference: number
  ) => DebugVariableHandle | null
  readonly log?: (level: 'warn' | 'debug', message: string) => void
  /** テストが短くするためのもの。既定は上の定数。 */
  readonly timeoutMs?: number
}

/**
 * Evaluate の Main 側（Session 6-7）。
 *
 * ```
 * Renderer                                   Main（ここ）                       adapter
 * debug:evaluate {expression, frameId, context}
 *   ────────────────────────────────────────▶ 形を確かめる
 *                                             frame を 6-5 の経路で確かめる
 *                                             epoch を控える（6-6 の表）
 *                                             evaluate {expression, frameId, context} ─▶
 *                                             ◀───────────────────────── EvaluateResponse
 *                                             まだ同じ停止か確かめる
 *                                             variablesReference → 6-6 の表へ handle を発行
 *   ◀──────────────────────────────────────── DebugEvaluateValue（handle だけ）
 * debug:list-variables {handle}   ← そこから先は Session 6-6 の経路がそのまま使える
 * ```
 *
 * ## 状態を持たない
 *
 * Variables（6-6）は handle 表という控えを持つが、**ここは1つも持たない** ──
 * 評価の結果は Renderer が画面に出すだけのもので、Main が覚えておく理由が無い。
 * 覚えるものが無いので「捨てる契機」も要らず、6-6 の生成番号 / epoch を
 * **読む側**として使うだけで stale 対策が閉じる。
 *
 * ## 古い結果が新しい画面に出ないこと
 *
 * | きっかけ                        | ここでどう落ちるか                                       |
 * | ------------------------------- | -------------------------------------------------------- |
 * | Continue / Step                 | 送る前: `not-stopped` / 送った後: 応答時の照合で `stale`  |
 * | 新しい `stopped`                | stop generation が進む → 照合で `stale`                   |
 * | Workspace 切り替え              | workspaceId が変わる → 照合で `stale`                     |
 * | セッション終了 / adapter close  | channel が null / `closed` の応答 → `not-stopped` / `stale` |
 * | adapter error / app cleanup     | 同上                                                       |
 * | frame の選択変更                | frame ごとに別の要求。**古い結果を捨てるのは Renderer**   |
 * | 新しい要求が古い要求を追い越した | 同上（Renderer が要求の通し番号で当てる）                 |
 *
 * 最後の2つだけが Renderer 側の責務になる ── Main から見ると、同じ停止の同じ frame への
 * 2通の evaluate はどちらも正当で、**どちらを画面に出すかは頼んだ側しか知らない**。
 */
export function createDebugEvaluateStore(
  dependencies: DebugEvaluateStoreDependencies
): DebugEvaluateStore {
  const timeoutMs = dependencies.timeoutMs ?? DEBUG_EVALUATE_TIMEOUT_MS

  async function evaluate(
    rawExpression: unknown,
    rawFrameId: unknown,
    rawContext: unknown
  ): Promise<DebugEvaluateResult> {
    /*
      形の検査は IPC ハンドラが先に済ませている（INVALID_REQUEST）。ここでも見るのは、
      表の持ち主が自分で確かめるのと同じ理由 ── 次にこの関数を呼ぶ人が
      ハンドラを通るとは限らない。
    */
    if (!isDebugEvaluateExpressionShape(rawExpression) || !isDebugEvaluateContext(rawContext)) {
      log('warn', 'ignored a malformed evaluate request.')
      return unavailable('failed')
    }

    const workspace = dependencies.getWorkspace()

    if (workspace === null || dependencies.getDebugState() !== 'stopped') {
      return unavailable('not-stopped')
    }

    const frame = dependencies.getFrameHandle(rawFrameId)
    const channel = dependencies.getChannel()

    if (
      frame === null ||
      frame.workspaceId !== workspace.id ||
      channel === null ||
      channel.generation !== frame.sessionGeneration ||
      channel.stopGeneration !== frame.stopGeneration ||
      channel.connectionId !== frame.connectionId
    ) {
      return unavailable('stale')
    }

    const scope: DebugVariableHandleScope = {
      workspaceId: workspace.id,
      sessionGeneration: channel.generation,
      stopGeneration: channel.stopGeneration,
      connectionId: channel.connectionId,
      epoch: dependencies.getHandleEpoch()
    }

    const outcome = await withTimeout(
      channel.requestEvaluate(
        createEvaluateArguments(rawExpression, frame.frameId, rawContext as DebugEvaluateContext)
      ),
      timeoutMs
    )

    if (outcome === null) {
      log('warn', 'the evaluate request did not answer in time.')
      return unavailable('timeout')
    }

    if (!isCurrent(scope)) {
      return unavailable('stale')
    }

    switch (outcome.status) {
      case 'failure':
        /* adapter の文言は絶対パスを含みうる。Main のログにだけ残す（§20.12 と同じ）。 */
        log(
          'warn',
          `evaluate request failed: ${outcome.message ?? 'adapter rejected the request.'}`
        )
        return unavailable('failed')

      case 'closed':
        return unavailable('stale')

      case 'success':
        break
    }

    const parsed = parseEvaluateResponse(outcome.body)

    if (parsed === null) {
      log('warn', 'ignored a malformed evaluate response.')
      return unavailable('failed')
    }

    const handle =
      parsed.reference > 0 ? dependencies.registerHandle(scope, parsed.reference) : null

    if (parsed.reference > 0 && handle === null) {
      log('warn', 'the evaluate result could not be given a handle for this stop.')
    }

    return { status: 'ok', value: { handle, ...parsed.value } }
  }

  /** 送った時点の停止に、まだ居るか。 */
  function isCurrent(scope: DebugVariableHandleScope): boolean {
    return (
      dependencies.getWorkspace()?.id === scope.workspaceId &&
      dependencies.getDebugState() === 'stopped' &&
      dependencies.getDebugGeneration() === scope.sessionGeneration &&
      dependencies.getDebugStopGeneration() === scope.stopGeneration &&
      dependencies.getChannel()?.connectionId === scope.connectionId
    )
  }

  function log(level: 'warn' | 'debug', message: string): void {
    dependencies.log?.(level, message)
  }

  return { evaluate }
}

function unavailable(reason: DebugEvaluateUnavailableReason): DebugEvaluateResult {
  return { status: 'unavailable', reason }
}

/** `debugSessionManager.ts` の同名の関数と同じ形（あちらはモジュール内に閉じている）。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      resolve(null)
    }, ms)
    timer.unref?.()

    void promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

const log = createLogger('debug-evaluate')

const defaultStore = createDebugEvaluateStore({
  getWorkspace: getCurrentWorkspaceFolder,
  getDebugState: getDebugSessionState,
  getDebugGeneration: getDebugSessionGeneration,
  getDebugStopGeneration: getDebugSessionStopGeneration,
  getFrameHandle: getDebugCallStackFrameHandle,
  getChannel: getDebugSessionEvaluateChannel,
  getHandleEpoch: getDebugVariableHandleEpoch,
  registerHandle: registerDebugEvaluateHandle,
  log: (level, message) => {
    if (level === 'warn') {
      log.warn(message)
    } else {
      log.debug(message)
    }
  }
})

export function evaluateDebugExpression(
  rawExpression: unknown,
  rawFrameId: unknown,
  rawContext: unknown
): Promise<DebugEvaluateResult> {
  return defaultStore.evaluate(rawExpression, rawFrameId, rawContext)
}
