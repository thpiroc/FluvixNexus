import {
  applyDebugBreakpointVerification,
  type DebugBreakpointRecord,
  type DebugBreakpointVerification
} from './breakpointModel'
import {
  createSetBreakpointsArguments,
  parseSetBreakpointsResponse,
  type DapSourceReference
} from './dapBreakpoints'
import type { DebugSessionBreakpointChannel } from './debugSessionManager'

/**
 * Breakpoint を動いている Debug Session へ送る段取り（Electron / fs 非依存・テスト対象）。
 *
 * ```
 * main/debug/breakpoints.ts     何を送るか（今の Workspace の控え）
 *    ↓  1ファイルぶんの source + 行の並び
 * ここ                          送って、応答を読んで、控えへ当てる形に落とす
 *    ↓  setBreakpoints
 * main/debug/debugSessionManager.ts   動いている adapter へ書き出す
 * ```
 *
 * ## ファイルごとに1通
 *
 * DAP の `setBreakpoints` は**そのファイルの全件を毎回送る**（差分ではない）。
 * `publishDiagnostics` が文書の全件を毎回送るのと同じ形で、したがって
 * 「1件外した」も「そのファイルの残り全部」を送ることになる。
 *
 * **最後の1件を外した場合は、空の配列を送る。** 送らないと adapter 側の印が
 * 残ったままになり、外したはずの行で止まる。そのために、このセッションで
 * 1度でも送ったファイルを呼び出し側が覚えておく必要がある
 * （main/debug/breakpoints.ts の `syncedPaths`）。
 *
 * ## 応答が読めなくても落とさない
 *
 * 失敗・切断・壊れた応答はすべて「答えが無かった」に畳み、そのファイルの
 * verified を null（まだ分からない）へ戻す ── **間違った印を出すより、
 * 印を出さない方がよい。** adapter が居ない / 落ちた状態で赤い丸が
 * 「置けた」を主張し続けるのが、一番まずい結末になる。
 */

/** 1ファイルぶんの送信対象。 */
export interface DebugBreakpointSyncTarget {
  readonly relativePath: string
  /** 絶対パスを持つ DAP の `Source`（Renderer には出ない）。 */
  readonly source: DapSourceReference
  /** 送る行の並び（昇順）。空なら「このファイルの印を全部外す」。 */
  readonly lines: readonly number[]
}

/** 1ファイルぶんの結末。 */
export interface DebugBreakpointSyncOutcome {
  readonly relativePath: string
  readonly lines: readonly number[]
  /** null は「答えが無かった」。 */
  readonly verifications: readonly (DebugBreakpointVerification | null)[] | null
  /** 送れなかった / 断られた理由。うまくいったなら null。 */
  readonly failure: string | null
}

/** 1ファイルぶんを送り、応答を読む。 */
export async function sendDebugBreakpoints(
  channel: DebugSessionBreakpointChannel,
  target: DebugBreakpointSyncTarget
): Promise<DebugBreakpointSyncOutcome> {
  const outcome = await channel.setBreakpoints(
    createSetBreakpointsArguments(target.source, target.lines)
  )

  if (outcome.status !== 'success') {
    return {
      relativePath: target.relativePath,
      lines: target.lines,
      verifications: null,
      failure:
        outcome.status === 'failure'
          ? (outcome.message ?? 'the adapter rejected setBreakpoints.')
          : outcome.reason
    }
  }

  const verifications = parseSetBreakpointsResponse(outcome.body, target.lines.length)

  return {
    relativePath: target.relativePath,
    lines: target.lines,
    verifications,
    failure:
      verifications === null && target.lines.length > 0
        ? 'the adapter returned an unreadable setBreakpoints response.'
        : null
  }
}

/** 結末をまとめて控えへ当てる。 */
export function applyDebugBreakpointSyncOutcomes(
  records: readonly DebugBreakpointRecord[],
  outcomes: readonly DebugBreakpointSyncOutcome[]
): readonly DebugBreakpointRecord[] {
  return outcomes.reduce(
    (current, outcome) =>
      applyDebugBreakpointVerification(
        current,
        outcome.relativePath,
        outcome.lines,
        outcome.verifications
      ),
    records
  )
}
