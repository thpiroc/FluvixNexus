import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_MODEL_ALLOWLIST, type AiProviderPreferences } from '@shared/aiProvider'
import { hasAiProviderModelLabel } from './aiProviderLabels'
import { AI_PROVIDER_SETTINGS_BINDING, createAiProviderSetters } from './aiProviderSettingsBinding'

/**
 * Provider / Model の選択の値（STEP10-5 / STEP10-6）。Settings 画面はこの binding と setter だけを通る。
 *
 * 選べるのは allowlist の3つ（GPT-6 Astra / Sol / Luna）だけで、外の ID は無視される。
 */

function run(
  start: AiProviderPreferences,
  act: (setters: ReturnType<typeof createAiProviderSetters>) => void
): AiProviderPreferences {
  let value = start

  act(
    createAiProviderSetters((change) => {
      value = change(value)
    })
  )

  return value
}

describe('AI_PROVIDER_SETTINGS_BINDING', () => {
  it('既定は未選択、読めない値も未選択（Provider だけなら Model は既定の Sol）', () => {
    expect(AI_PROVIDER_SETTINGS_BINDING.section).toBe('aiProvider')
    expect(AI_PROVIDER_SETTINGS_BINDING.initial).toEqual({ providerId: null, modelId: null })
    expect(
      AI_PROVIDER_SETTINGS_BINDING.fromStored({ providerId: 'scripted', modelId: 'synthetic-x' })
    ).toEqual({ providerId: null, modelId: null })
    expect(AI_PROVIDER_SETTINGS_BINDING.fromStored({ providerId: 'openai' })).toEqual({
      providerId: 'openai',
      modelId: 'gpt-6-sol'
    })
    expect(
      AI_PROVIDER_SETTINGS_BINDING.fromStored({ providerId: 'openai', modelId: 'gpt-anything' })
    ).toEqual({ providerId: 'openai', modelId: null })
  })

  it('保存する形に API Key も Endpoint も無い', () => {
    expect(AI_PROVIDER_SETTINGS_BINDING.toStored({ providerId: 'openai', modelId: null })).toEqual({
      providerId: 'openai'
    })
  })
})

describe('createAiProviderSetters', () => {
  const none: AiProviderPreferences = { providerId: null, modelId: null }

  it('Provider を選ぶ・外す', () => {
    const chosen = run(none, (setters) => setters.setProvider('openai'))

    expect(chosen).toEqual({ providerId: 'openai', modelId: 'gpt-6-sol' })
    expect(run(chosen, (setters) => setters.setProvider(null))).toEqual(none)
  })

  it('同じ値なら据え置く（保存の要求を出さない）', () => {
    expect(run(none, (setters) => setters.setProvider(null))).toBe(none)
  })

  it('allowlist の Model だけを選べる（STEP10-6）', () => {
    const chosen: AiProviderPreferences = { providerId: 'openai', modelId: 'gpt-6-sol' }

    for (const modelId of ['gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol']) {
      expect(run(chosen, (setters) => setters.setModel(modelId))).toEqual({
        providerId: 'openai',
        modelId
      })
    }

    expect(run(chosen, (setters) => setters.setModel('gpt-anything'))).toBe(chosen)
    expect(run(none, (setters) => setters.setModel('synthetic-model-alpha'))).toBe(none)
    expect(run(chosen, (setters) => setters.setModel(null))).toEqual({
      providerId: 'openai',
      modelId: null
    })
  })

  it('allowlist のどの Model にも画面の名前と用途がある', () => {
    for (const modelId of AI_PROVIDER_MODEL_ALLOWLIST.openai) {
      expect(hasAiProviderModelLabel(modelId)).toBe(true)
    }

    expect(hasAiProviderModelLabel('gpt-anything')).toBe(false)
  })
})
