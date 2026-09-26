import type { SupportedProviderId } from '@shared/aiProvider'
import type { TranslationKey } from '../i18n/messages'

/** 正式な Provider の表示名（Settings の選択肢と API Key の面が使う）。 */
export function aiProviderNameKey(providerId: SupportedProviderId): TranslationKey {
  return `settings.aiProvider.providers.${providerId}`
}

/**
 * Model の表示名と用途（STEP10-6）。**内部の値は正式な Model ID のまま**で、画面の名前だけを
 * ここで引く。allowlist（shared/aiProvider/providers.ts）に Model を足したら、ここにも足す
 * （足し忘れはテストが落とす。aiProviderSettingsBinding.test.ts）。
 */
const MODEL_LABELS: Readonly<
  Record<string, { readonly name: TranslationKey; readonly description: TranslationKey }>
> = Object.freeze({
  'gpt-6-astra': {
    name: 'settings.aiProvider.models.astra.name',
    description: 'settings.aiProvider.models.astra.description'
  },
  'gpt-6-sol': {
    name: 'settings.aiProvider.models.sol.name',
    description: 'settings.aiProvider.models.sol.description'
  },
  'gpt-6-luna': {
    name: 'settings.aiProvider.models.luna.name',
    description: 'settings.aiProvider.models.luna.description'
  }
})

export function hasAiProviderModelLabel(modelId: string): boolean {
  return Object.hasOwn(MODEL_LABELS, modelId)
}

export function aiProviderModelNameKey(modelId: string): TranslationKey {
  return Object.hasOwn(MODEL_LABELS, modelId)
    ? MODEL_LABELS[modelId].name
    : 'settings.aiProvider.model.choose'
}

export function aiProviderModelDescriptionKey(modelId: string): TranslationKey {
  return Object.hasOwn(MODEL_LABELS, modelId)
    ? MODEL_LABELS[modelId].description
    : 'settings.aiProvider.model.invalid'
}
