import { resolveAiProviderSelection } from '@shared/aiProvider'
import type { AgentProvider } from '../agent/agentProvider'
import { getAiProviderCredentialStore, readAiProviderPreferences } from './aiProviderService'
import { createOpenAiProvider } from './openAiProvider'

/**
 * 今の設定から、FN Agent が使う正式な Provider を作る（STEP10-6）。Agent Loop の入口
 * （main/agent/currentAgentLoop.ts）だけがここを読む。
 *
 * 作れるのは次の3つが揃ったときだけ（どれかが欠ければ null）。
 *
 * ```
 * Provider  ユーザー設定で正式な Provider を選んでいる（今は openai）
 * Model     その Provider の allowlist にある Model（無い欄は既定の gpt-6-sol）
 * API Key   Credential Store に保存してあり、この PC で復号できる（state が set）
 * ```
 *
 * **Workspace の設定は読まない**（`readAiProviderPreferences` はユーザー設定だけ）。Key もここでは
 * 取り出さない ── Adapter が通信の直前に `withCredential` で1回ずつ復号する。送り先の URL を
 * 渡す欄は無い（Adapter の中の定数）。
 */
export function createConfiguredAgentProvider(): AgentProvider | null {
  const selection = resolveAiProviderSelection(readAiProviderPreferences())

  if (!selection.ok) {
    return null
  }

  const store = getAiProviderCredentialStore()

  if (store.getState(selection.providerId) !== 'set') {
    return null
  }

  switch (selection.providerId) {
    case 'openai':
      return createOpenAiProvider({
        model: selection.modelId,
        fetch: (url, init) => globalThis.fetch(url, init),
        withCredential: (use) => store.withCredential('openai', use)
      })
  }
}

/** 正式な Provider を今使えるか（作らずに確かめる。Agent パネルの状態に使う）。 */
export function isConfiguredAgentProviderAvailable(): boolean {
  const selection = resolveAiProviderSelection(readAiProviderPreferences())

  return selection.ok && getAiProviderCredentialStore().getState(selection.providerId) === 'set'
}
