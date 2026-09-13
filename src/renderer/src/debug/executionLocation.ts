import type { DebugCallStackFrame, DebugCallStackSnapshot } from '@shared/debug'

/**
 * 「今どこで止まっているか」（Session 6-13。純粋・テスト対象）。
 *
 * 新しい状態は持たない ── Main が配った Call Stack snapshot から導くだけで、
 * 止まっている位置は **止まった thread の最上段の frame** になる（DAP の仕様どおり、
 * `stopped` event 自体は位置を運ばない。docs/ARCHITECTURE.md §20.13）。
 *
 * ## 「実際に止まっている frame」と「選んでいる frame」を分ける
 *
 * Call Stack で下の段を押すと、Variables / Evaluate はその frame を読む（Session 6-6）。
 * それでもプログラムが止まっているのは最上段のままなので、両方を別々に返す
 * ── Editor にも別の印を出し、下の段を見ているときに「そこで止まっている」と
 * 読めないようにする（editor/debug/executionLineDecorations.ts）。
 */

/** 止まっている thread の最上段。止まっていない / frame が無ければ null。 */
export function findCurrentExecutionFrame(
  snapshot: DebugCallStackSnapshot
): DebugCallStackFrame | null {
  if (snapshot.status !== 'stopped' || snapshot.activeThreadId === null) {
    return null
  }

  const thread = snapshot.threads.find((candidate) => candidate.id === snapshot.activeThreadId)

  return thread?.frames[0] ?? null
}

/**
 * Editor で開けるか。Workspace の中にあり、行が読めた frame だけ
 * （Session 6-5 の Call Stack と同じ判断。Workspace 外の frame は開かない）。
 */
export function isOpenableExecutionFrame(frame: DebugCallStackFrame): boolean {
  return frame.source.kind === 'workspace' && frame.line !== null
}

/**
 * 停止ごとに1回だけ Editor を動かす相手（無ければ null）。
 *
 * `lastFollowedSequence` は前に動かした（または動かさないと決めた）停止の通し番号。
 * 同じ停止の中の読み直し（`thread` event）で snapshot の版が進んでも、通し番号は
 * 変わらないので動かし直さない ── 利用者が別の場所を見ている最中に引き戻さないため。
 *
 * `loading` の間は位置がまだ無いので待つ（`stopped` になってから決める）。
 */
export function resolveExecutionFollowTarget(
  snapshot: DebugCallStackSnapshot,
  lastFollowedSequence: number | null
): { readonly sequence: number; readonly frame: DebugCallStackFrame | null } | null {
  if (
    snapshot.status !== 'stopped' ||
    snapshot.stop === null ||
    snapshot.stop.sequence === lastFollowedSequence
  ) {
    return null
  }

  const frame = findCurrentExecutionFrame(snapshot)

  return {
    sequence: snapshot.stop.sequence,
    frame: frame !== null && isOpenableExecutionFrame(frame) ? frame : null
  }
}
