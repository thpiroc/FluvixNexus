import type { LanguageId } from '@shared/language'
import { enMessages } from './locales/en'
import { jaMessages } from './locales/ja'
import type { TranslationKey, TranslationMessages } from './locales/types'

export type { TranslationKey, TranslationMessages } from './locales/types'

export type TranslationValues = Readonly<Record<string, string | number>>
export type TFunction = (key: TranslationKey, values?: TranslationValues) => string

const MESSAGES: Readonly<Record<LanguageId, TranslationMessages>> = {
  ja: jaMessages,
  en: enMessages
}

export function createTranslator(language: LanguageId): TFunction {
  const messages = MESSAGES[language]

  return (key, values) => {
    const template = readMessage(messages, key) ?? readMessage(jaMessages, key) ?? key

    return values === undefined ? template : interpolate(template, values)
  }
}

function readMessage(messages: TranslationMessages, key: TranslationKey): string | null {
  let current: unknown = messages

  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      return null
    }

    current = (current as Record<string, unknown>)[part]
  }

  return typeof current === 'string' ? current : null
}

function interpolate(template: string, values: TranslationValues): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name]

    return value === undefined ? match : String(value)
  })
}
