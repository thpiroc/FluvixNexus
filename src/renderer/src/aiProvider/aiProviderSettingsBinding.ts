import {
  DEFAULT_AI_PROVIDER_PREFERENCES,
  isAllowedModelId,
  isSameAiProviderPreferences,
  normalizeAiProviderPreferences,
  selectAiProvider,
  toStoredAiProviderSettings,
  type AiProviderPreferences,
  type SupportedProviderId
} from '@shared/aiProvider'
import type { SettingsSectionBinding, SettingsValueUpdate } from '../settings/settingsBinding'

/**
 * FN Agent の Provider / Model の選択の値の持ち主（STEP10-5）。
 *
 * 形は MCP の `mcpSettingsBinding.ts` と同じ（読む・書く・同じなら据え置く）。
 * **API Key はここを通らない** ── Key は設定の値ではなく、ai-provider の IPC から Main の
 * Credential Store へ渡る（AiProviderCredentialPanel.tsx）。Endpoint の欄も無い。
 *
 * この section は application scope なので、Settings 画面でワークスペースを選んでいる間は
 * 押せない状態で出る（shared/settings/scope.ts）。
 */
export const AI_PROVIDER_SETTINGS_BINDING: SettingsSectionBinding<
  'aiProvider',
  AiProviderPreferences
> = {
  section: 'aiProvider',
  initial: DEFAULT_AI_PROVIDER_PREFERENCES,
  fromStored: (stored) => normalizeAiProviderPreferences(stored),
  toStored: toStoredAiProviderSettings
}

export interface AiProviderSetters {
  /** Provider を選ぶ（null ＝ 選ばない）。前の Model がその Provider に無ければ未選択へ戻る。 */
  readonly setProvider: (providerId: SupportedProviderId | null) => void
  /** Model を選ぶ（null ＝ 選ばない）。選んでいる Provider の allowlist に無い ID は無視する。 */
  readonly setModel: (modelId: string | null) => void
}

export function createAiProviderSetters(
  update: SettingsValueUpdate<AiProviderPreferences>
): AiProviderSetters {
  const apply = (change: (previous: AiProviderPreferences) => AiProviderPreferences): void => {
    update((previous) => {
      const next = change(previous)

      return isSameAiProviderPreferences(previous, next) ? previous : next
    })
  }

  return {
    setProvider: (providerId) => apply((previous) => selectAiProvider(previous, providerId)),
    setModel: (modelId) =>
      apply((previous) => {
        if (modelId === null) {
          return { ...previous, modelId: null }
        }

        return previous.providerId !== null && isAllowedModelId(previous.providerId, modelId)
          ? { ...previous, modelId }
          : previous
      })
  }
}
