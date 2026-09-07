import type { LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'
import { isLspCompletionLanguage, isTypeScriptLanguageServerReady } from './completionAvailability'

/**
 * その文書で LSP の Rename を使うか（Session 5-9）。
 *
 * 判断の中身は補完 / Hover / 定義 / 整形とまったく同じで、
 * **TypeScript / JavaScript** かつ **サーバが ready** の2つだけを見る。
 * OFF・未インストール・起動中・失敗・停止のどれでも false になり、
 * Renderer は Monaco 内蔵の Rename へ落ちる
 * （renderer/src/editor/monaco/lspRename.ts）。
 */
export function shouldUseLspRename(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  return isLspCompletionLanguage(languageId) && isTypeScriptLanguageServerReady(statuses)
}
