import {
  DEFAULT_LANGUAGE_ID,
  LANGUAGE_IDS,
  normalizeLanguageId,
  type LanguageId
} from '@shared/language'
import type { StoredGeneralSettings } from '@shared/settings'

export interface LanguageSettings {
  readonly language: LanguageId
}

export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = { language: DEFAULT_LANGUAGE_ID }

export const LANGUAGE_CHOICES: readonly LanguageId[] = LANGUAGE_IDS

export function toLanguageSettings(stored: StoredGeneralSettings): LanguageSettings {
  return { language: normalizeLanguageId(stored.language) }
}

export function toGeneralSection(settings: LanguageSettings): StoredGeneralSettings {
  return { language: normalizeLanguageId(settings.language) }
}

export function isSameLanguageSettings(first: LanguageSettings, second: LanguageSettings): boolean {
  return first.language === second.language
}
