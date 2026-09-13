import { describe, expect, it } from 'vitest'
import { DEBUG_SESSION_STATUSES } from '@shared/debug'
import { createTranslator } from '../i18n/messages'
import { debugStatusDetailKey, debugStatusKey } from './debugStatusLabels'

describe('debug status labels (Session 6-9)', () => {
  it('6つの状態すべてに、日本語と英語の言葉が付いている', () => {
    for (const language of ['ja', 'en'] as const) {
      const t = createTranslator(language)

      for (const status of DEBUG_SESSION_STATUSES) {
        expect(t(debugStatusKey(status))).not.toBe(debugStatusKey(status))
        expect(t(debugStatusDetailKey(status))).not.toBe(debugStatusDetailKey(status))
      }
    }
  })

  it('状態ごとに言い回しが重ならない（idle と stopped を同じ言葉にしない）', () => {
    for (const language of ['ja', 'en'] as const) {
      const t = createTranslator(language)
      const labels = DEBUG_SESSION_STATUSES.map((status) => t(debugStatusKey(status)))

      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  /** 内部の `stopped` は一時停止。「停止中 / Stopped」と書くと idle と取り違える。 */
  it('stopped は Paused / 一時停止 と読ませ、Stopped / 停止中 とは書かない', () => {
    const en = createTranslator('en')
    const ja = createTranslator('ja')

    expect(en(debugStatusKey('stopped'))).toBe('Debug: Paused')
    expect(ja(debugStatusKey('stopped'))).toBe('デバッグ: 一時停止中')

    for (const status of DEBUG_SESSION_STATUSES) {
      expect(en(debugStatusKey(status))).not.toMatch(/Stopped/)
      expect(ja(debugStatusKey(status))).not.toBe('デバッグ: 停止中')
    }
  })
})
