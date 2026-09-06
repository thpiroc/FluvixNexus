import type { LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'

const LSP_COMPLETION_LANGUAGE_IDS = ['typescript', 'javascript'] as const

export function isLspCompletionLanguage(
  languageId: string
): languageId is 'typescript' | 'javascript' {
  return (LSP_COMPLETION_LANGUAGE_IDS as readonly string[]).includes(languageId)
}

export function isTypeScriptLanguageServerReady(
  statuses: readonly LanguageServerStatus[]
): boolean {
  return statuses.some((entry) => entry.serverId === 'typescript' && entry.status === 'ready')
}

export function shouldUseLspCompletion(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  return isLspCompletionLanguage(languageId) && isTypeScriptLanguageServerReady(statuses)
}
