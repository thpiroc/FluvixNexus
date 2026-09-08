import type { LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'
import { isLanguageServerReadyFor } from './serverAvailability'

/**
 * その文書で LSP の補完を使うか。
 *
 * 言語とサーバの対応・`ready` の見方はどちらも serverAvailability.ts が持つ
 * （Session 5-10 で Python を足したときに、5つの機能が同じ表を引く形にした）。
 */
export function shouldUseLspCompletion(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  return isLanguageServerReadyFor(languageId, statuses)
}
