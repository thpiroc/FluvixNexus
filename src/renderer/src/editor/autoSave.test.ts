import { describe, expect, it } from 'vitest'
import { EDITOR_SETTINGS_SCHEMA_VERSION } from '@shared/settings'
import {
  AUTO_SAVE_DELAY_MAX_MS,
  AUTO_SAVE_DELAY_MIN_MS,
  AUTO_SAVE_MODES,
  DEFAULT_AUTO_SAVE_SETTINGS,
  isSameAutoSaveSettings,
  normalizeAutoSaveSettings,
  toAutoSaveSettings,
  toEditorSettingsDocument
} from './autoSave'

describe('Auto Save の既定', () => {
  it('必ず OFF で始まる', () => {
    // 自動保存を既定で入れると、眺めていただけの操作がディスクに残る。
    expect(DEFAULT_AUTO_SAVE_SETTINGS.mode).toBe('off')
  })

  it('4つの mode がすべて選べる（Session 3-5 で出揃った）', () => {
    expect(AUTO_SAVE_MODES).toEqual(['off', 'afterDelay', 'onFocusChange', 'onWindowChange'])
  })
})

describe('normalizeAutoSaveSettings', () => {
  it('どの mode もそのまま通す', () => {
    for (const mode of AUTO_SAVE_MODES) {
      expect(normalizeAutoSaveSettings({ mode, delayMs: 2000 })).toEqual({ mode, delayMs: 2000 })
    }
  })

  it('知らない mode・壊れた値は既定へ落とす', () => {
    for (const raw of [null, undefined, 42, 'afterDelay', [], { mode: 'always' }, {}]) {
      expect(normalizeAutoSaveSettings(raw).mode).toBe('off')
    }
  })

  it('待ち時間は上下限で頭打ちにする', () => {
    expect(normalizeAutoSaveSettings({ mode: 'afterDelay', delayMs: 0 }).delayMs).toBe(
      AUTO_SAVE_DELAY_MIN_MS
    )
    expect(normalizeAutoSaveSettings({ mode: 'afterDelay', delayMs: -5 }).delayMs).toBe(
      AUTO_SAVE_DELAY_MIN_MS
    )
    expect(normalizeAutoSaveSettings({ mode: 'afterDelay', delayMs: 10 ** 9 }).delayMs).toBe(
      AUTO_SAVE_DELAY_MAX_MS
    )
  })

  it('待ち時間が数値でなければ既定の待ち時間になる', () => {
    for (const delayMs of [null, '1000', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeAutoSaveSettings({ mode: 'afterDelay', delayMs }).delayMs).toBe(
        DEFAULT_AUTO_SAVE_SETTINGS.delayMs
      )
    }
  })

  it('待ち時間は整数へ丸める', () => {
    expect(normalizeAutoSaveSettings({ mode: 'afterDelay', delayMs: 1500.7 }).delayMs).toBe(1501)
  })
})

/*
  保存形式との往復（Session 3-5）。

  ここが崩れると「設定したのに再起動で戻る」が起きる。
  保存形式そのものの検証（後で読める形か）は Main 側
  （src/main/store/editorSettingsDocument.test.ts）の担当。
*/
describe('保存形式との変換', () => {
  it('保存して読み直すと同じ設定になる', () => {
    for (const mode of AUTO_SAVE_MODES) {
      const settings = normalizeAutoSaveSettings({ mode, delayMs: 3000 })

      expect(toAutoSaveSettings(toEditorSettingsDocument(settings))).toEqual(settings)
    }
  })

  it('保存する文書は今の schemaVersion を持つ', () => {
    expect(toEditorSettingsDocument(DEFAULT_AUTO_SAVE_SETTINGS).schemaVersion).toBe(
      EDITOR_SETTINGS_SCHEMA_VERSION
    )
  })

  it('mode を切り替えても待ち時間は保たれる', () => {
    const settings = normalizeAutoSaveSettings({ mode: 'afterDelay', delayMs: 5000 })
    const switched = normalizeAutoSaveSettings({ ...settings, mode: 'off' })

    expect(toAutoSaveSettings(toEditorSettingsDocument(switched)).delayMs).toBe(5000)
  })

  // 保存が無い / 読めない場合は既定（OFF）で始める。
  it('保存が無ければ既定になる', () => {
    expect(toAutoSaveSettings(null)).toEqual(DEFAULT_AUTO_SAVE_SETTINGS)
  })

  it('知らない mode が保存されていても既定へ落ちる（ダウングレード）', () => {
    expect(
      toAutoSaveSettings({
        schemaVersion: EDITOR_SETTINGS_SCHEMA_VERSION,
        autoSave: { mode: 'onSomethingNew', delayMs: 1000 }
      }).mode
    ).toBe('off')
  })
})

describe('isSameAutoSaveSettings', () => {
  it('同じ内容なら true（保存を予約しないための判断）', () => {
    expect(
      isSameAutoSaveSettings({ mode: 'off', delayMs: 1000 }, { mode: 'off', delayMs: 1000 })
    ).toBe(true)
  })

  it('mode か待ち時間が違えば false', () => {
    expect(
      isSameAutoSaveSettings({ mode: 'off', delayMs: 1000 }, { mode: 'afterDelay', delayMs: 1000 })
    ).toBe(false)
    expect(
      isSameAutoSaveSettings({ mode: 'off', delayMs: 1000 }, { mode: 'off', delayMs: 2000 })
    ).toBe(false)
  })
})
