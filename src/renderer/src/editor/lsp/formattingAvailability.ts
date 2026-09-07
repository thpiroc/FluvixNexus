import type { LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'
import { isLspCompletionLanguage, isTypeScriptLanguageServerReady } from './completionAvailability'

export function shouldUseLspFormatting(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  return isLspCompletionLanguage(languageId) && isTypeScriptLanguageServerReady(statuses)
}
