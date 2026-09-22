import { useMemo, useState, type JSX, type ReactNode } from 'react'
import { useSettingsSection } from '../settings/useSettingsSection'
import { I18nContext } from './context'
import { applyDocumentLanguage } from './documentLanguage'
import {
  createLanguageSetters,
  LANGUAGE_SETTINGS_BINDING,
  type LanguageSettings
} from './languageSettings'
import { createTranslator } from './messages'
import { readDocumentLanguage } from './documentLanguage'

export function LanguageProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [initial] = useState<LanguageSettings>(() => ({ language: readDocumentLanguage() }))

  const { value: settings, update } = useSettingsSection({ ...LANGUAGE_SETTINGS_BINDING, initial })
  const { setLanguage } = useMemo(() => createLanguageSetters(update), [update])

  applyDocumentLanguage(settings.language)

  const t = useMemo(() => createTranslator(settings.language), [settings.language])

  return (
    <I18nContext.Provider value={{ language: settings.language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}
