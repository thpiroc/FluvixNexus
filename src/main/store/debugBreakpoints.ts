import type { DebugBreakpointsDocument } from '@shared/debug'
import { createJsonStore, type JsonStore } from './jsonStore'
import { parseDebugBreakpointsDocument } from './debugBreakpointsDocument'

/**
 * Breakpoint の保存先（Session 6-3）。
 *
 * 保存されるのは `%APPDATA%/Fluvix Nexus/debug-breakpoints.json`
 * （app.getPath('userData') 配下。jsonStore.ts が決める）。
 * **Workspace の中には何も書かない** ── docs/ARCHITECTURE.md §20.5 で
 * Debug Profile について決めた線を、そのまま breakpoint にも当てる。
 *
 * ファイルを分けているのは用途が違うから（ARCHITECTURE.md §5「永続化の API を
 * 用途ごとに切る」）。Debug Profile（Session 6-9 予定）とも別のファイルにする ──
 * 一方は「何を起動するか」、もう一方は「どこで止めるか」で、
 * 消える / 壊れたときに巻き添えにする理由が無い。
 *
 * 書き込みの頻度は「印を1つ付ける / 外す」のときだけなので、jsonStore の
 * 間引き（400ms）はほぼ素通りする。それでも同じ仕組みに載せているのは、
 * 一時ファイル経由の差し替え（書き込み中に落ちてもファイルが壊れない）と
 * 破損時の扱いを共通にしておくため。
 */

const STORE_FILE_NAME = 'debug-breakpoints.json'

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let store: JsonStore<DebugBreakpointsDocument> | null = null

function getStore(): JsonStore<DebugBreakpointsDocument> {
  store ??= createJsonStore(STORE_FILE_NAME, parseDebugBreakpointsDocument)
  return store
}

/** 保存済みの文書。未保存・破損・想定外の内容なら null。 */
export function readDebugBreakpointsDocument(): DebugBreakpointsDocument | null {
  return getStore().read()
}

/** 文書の保存を予約する。連続した依頼は最後の1回にまとめられる。 */
export function saveDebugBreakpointsDocument(document: DebugBreakpointsDocument): void {
  getStore().save(document)
}

/**
 * 予約済みの書き込みを即座に反映する。
 *
 * 終了時に呼ぶ（app の will-quit）。印を付けた直後に終了しても、
 * 次回起動で戻ってくるようにするための保険。
 */
export function flushDebugBreakpointsDocument(): void {
  // 一度も使っていなければ保存すべきものも無い（ここでストアを作る必要は無い）。
  store?.flush()
}
