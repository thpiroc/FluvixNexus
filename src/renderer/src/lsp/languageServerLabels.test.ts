import { describe, expect, it } from 'vitest'
import {
  LANGUAGE_SERVER_IDS,
  LANGUAGE_SERVER_STATUS_IDS,
  summarizeLanguageServerStatuses,
  type LanguageServerStatus
} from '@shared/lsp'
import { createTranslator } from '../i18n/messages'
import {
  languageServerNameKey,
  languageServerStatusKey,
  languageServerSummaryKey
} from './languageServerLabels'

/**
 * サーバの名前と状態に、言葉が付いているか（Session 5-4）。
 *
 * 辞書の key が en / ja で一致することは i18n/messages.test.ts が見ている。
 * ここで見るのはその手前で、**画面が引く key が実際に辞書にあるか**になる
 * ── 型（`TranslationKey`）は組み立てた文字列を通してしまうので、
 * 行や状態を足したときに翻訳の抜けを拾うのはこちらの役目にあたる。
 *
 * 「無い key は key そのものを返す」という `createTranslator` の逃げ道
 * （i18n/messages.ts）があるため、**返り値が key と同じでないこと**を見る。
 */

const LANGUAGES = ['en', 'ja'] as const

describe('言語サーバーの表示名', () => {
  it('3つの行すべてに、両言語の名前がある', () => {
    for (const language of LANGUAGES) {
      const t = createTranslator(language)

      for (const id of LANGUAGE_SERVER_IDS) {
        const key = languageServerNameKey(id)

        expect(t(key), `${language}:${key}`).not.toBe(key)
      }
    }
  })

  it('6つの状態すべてに、両言語の言い回しがある（内訳・まとめの両方）', () => {
    for (const language of LANGUAGES) {
      const t = createTranslator(language)

      for (const status of LANGUAGE_SERVER_STATUS_IDS) {
        for (const key of [languageServerStatusKey(status), languageServerSummaryKey(status)]) {
          expect(t(key), `${language}:${key}`).not.toBe(key)
        }
      }
    }
  })

  /*
    ステータスバーに出るのは「まとめた1語」で、単独で何の話か伝わる必要がある
    （内訳は名前と並ぶので、状態だけで足りる）── 言葉を分けてある理由を、
    実際の言い回しで確かめておく。
  */
  it('まとめの言い回しは、単独で何の話か分かる形にする', () => {
    const t = createTranslator('en')

    for (const status of LANGUAGE_SERVER_STATUS_IDS) {
      expect(t(languageServerSummaryKey(status))).toContain('LSP')
    }
  })

  it('まとめた状態は、必ず言葉を持つ状態になる', () => {
    const statuses: readonly LanguageServerStatus[] = LANGUAGE_SERVER_IDS.map((serverId) => ({
      serverId,
      status: 'ready'
    }))

    const t = createTranslator('ja')
    const key = languageServerSummaryKey(summarizeLanguageServerStatuses(statuses))

    expect(t(key)).not.toBe(key)
  })
})
