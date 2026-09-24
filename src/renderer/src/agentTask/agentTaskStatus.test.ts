import { describe, expect, it } from 'vitest'
import type { AgentTaskEndReason, AgentTaskState } from '@shared/agent'
import { createTranslator } from '../i18n/messages'
import { agentTaskStatusKey } from './agentTaskStatus'

/**
 * Agent パネルの終わりの理由の文言（STEP10-3 で Provider の timeout / 大きすぎる応答を分けた）。
 *
 * 文言は固定で、Main から届く閉じた集合の理由を鍵へ写すだけ（Provider の文字列は画面に出ない）。
 */

function stateOf(status: 'failed' | 'stopped', endReason: AgentTaskEndReason): AgentTaskState {
  return {
    status,
    phase: null,
    subject: null,
    loopsUsed: 1,
    loopLimit: 20,
    finalAnswer: null,
    endReason,
    agentEnabled: true,
    providerAvailable: true
  }
}

describe('Provider の失敗の終わりの理由', () => {
  const KEYS = {
    'provider-timeout': 'agentTask.end.providerTimeout',
    'provider-response-too-large': 'agentTask.end.providerResponseTooLarge',
    'provider-authentication-failed': 'agentTask.end.providerAuthenticationFailed',
    'provider-authorization-failed': 'agentTask.end.providerAuthorizationFailed',
    'provider-failed': 'agentTask.end.providerFailed'
  } as const

  it('timeout・大きすぎる応答・認証・権限・その他の失敗は、別々の固定の文言になる', () => {
    for (const [reason, key] of Object.entries(KEYS)) {
      expect(agentTaskStatusKey(stateOf('failed', reason as AgentTaskEndReason))).toBe(key)
    }
  })

  it('認証の失敗は API Key の確認を、権限の失敗は利用権限の確認を案内する（固定文）', () => {
    const ja = createTranslator('ja')
    const en = createTranslator('en')

    expect(ja('agentTask.end.providerAuthenticationFailed')).toBe(
      'Provider の認証に失敗しました。API Key を確認してください。'
    )
    expect(ja('agentTask.end.providerAuthorizationFailed')).toContain('利用権限を確認してください')
    expect(en('agentTask.end.providerAuthenticationFailed')).toContain('API key')
    expect(en('agentTask.end.providerAuthorizationFailed')).toContain('permissions')
  })

  it('日本語と英語の文言があり、互いに別の文になっている', () => {
    for (const language of ['ja', 'en'] as const) {
      const t = createTranslator(language)
      const texts = Object.values(KEYS).map((key) => t(key))

      expect(new Set(texts).size).toBe(Object.keys(KEYS).length)

      for (const text of texts) {
        expect(text).not.toMatch(/^agentTask\./)
        expect(text).not.toMatch(/\{\w+\}/)
      }
    }
  })
})
