import type { LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'
import { isLanguageServerReadyFor } from './serverAvailability'

/** その文書で LSP の定義 / 参照を使うか（判断は serverAvailability.ts）。 */
export function shouldUseLspNavigation(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  return isLanguageServerReadyFor(languageId, statuses)
}
