import { describe, expect, it } from 'vitest'
import { DEBUG_EXCEPTION_BREAK_MODES, DEBUG_STOP_REASONS } from '@shared/debug'
import { createTranslator } from '../i18n/messages'
import {
  DEBUG_STOP_REASON_MESSAGE_KEYS,
  debugExceptionBreakModeMessageKey
} from './debugStopReasonLabels'

describe('debug stop reason labels', () => {
  it('has English and Japanese words for every stop reason, all distinct', () => {
    for (const language of ['en', 'ja'] as const) {
      const t = createTranslator(language)
      const words = DEBUG_STOP_REASONS.map((reason) => t(DEBUG_STOP_REASON_MESSAGE_KEYS[reason]))

      for (const word of words) {
        expect(word.length).toBeGreaterThan(0)
        expect(word).not.toContain('debug.stopReason')
      }

      expect(new Set(words).size).toBe(DEBUG_STOP_REASONS.length)
    }
  })

  it('uses the Session 6-9 wording (Paused / 一時停止中), never Stopped / 停止中 alone', () => {
    const en = createTranslator('en')
    const ja = createTranslator('ja')

    expect(en('debug.stopReason.breakpoint')).toBe('Paused at breakpoint')
    expect(en('debug.stopReason.step')).toBe('Paused after step')
    expect(en('debug.stopReason.pause')).toBe('Paused manually')
    expect(en('debug.stopReason.exception')).toBe('Paused on exception')

    for (const reason of DEBUG_STOP_REASONS) {
      expect(en(DEBUG_STOP_REASON_MESSAGE_KEYS[reason])).toMatch(/^Paused/)
      expect(en(DEBUG_STOP_REASON_MESSAGE_KEYS[reason])).not.toMatch(/Stopped/)
      expect(ja(DEBUG_STOP_REASON_MESSAGE_KEYS[reason])).toMatch(/一時停止中$/)
    }
  })

  it('words the break mode only when the adapter reported one that stops', () => {
    const en = createTranslator('en')

    expect(
      DEBUG_EXCEPTION_BREAK_MODES.map((mode) => debugExceptionBreakModeMessageKey(mode))
    ).toEqual([
      'debug.stopReason.breakModeAlways',
      'debug.stopReason.breakModeUnhandled',
      'debug.stopReason.breakModeUserUnhandled',
      null
    ])
    expect(debugExceptionBreakModeMessageKey(null)).toBeNull()
    expect(en('debug.stopReason.breakModeUnhandled')).toBe('Uncaught')
  })
})
