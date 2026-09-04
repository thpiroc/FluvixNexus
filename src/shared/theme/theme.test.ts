import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_ID,
  fromThemeArguments,
  isThemeId,
  normalizeThemeId,
  THEME_ARGUMENT_PREFIX,
  THEME_ATTRIBUTE,
  THEME_IDS,
  THEME_WINDOW_BACKGROUND,
  toThemeArgument
} from './theme'

/**
 * Theme の名前と、起動時に3層を通る経路（Session 4-4）。
 *
 * 確かめたいのは2つ。
 *
 *   - **知らない値が必ず Dark へ落ちること。** 保存ファイルを手で書き換えた場合も、
 *     アプリをダウングレードした場合も、落ちる先が1つに決まっている
 *   - **Main → Preload の受け渡しが往復すること。** ここがずれると、
 *     「起動直後は Dark、読み込み後に Light」という一瞬が戻ってくる
 */

describe('Theme の名前', () => {
  it('選べるのは Dark と Light の2つだけ（v1）', () => {
    expect(THEME_IDS).toEqual(['dark', 'light'])
  })

  it('既定は Dark', () => {
    expect(DEFAULT_THEME_ID).toBe('dark')
  })

  it('既知の名前だけを受け入れる', () => {
    expect(isThemeId('dark')).toBe(true)
    expect(isThemeId('light')).toBe(true)
    // System（OS 追従）は Theme の名前ではなく選び方なので、この集合に入らない。
    expect(isThemeId('system')).toBe(false)
    expect(isThemeId('')).toBe(false)
    expect(isThemeId(null)).toBe(false)
    expect(isThemeId(3)).toBe(false)
  })
})

describe('normalizeThemeId', () => {
  it('既知の名前はそのまま', () => {
    expect(normalizeThemeId('dark')).toBe('dark')
    expect(normalizeThemeId('light')).toBe('light')
  })

  /*
    アプリをダウングレードした場合（後の版が足した Theme が保存されている）と、
    保存ファイルを手で直した場合。**どちらも Dark**で、無色の画面にはならない。
  */
  it('知らない値はすべて Dark へ落ちる', () => {
    for (const value of ['solarized', 'system', 'DARK', '', null, undefined, 3, {}, []]) {
      expect(normalizeThemeId(value)).toBe('dark')
    }
  })
})

describe('Main → Preload の受け渡し', () => {
  it('組み立てて読み取ると、同じ Theme に戻る', () => {
    for (const theme of THEME_IDS) {
      expect(fromThemeArguments([toThemeArgument(theme)])).toBe(theme)
    }
  })

  it('引数の並びのどこにあっても見つかる', () => {
    expect(fromThemeArguments(['--a', '--b', toThemeArgument('light'), '--c'])).toBe('light')
  })

  it('渡って来なければ Dark（Preload が引数を受け取れなかった場合）', () => {
    expect(fromThemeArguments([])).toBe('dark')
    expect(fromThemeArguments(['--enable-features=X', '--fx-other=light'])).toBe('dark')
  })

  it('知らない Theme 名が渡ってきても Dark', () => {
    expect(fromThemeArguments([`${THEME_ARGUMENT_PREFIX}solarized`])).toBe('dark')
    expect(fromThemeArguments([THEME_ARGUMENT_PREFIX])).toBe('dark')
  })
})

describe('初期描画用の値', () => {
  /*
    CSS が1行も評価されていない時点で要る2色。`theme.css` の
    `--fx-color-app-bg` と一致することは styles/themeCss.test.ts が見張る
    （ここでは「両方の Theme に色があること」だけを確かめる）。
  */
  it('すべての Theme に窓の初期色がある', () => {
    for (const theme of THEME_IDS) {
      expect(THEME_WINDOW_BACKGROUND[theme]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('Theme ごとに違う色', () => {
    expect(THEME_WINDOW_BACKGROUND.dark).not.toBe(THEME_WINDOW_BACKGROUND.light)
  })

  /* Preload と Renderer と CSS が同じ綴りを使う（名前は1箇所で持つ）。 */
  it('属性の名前は data-fx-theme', () => {
    expect(THEME_ATTRIBUTE).toBe('data-fx-theme')
  })
})
