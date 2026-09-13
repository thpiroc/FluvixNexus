import { resolveDebugSessionStatus, type DebugSessionStatus } from '@shared/debug'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emitIpcEvent } from '../ipc/events'
import { hasIntegratedDebugAdapter } from './adapterCatalog'
import {
  getDebugSessionState,
  onDebugSessionStateChange,
  type DebugSessionState
} from './debugSessionManager'

/**
 * Debug の状態を Renderer へ届ける層（Session 6-9）。
 *
 * ```
 * main/debug/debugSessionManager.ts   セッションの状態（遷移表の正本）
 * main/debug/adapterCatalog.ts        起動できる adapter があるか
 *    ↓  この2つを重ねる（shared/debug/status.ts の resolveDebugSessionStatus）
 * ここ                                画面に出す状態にして配る
 *    ↓  debug:status-changed / debug:get-status
 * Renderer                            ステータスバーに1つ出す
 * ```
 *
 * main/lsp/serverStatus.ts（Session 5-4）と同じ形にしてある。**新しい状態は持たない**
 * ── 持つのは「配る予定があるか」と「最後に配った語」だけになる。
 *
 * ## 出すのは1語だけ
 *
 * sessionId・generation・adapter の名前や実行ファイル・起動に失敗した理由は載せない
 * （shared/debug/status.ts）。載せる欄が無いので、境界は「弾く」ではなく
 * 「欄を作らない」で閉じている。
 *
 * ## 同じ tick の変化は1本にまとめる
 *
 * Step Over は `continued`（running）→ `stopped` が続けて届き、Stop は
 * terminating → idle が同じ流れの中で起きうる。1つずつ送るとその回数だけ Renderer が
 * 描き直すので、**まとめた後に読むのはそのときの状態**にする ── 間に何度変わっても
 * 最後に届くのは今の事実で、画面は必ずそこへ収束する。
 *
 * ## `workspaceId` を載せない
 *
 * Debug Session は**アプリ全体で同時に1本**（§20.11）で、Workspace の切り替えでは
 * 必ず終わって idle へ戻る（main/debug/debugSessionManager.ts の startDebugSessionHosting）。
 * その終わりが状態の変化として届くので、行き違っても最後の1本が今の状態になる
 * ── `lsp:status-changed` が載せないのと同じ理由にあたる。
 */

export interface DebugStatusReporterDependencies {
  readonly getState: () => DebugSessionState
  readonly onStateChange: (listener: (state: DebugSessionState) => void) => () => void
  /** 起動できる adapter が1つでもあるか（catalog の事実。パスは見ない）。 */
  readonly isAdapterAvailable: () => boolean
  readonly emit: (status: DebugSessionStatus) => void
  /** 同じ tick の変化をまとめる仕組み（既定は queueMicrotask。テストで差し替える）。 */
  readonly schedule?: (task: () => void) => void
}

export interface DebugStatusReporter {
  /** 今の状態。 */
  readonly current: () => DebugSessionStatus
  /** セッションの状態の購読を張る（1度だけ呼ぶ）。 */
  readonly start: () => void
}

export function createDebugStatusReporter(
  dependencies: DebugStatusReporterDependencies
): DebugStatusReporter {
  const schedule = dependencies.schedule ?? queueMicrotask
  let scheduled = false
  /**
   * 最後に配った語。
   *
   * running → stopped → running が同じ tick に収まった場合、まとめた結果は
   * 前に配った running と同じになる。同じ語をもう一度送っても伝わるものが無いので送らない。
   */
  let lastSent: DebugSessionStatus | null = null

  function current(): DebugSessionStatus {
    return resolveDebugSessionStatus(dependencies.getState(), dependencies.isAdapterAvailable())
  }

  function scheduleBroadcast(): void {
    if (scheduled) {
      return
    }

    scheduled = true

    schedule(() => {
      scheduled = false

      const next = current()

      if (next === lastSent) {
        return
      }

      lastSent = next
      dependencies.emit(next)
    })
  }

  function start(): void {
    /*
      起動時の状態は配らない（idle / unavailable から始まるのは決まっていて、
      Renderer は開いたときに `debug:get-status` で1度読む）。ただし「最後に配った語」は
      今の状態で埋めておく ── 埋めないと、最初の変化が起動時と同じ語へ戻っただけでも
      1本送ることになる。
    */
    lastSent = current()

    dependencies.onStateChange(() => {
      scheduleBroadcast()
    })
  }

  return { current, start }
}

const defaultReporter = createDebugStatusReporter({
  getState: getDebugSessionState,
  onStateChange: onDebugSessionStateChange,
  isAdapterAvailable: hasIntegratedDebugAdapter,
  emit: (status) => {
    emitIpcEvent(IPC_EVENT_CHANNELS.DEBUG_STATUS_CHANGED, { status })
  }
})

/** 今の状態（`debug:get-status` の答え）。 */
export function getDebugSessionStatus(): DebugSessionStatus {
  return defaultReporter.current()
}

/**
 * 状態を配り始める（アプリの起動時に1度だけ）。
 *
 * startLanguageServerStatusReporting と同じ形。**Workspace の切り替えは購読しない** ──
 * 切り替えではセッションが終わり、その終わりがセッションの状態の変化として必ず届く。
 */
export function startDebugSessionStatusReporting(): void {
  defaultReporter.start()
}
