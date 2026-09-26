import type { StoredAiProviderSettings } from '../settings/sections'
import {
  AI_PROVIDER_DEFAULT_MODEL,
  AI_PROVIDER_MODEL_ALLOWLIST,
  isAllowedModelId,
  isSupportedProviderId,
  type AiProviderModelAllowlist,
  type SupportedProviderId
} from './providers'

/**
 * FN Agent の Provider / Model の設定（STEP10-5）。Main と Renderer の両方がこの読み方を通る。
 *
 * ## 既定は「未選択」
 *
 * 何も選んでいない状態で外部の AI へ送ることはしない。Provider を選ぶのは
 * **この PC の外へ Workspace の内容を送る先を決める**ことで、利用者がはっきり選ぶまで
 * どの Provider も使わない（MCP の既定が無効なのと同じ線）。
 *
 * ## 読めない値は未選択へ倒す
 *
 * 知らない Provider・allowlist に無い Model・その Provider の Model ではない ID は、どれも
 * 未選択として読む。壊れた / 手で書き換えた設定ファイルで、送り先や Model が決まることは無い。
 *
 * ## Model の既定（STEP10-6）
 *
 * Provider を選んでいて **Model の欄が無い**ときだけ、その Provider の既定の Model
 * （OpenAI は `gpt-6-sol`）を使う。欄があって allowlist に無い値は既定へ読み替えない（未選択）。
 */
export interface AiProviderPreferences {
  /** 選んだ正式な Provider。未選択なら null。 */
  readonly providerId: SupportedProviderId | null
  /** 選んだ Model（その Provider の allowlist にあるもの）。未選択なら null。 */
  readonly modelId: string | null
}

export const DEFAULT_AI_PROVIDER_PREFERENCES: AiProviderPreferences = Object.freeze({
  providerId: null,
  modelId: null
})

/** 保存されている形から、使う形へ（読めない値は未選択）。 */
export function normalizeAiProviderPreferences(
  stored: StoredAiProviderSettings | undefined,
  allowlist: AiProviderModelAllowlist = AI_PROVIDER_MODEL_ALLOWLIST
): AiProviderPreferences {
  const providerId = isSupportedProviderId(stored?.providerId) ? stored.providerId : null

  if (providerId === null) {
    return { providerId: null, modelId: null }
  }

  const modelId =
    stored?.modelId === undefined
      ? defaultModelOf(providerId, allowlist)
      : isAllowedModelId(providerId, stored.modelId, allowlist)
        ? stored.modelId
        : null

  return { providerId, modelId }
}

/** その Provider の既定の Model（allowlist に無ければ null）。 */
function defaultModelOf(
  providerId: SupportedProviderId,
  allowlist: AiProviderModelAllowlist
): string | null {
  const model = AI_PROVIDER_DEFAULT_MODEL[providerId]

  return isAllowedModelId(providerId, model, allowlist) ? model : null
}

/** 使う形から、保存する形へ（未選択の key は書かない ＝ 既定）。 */
export function toStoredAiProviderSettings(
  preferences: AiProviderPreferences
): StoredAiProviderSettings {
  return {
    ...(preferences.providerId === null ? {} : { providerId: preferences.providerId }),
    ...(preferences.modelId === null ? {} : { modelId: preferences.modelId })
  }
}

export function isSameAiProviderPreferences(
  a: AiProviderPreferences,
  b: AiProviderPreferences
): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId
}

/**
 * Provider を選び直す。前の Model が新しい Provider の allowlist に無ければ、その Provider の
 * 既定の Model にする（別の Provider の Model ID を持ち越さない）。
 */
export function selectAiProvider(
  previous: AiProviderPreferences,
  providerId: SupportedProviderId | null,
  allowlist: AiProviderModelAllowlist = AI_PROVIDER_MODEL_ALLOWLIST
): AiProviderPreferences {
  if (providerId === null) {
    return { providerId: null, modelId: null }
  }

  const modelId = isAllowedModelId(providerId, previous.modelId, allowlist)
    ? previous.modelId
    : defaultModelOf(providerId, allowlist)

  return { providerId, modelId }
}

/**
 * 実 Provider を呼べるだけの選択が揃っているか（STEP10-6 の Adapter が呼ぶ前に確かめる）。
 *
 * 揃っていなければ理由だけを返す。**Credential はここでは見ない** ── API Key は設定ではなく
 * Main の Credential Store にあり、設定の読み方がそこへ触れる形にしない。
 */
export type AiProviderSelection =
  | { readonly ok: true; readonly providerId: SupportedProviderId; readonly modelId: string }
  | { readonly ok: false; readonly reason: 'provider-not-selected' | 'model-not-selected' }

export function resolveAiProviderSelection(
  preferences: AiProviderPreferences,
  allowlist: AiProviderModelAllowlist = AI_PROVIDER_MODEL_ALLOWLIST
): AiProviderSelection {
  /*
    渡された値も信じ直す（型を名乗っているだけの値で、閉じた集合の外へ出ない）。
    既定の Model への読み替えはしない ── 既定は設定を読むとき（normalize）に1度だけ入る。
  */
  const providerId: unknown = preferences.providerId
  const modelId: unknown = preferences.modelId

  if (!isSupportedProviderId(providerId)) {
    return { ok: false, reason: 'provider-not-selected' }
  }

  if (!isAllowedModelId(providerId, modelId, allowlist)) {
    return { ok: false, reason: 'model-not-selected' }
  }

  return { ok: true, providerId, modelId }
}
