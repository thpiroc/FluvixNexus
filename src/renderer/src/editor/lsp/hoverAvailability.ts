import type { LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'
import { isLanguageServerReadyFor } from './serverAvailability'

/** その文書で LSP の Hover を使うか（判断は serverAvailability.ts）。 */
export function shouldUseLspHover(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  return isLanguageServerReadyFor(languageId, statuses)
}
