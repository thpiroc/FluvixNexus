import { describe, expect, it } from 'vitest'
import {
  AUTO_LAYOUT_PREFERENCE,
  chooseLayoutMode,
  resolveLayoutMode,
  suggestLayoutMode,
  type FilesLayoutMode
} from './filesLayoutMode'

/**
 * 表示方式の決め方（Session 3-6-7）。
 *
 * 確かめたいのは2つ。
 *   - **リサイズで利用者の選択が上書きされないこと**（explicit が提案に勝つ）
 *   - **境界の上で表示方式が往復しないこと**（しきい値の遊び）
 *
 * どちらも「壊れても失敗として現れない」種類のもので、実機では
 * 「なんとなく落ち着かない」としか見えない。ここで固定しておく。
 */

/** 縦長のパネル（左右にドックした状態）。 */
const TALL = { width: 260, height: 700 }

/** 横長のパネル（画面下部に置いた状態）。 */
const WIDE = { width: 900, height: 260 }

describe('suggestLayoutMode', () => {
  it('縦長ならツリーを勧める', () => {
    expect(suggestLayoutMode('tree', TALL)).toBe('tree')
    expect(suggestLayoutMode('columns', TALL)).toBe('tree')
  })

  it('横長ならカラムを勧める', () => {
    expect(suggestLayoutMode('tree', WIDE)).toBe('columns')
    expect(suggestLayoutMode('columns', WIDE)).toBe('columns')
  })

  /* 幅が広くても背が高ければ横長ではない（大きな正方形の領域）。 */
  it('幅が広くても縦横比が足りなければツリーのまま', () => {
    expect(suggestLayoutMode('tree', { width: 800, height: 700 })).toBe('tree')
  })

  /* 縦横比が横長でも、カラムを2枚並べられない幅では勧めない。 */
  it('縦横比が横長でも幅が足りなければツリーのまま', () => {
    expect(suggestLayoutMode('tree', { width: 380, height: 120 })).toBe('tree')
  })

  /*
    しきい値の遊び。切り替わる幅と戻る幅が同じだと、パネルの境界を掴んで
    動かしている間に表示方式が何度も入れ替わる。
  */
  it('境界の間では今の方を保つ（往復しない）', () => {
    const between = { width: 480, height: 240 }

    expect(suggestLayoutMode('tree', between)).toBe('tree')
    expect(suggestLayoutMode('columns', between)).toBe('columns')
  })

  it('縦横比にも遊びがある', () => {
    const between = { width: 600, height: 430 }

    expect(suggestLayoutMode('tree', between)).toBe('tree')
    expect(suggestLayoutMode('columns', between)).toBe('columns')
  })

  /* 描かれていない / 閉じている間は 0 で届く。「とても細い」と読まない。 */
  it('大きさが測れない間は今の方を据え置く', () => {
    expect(suggestLayoutMode('columns', { width: 0, height: 0 })).toBe('columns')
    expect(suggestLayoutMode('tree', { width: 0, height: 0 })).toBe('tree')
    expect(suggestLayoutMode('columns', { width: 900, height: 0 })).toBe('columns')
  })
})

describe('resolveLayoutMode', () => {
  it('選んでいなければパネルの形の提案に従う', () => {
    expect(resolveLayoutMode(AUTO_LAYOUT_PREFERENCE, 'columns')).toBe('columns')
    expect(resolveLayoutMode(AUTO_LAYOUT_PREFERENCE, 'tree')).toBe('tree')
  })

  /* ここが要点。リサイズし続けても、選んだ方は変わらない。 */
  it('選んでいれば提案より優先する', () => {
    const chosen = chooseLayoutMode('tree')

    expect(resolveLayoutMode(chosen, 'columns')).toBe('tree')
    expect(resolveLayoutMode(chosen, 'tree')).toBe('tree')
  })

  it('提案と同じ方を選んでも explicit になる（後の提案に流されない）', () => {
    const chosen = chooseLayoutMode('columns')

    expect(chosen).toEqual({ kind: 'explicit', mode: 'columns' })
    expect(resolveLayoutMode(chosen, 'tree')).toBe('columns')
  })
})

describe('リサイズを続けたとき', () => {
  /**
   * 縦長 → 横長 → 縦長と動かす間、選んでいなければ提案に従い、
   * 選んだ後は**一度も変わらない**こと。
   */
  it('選ぶまでは追従し、選んだ後は追従しない', () => {
    const sizes = [TALL, { width: 520, height: 300 }, WIDE, { width: 300, height: 300 }, TALL]

    let suggestion: FilesLayoutMode = 'tree'
    const auto: FilesLayoutMode[] = []

    for (const size of sizes) {
      suggestion = suggestLayoutMode(suggestion, size)
      auto.push(resolveLayoutMode(AUTO_LAYOUT_PREFERENCE, suggestion))
    }

    expect(auto).toEqual(['tree', 'columns', 'columns', 'tree', 'tree'])

    const chosen = chooseLayoutMode('columns')
    let explicitSuggestion: FilesLayoutMode = 'tree'
    const explicit: FilesLayoutMode[] = []

    for (const size of sizes) {
      explicitSuggestion = suggestLayoutMode(explicitSuggestion, size)
      explicit.push(resolveLayoutMode(chosen, explicitSuggestion))
    }

    expect(explicit).toEqual(['columns', 'columns', 'columns', 'columns', 'columns'])
  })
})
