import type { LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'
import { isLanguageServerReadyFor } from './serverAvailability'

/**
 * 整形だけ、言語の一覧をここに持つ（Session 5-10）。
 *
 * 他の4つ（補完 / Hover / 定義・参照 / Rename）は「そのサーバが ready か」だけを
 * 見れば済む。**整形は、担当サーバがその機能を持っていない場合がある。**
 *
 * ```
 * typescript-language-server … documentFormattingProvider: true
 * pyright-langserver         … documentFormattingProvider を出さない
 * ```
 *
 * Pyright は型検査器であって整形器ではなく、`textDocument/formatting` は
 * `-32601 Unhandled method` を返す（実際に繋いで確かめた）。
 * Python の整形には Black / Ruff のような別のプログラムが要るが、
 * **Session 5-10 はそれを入れない** ── LSP を1本足す作業に、
 * 別系統の外部ツールを1つ増やす判断を混ぜない（DESIGN.md §5）。
 *
 * ## 名乗りを見るのは Main
 *
 * 本当の判断は main/lsp/serverCapabilities.ts が持っていて、そこは
 * `initialize` の応答を読む。ここにある一覧はその写しではなく、
 * **無駄な往復を1つ省くためだけ**のものになる ── かりにここを通っても、
 * Main が `unavailable` を返して同じ結末になる。
 *
 * ## Python では provider ごと登録しない
 *
 * 登録して何も返さない形にすると、Format Document が黙って何もしないことになる。
 * 登録しなければ Monaco が「この言語の整形器は入っていない」と言うので、
 * **利用者に伝わる情報が増える**（renderer/src/editor/monaco/lspFormatting.ts）。
 */
const LSP_FORMATTING_LANGUAGE_IDS = ['typescript', 'javascript'] as const

/** 担当サーバが整形を出す言語か。 */
export function isLspFormattingLanguage(languageId: EditorLanguageId | string): boolean {
  return (LSP_FORMATTING_LANGUAGE_IDS as readonly string[]).includes(languageId)
}

/** その文書で LSP の整形を使うか。 */
export function shouldUseLspFormatting(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  return isLspFormattingLanguage(languageId) && isLanguageServerReadyFor(languageId, statuses)
}
