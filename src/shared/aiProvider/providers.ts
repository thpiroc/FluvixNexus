/**
 * FN Agent が使う**正式な** AI Provider（Security Core v1 の STEP10-5。2026-09-25）。
 *
 * ## 閉じた集合
 *
 * `SUPPORTED_PROVIDER_IDS` に載っているものだけが正式な Provider で、設定・Credential・
 * IPC のどれも、ここに無い名前を受け付けない（知らない名前は Fail Closed）。
 * 初期の正式 Provider は `openai` だけ。`anthropic` / `gemini` などは、Adapter を作る段階で
 * ここへ1行足す（足すと `AI_PROVIDER_MODEL_ALLOWLIST` の `Record` が型で書き足しを求める）。
 *
 * **Scripted Provider（`fn-scripted-dev`）はここに入らない。** 開発 / テスト専用の別枠で、
 * 開発ビルドでだけ作られる（main/agent/currentAgentLoop.ts）。設定で選べず、Credential も持たない。
 *
 * ## Endpoint はここにも無い
 *
 * 接続先の URL は Provider Adapter（STEP10-6）の内部に固定する。設定・Workspace・Renderer から
 * 変える欄は、この集合にも設定の section にも IPC にも無い。
 */
export const SUPPORTED_PROVIDER_IDS = ['openai'] as const

/** 正式な Provider の識別子。 */
export type SupportedProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number]

/** 素の値が正式な Provider の識別子か（`scripted`・大文字違い・prototype の名前は通さない）。 */
export function isSupportedProviderId(value: unknown): value is SupportedProviderId {
  return typeof value === 'string' && (SUPPORTED_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * Provider ごとに選べる Model（FN 側の allowlist）。
 *
 * 利用者が任意の文字列を入れる形にはしない ── 選べるのはここに載っている ID だけで、
 * 保存の要求も Main がここと照らして拒む（main/store/settingsSections.ts）。
 *
 * ## OpenAI（STEP10-6。2026-09-25 利用者決定）
 *
 * 2026-09-25 時点の OpenAI 公式 API 仕様に基づく3つ。並びは Settings の選択肢の並び。
 *
 * ```
 * gpt-6-astra  最も高性能。難しい end-to-end の作業向け
 * gpt-6-sol    coding / agentic workflow 向け。FN Agent の標準（既定）
 * gpt-6-luna   高速・低コスト・大量処理向け
 * ```
 *
 * ここに無い ID は、設定の保存（Main）・設定の読み込み・Adapter の作成のどこでも通らない。
 */
export type AiProviderModelAllowlist = {
  readonly [Id in SupportedProviderId]: readonly string[]
}

export const AI_PROVIDER_MODEL_ALLOWLIST: AiProviderModelAllowlist = Object.freeze({
  openai: Object.freeze(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'])
})

/**
 * Provider を選んで Model をまだ選んでいないときに使う Model（STEP10-6）。
 *
 * 使うのは Model の欄が**無い**ときだけ。欄があって allowlist に無い値（書き換えた・古い版の値）は
 * 既定へ読み替えず、未選択として Fail Closed にする（shared/aiProvider/settings.ts）。
 */
export const AI_PROVIDER_DEFAULT_MODEL: { readonly [Id in SupportedProviderId]: string } =
  Object.freeze({
    openai: 'gpt-6-sol'
  })

/** どれかの Provider で選べる Model の ID すべて（保存の要求を形の段階で絞るため）。 */
export function listAllowedModelIds(
  allowlist: AiProviderModelAllowlist = AI_PROVIDER_MODEL_ALLOWLIST
): readonly string[] {
  return SUPPORTED_PROVIDER_IDS.flatMap((id) => allowlist[id])
}

/** その Provider でその Model を選べるか。 */
export function isAllowedModelId(
  providerId: SupportedProviderId,
  modelId: unknown,
  allowlist: AiProviderModelAllowlist = AI_PROVIDER_MODEL_ALLOWLIST
): modelId is string {
  return typeof modelId === 'string' && allowlist[providerId].includes(modelId)
}
