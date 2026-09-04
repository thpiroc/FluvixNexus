import { createContext, useContext } from 'react'
import type { LanguageId } from '@shared/language'
import type { TFunction } from './messages'

export interface I18nController {
  readonly language: LanguageId
  readonly setLanguage: (language: LanguageId) => void
  readonly t: TFunction
}

export const I18nContext = createContext<I18nController | null>(null)

export function useI18n(): I18nController {
  const context = useContext(I18nContext)

  if (context === null) {
    throw new Error('useI18n must be used within LanguageProvider')
  }

  return context
}
