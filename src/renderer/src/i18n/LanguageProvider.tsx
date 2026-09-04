import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react'
import type { LanguageId } from '@shared/language'
import { useSettingsSection } from '../settings/useSettingsSection'
import { I18nContext } from './context'
import { applyDocumentLanguage } from './documentLanguage'
import {
  isSameLanguageSettings,
  toGeneralSection,
  toLanguageSettings,
  type LanguageSettings
} from './languageSettings'
import { createTranslator } from './messages'
import { readDocumentLanguage } from './documentLanguage'

export function LanguageProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [initial] = useState<LanguageSettings>(() => ({ language: readDocumentLanguage() }))

  const { value: settings, update } = useSettingsSection({
    section: 'general',
    initial,
    fromStored: toLanguageSettings,
    toStored: toGeneralSection,
    label: 'Language の設定'
  })

  const setLanguage = useCallback(
    (language: LanguageId): void => {
      update((previous) => {
        const next = toLanguageSettings({ language })

        return isSameLanguageSettings(previous, next) ? previous : next
      })
    },
    [update]
  )

  applyDocumentLanguage(settings.language)

  const t = useMemo(() => createTranslator(settings.language), [settings.language])

  return (
    <I18nContext.Provider value={{ language: settings.language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}
