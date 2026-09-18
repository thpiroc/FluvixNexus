import {
  DEFAULT_LANGUAGE_SERVER_PREFERENCES,
  isSameLanguageServerPreferences,
  normalizeLanguageServerPreferences,
  toStoredLspSettings,
  type LanguageServerId,
  type LanguageServerPreferences
} from '@shared/lsp'
import type { SettingsSectionBinding, SettingsValueUpdate } from '../settings/settingsBinding'

/**
 * `lsp` section と Language Server の設定の行き来（feature/settings-scope）。
 *
 * 変換そのものは shared に置いたまま（Main も同じ関数で読む。shared/lsp/serverSettings.ts）。
 * ここは Renderer の2つの読み手 ── LspSettingsProvider（効く値）と
 * Settings 画面（選んでいる scope の値）── が同じ binding を使うための置き場所。
 */
export const LSP_SETTINGS_BINDING: SettingsSectionBinding<'lsp', LanguageServerPreferences> = {
  section: 'lsp',
  initial: DEFAULT_LANGUAGE_SERVER_PREFERENCES,
  fromStored: normalizeLanguageServerPreferences,
  toStored: toStoredLspSettings
}

export interface LanguageServerSetters {
  readonly setEnabled: (enabled: boolean) => void
  readonly setServerEnabled: (id: LanguageServerId, enabled: boolean) => void
}

/** Language Server の有効 / 無効を変える操作（同じなら据え置く）。 */
export function createLanguageServerSetters(
  update: SettingsValueUpdate<LanguageServerPreferences>
): LanguageServerSetters {
  const apply = (
    change: (previous: LanguageServerPreferences) => LanguageServerPreferences
  ): void => {
    update((previous) => {
      const next = change(previous)

      // 同じなら据え置く（保存と再描画が走り続ける経路を作らない）。
      return isSameLanguageServerPreferences(previous, next) ? previous : next
    })
  }

  return {
    setEnabled: (enabled) => apply((previous) => ({ ...previous, enabled })),
    setServerEnabled: (id, enabled) =>
      apply((previous) => ({ ...previous, servers: { ...previous.servers, [id]: enabled } }))
  }
}
