import {
  DEFAULT_LANGUAGE_ID,
  LANGUAGE_IDS,
  normalizeLanguageId,
  type LanguageId
} from '@shared/language'
import type { StoredGeneralSettings } from '@shared/settings'
import type { SettingsSectionBinding, SettingsValueUpdate } from '../settings/settingsBinding'

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

/**
 * `general` section と表示言語の行き来（feature/settings-scope）。
 *
 * `general` は**ユーザー設定でだけ**変えられる section（shared/settings/scope.ts）。
 * binding の形は他の設定と同じで、ワークスペース設定へ書かないことは
 * scope の側が決める。
 */
export const LANGUAGE_SETTINGS_BINDING: SettingsSectionBinding<'general', LanguageSettings> = {
  section: 'general',
  initial: DEFAULT_LANGUAGE_SETTINGS,
  fromStored: toLanguageSettings,
  toStored: toGeneralSection
}

/** 表示言語を変える操作（同じなら据え置く）。 */
export function createLanguageSetters(update: SettingsValueUpdate<LanguageSettings>): {
  readonly setLanguage: (language: LanguageId) => void
} {
  return {
    setLanguage: (language) =>
      update((previous) => {
        const next = toLanguageSettings({ language })

        return isSameLanguageSettings(previous, next) ? previous : next
      })
  }
}
