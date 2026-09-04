import { describe, expect, it } from 'vitest'
import { SETTINGS_TEXT_MAX_LENGTH } from '@shared/settings'
import { parseSettingsSectionUpdate, parseStoredSection } from './settingsSections'

/**
 * section 1つ分の検証（Main が見る範囲。Session 4-3A）。
 *
 * Main が見るのは「**後で解釈できる形か**」までで、mode として意味があるかは見ない
 * （それは Renderer の editor/autoSave.ts など）。Session 3-5 からの分担で、
 * 二重に解釈すると「どちらが正しいか」が生まれる。
 *
 * 確かめたいのは3つ。
 *   - **1つの key が壊れても、他の key は残ること**（旧形式はここで全部失っていた）
 *   - **知らない key が書き戻せる形で残ること**（新しい版で足した設定を消さない）
 *   - **Renderer からは既知の section・既知の key しか保存できないこと**
 */

describe('parseStoredSection（ファイルから読む）', () => {
  it('正しい section はそのまま通す', () => {
    const parsed = parseStoredSection('editor', {
      autoSaveMode: 'afterDelay',
      autoSaveDelayMs: 1000
    })

    expect(parsed.value).toEqual({ autoSaveMode: 'afterDelay', autoSaveDelayMs: 1000 })
    expect(parsed.readable).toBe(true)
  })

  /*
    知らない mode は失敗にしない。アプリをダウングレードすると起きるもので、
    「設定ファイルが壊れている」わけではない。既定へ落とすのは読む側の判断。
  */
  it('知らない mode でも、文字列なら通す（意味は Renderer が決める）', () => {
    expect(parseStoredSection('editor', { autoSaveMode: 'onSomethingNew' }).value).toEqual({
      autoSaveMode: 'onSomethingNew'
    })
  })

  /*
    上下限（200ms〜60s、8〜32px …）は Renderer が掛ける。
    Main が見るのは「数として読めるか」だけ。
  */
  it('上下限の外の数でも、数なら通す', () => {
    expect(parseStoredSection('terminal', { fontSize: 9999, scrollback: -1 }).value).toEqual({
      fontSize: 9999,
      scrollback: -1
    })
  })

  it('key が無いのは正常（＝既定）。落とした扱いにしない', () => {
    const parsed = parseStoredSection('files', { viewMode: 'tree' })

    expect(parsed.value).toEqual({ viewMode: 'tree' })
    expect(parsed.droppedFields).toEqual([])
  })

  /*
    ここが Session 4-3A の要点。旧形式（入れ子）では `view` が object でない、
    あるいは片方の型が違うだけで、その用途の設定が丸ごと既定へ戻っていた。
  */
  it('読めない key だけを落とし、他の key は残す', () => {
    const parsed = parseStoredSection('terminal', { fontSize: 'big', scrollback: 9000 })

    expect(parsed.value).toEqual({ scrollback: 9000 })
    expect(parsed.droppedFields).toEqual(['fontSize'])
  })

  it('数として読めない値（NaN / Infinity / 文字列）は落とす', () => {
    for (const fontSize of [Number.NaN, Number.POSITIVE_INFINITY, '13', null, {}, []]) {
      expect(parseStoredSection('terminal', { fontSize, scrollback: 5000 }).value).toEqual({
        scrollback: 5000
      })
    }
  })

  it('文字列でない mode は落とす', () => {
    for (const viewMode of [42, null, {}, [], true]) {
      expect(parseStoredSection('files', { viewMode, columnWidth: 208 }).value).toEqual({
        columnWidth: 208
      })
    }
  })

  it('桁違いに長い文字列は落とす（その key だけ）', () => {
    const parsed = parseStoredSection('editor', {
      autoSaveMode: 'x'.repeat(SETTINGS_TEXT_MAX_LENGTH + 1),
      autoSaveDelayMs: 1000
    })

    expect(parsed.value).toEqual({ autoSaveDelayMs: 1000 })
  })

  it('知らない key は値から外し、書き戻すために持つ', () => {
    const parsed = parseStoredSection('editor', {
      autoSaveMode: 'off',
      formatOnSave: true,
      fontFamily: 'Consolas'
    })

    expect(parsed.value).toEqual({ autoSaveMode: 'off' })
    expect(parsed.unknownFields).toEqual({ formatOnSave: true, fontFamily: 'Consolas' })
  })

  it('桁違いに大きな知らない key は持ち回さない', () => {
    const parsed = parseStoredSection('editor', { huge: 'x'.repeat(8192) })

    expect(parsed.unknownFields).toEqual({})
  })

  it('section が object でなければ空（他の section には関わらない）', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      const parsed = parseStoredSection('files', raw)

      expect(parsed.value).toEqual({})
      expect(parsed.readable).toBe(false)
    }
  })
})

describe('parseSettingsSectionUpdate（Renderer からの保存要求）', () => {
  it('既知の section と key なら通す', () => {
    expect(
      parseSettingsSectionUpdate({ section: 'terminal', value: { fontSize: 15, scrollback: 7000 } })
    ).toEqual({ section: 'terminal', value: { fontSize: 15, scrollback: 7000 } })
  })

  it('key が一部だけでも通す（無い key ＝ 既定）', () => {
    expect(parseSettingsSectionUpdate({ section: 'files', value: { viewMode: 'tree' } })).toEqual({
      section: 'files',
      value: { viewMode: 'tree' }
    })
  })

  /*
    **任意の section 名を受け付けない。** ここを許すと「アプリの設定」という限定が
    消え、Renderer が好きな内容をディスクへ残せる場所になる。
  */
  it('知らない section は拒む', () => {
    // `appearance` は Session 4-4 で既知になったので、ここからは外れている。
    for (const section of ['keybindings', 'git', '__proto__', '', 42, null, undefined]) {
      expect(parseSettingsSectionUpdate({ section, value: {} })).toBeNull()
    }
  })

  /*
    Session 4-4 で足した section。**Main は文字列であることしか見ない** ──
    `dark` / `light` のどちらかであるかを決めるのは Renderer で、
    アプリをダウングレードすれば知らない Theme 名が届くことも普通に起こりうる。
  */
  it('appearance.theme は文字列として通り、意味は見ない', () => {
    expect(
      parseSettingsSectionUpdate({ section: 'appearance', value: { theme: 'light' } })
    ).toEqual({ section: 'appearance', value: { theme: 'light' } })

    expect(
      parseSettingsSectionUpdate({ section: 'appearance', value: { theme: 'solarized' } })
    ).toEqual({ section: 'appearance', value: { theme: 'solarized' } })
  })

  it('appearance.theme が文字列でなければ、要求ごと拒む', () => {
    for (const theme of [42, null, true, {}, []]) {
      expect(parseSettingsSectionUpdate({ section: 'appearance', value: { theme } })).toBeNull()
    }
  })

  it('要求そのものが object でなければ拒む', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      expect(parseSettingsSectionUpdate(raw)).toBeNull()
    }
  })

  it('value が object でなければ拒む', () => {
    for (const value of [null, undefined, 42, 'x', [], true]) {
      expect(parseSettingsSectionUpdate({ section: 'editor', value })).toBeNull()
    }
  })

  /*
    ファイルから読むときと違い、**保存要求では黙って落とさない。**
    読めない値が届くのは Renderer 側の不具合で、静かに消えると気づけない。
  */
  it('既知の key が読めない形なら、要求ごと拒む', () => {
    expect(
      parseSettingsSectionUpdate({ section: 'terminal', value: { fontSize: 'big' } })
    ).toBeNull()

    expect(
      parseSettingsSectionUpdate({ section: 'editor', value: { autoSaveDelayMs: Number.NaN } })
    ).toBeNull()
  })

  it('知らない key は保存しない（任意 key の保存経路を作らない）', () => {
    expect(
      parseSettingsSectionUpdate({
        section: 'editor',
        value: { autoSaveMode: 'off', languageServerPath: 'C:/evil.exe' }
      })
    ).toEqual({ section: 'editor', value: { autoSaveMode: 'off' } })
  })
})
