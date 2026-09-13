import type { DebugSessionStatus } from '@shared/debug'
import type { TranslationKey } from '../i18n/messages'

/**
 * Debug の状態を、翻訳キーにする（React にも DOM にも依存しない。Session 6-9）。
 *
 * lsp/languageServerLabels.ts と同じ形で、**言葉そのものは持たない**
 * （renderer/src/i18n/locales/）。返すのは翻訳キーだけで、画面を起動せずに
 * 「6つの状態すべてに言葉が付いているか」を試せる。
 *
 * ## Main から届いた文字列を描かない
 *
 * ステータスバーに出る文字は、閉じた集合の1語からここで選んだキーを
 * Renderer が翻訳したものだけになる ── adapter の名前・パス・失敗の文言が
 * 画面へ出る経路を、表示の側でも作らない。
 *
 * ## `stopped` は「一時停止」と読む
 *
 * 内部の `stopped` は「breakpoint / step / pause で止まっている」で、
 * 利用者が「Stopped / 停止中」と読むと「動いていない（idle）」と取り違える。
 * キーの名前は shared の語のまま（別名を付け直さない）にして、**言い回しの側で**
 * Paused / 一時停止中 と書く。
 */

/** ステータスバーに出す1語（`Debug: Running` など）。 */
export function debugStatusKey(status: DebugSessionStatus): TranslationKey {
  return `debug.status.${status}`
}

/** マウスを載せたときの1行の説明。 */
export function debugStatusDetailKey(status: DebugSessionStatus): TranslationKey {
  return `debug.statusDetail.${status}`
}
