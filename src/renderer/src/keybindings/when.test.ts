import { describe, expect, it } from 'vitest'
import {
  emptyWhenContext,
  isWhenKey,
  matchesWhen,
  parseWhenClause,
  WHEN_KEYS,
  whenOverlaps,
  type WhenContext
} from './when'

function context(overrides: Partial<WhenContext> = {}): WhenContext {
  return { ...emptyWhenContext(), ...overrides }
}

describe('WHEN_KEYS', () => {
  it('同じ名前を2つ持たない', () => {
    expect(new Set(WHEN_KEYS).size).toBe(WHEN_KEYS.length)
  })

  it('emptyWhenContext がすべての条件を持つ（欠けた条件を作らない）', () => {
    const base = emptyWhenContext()

    for (const key of WHEN_KEYS) {
      expect(base[key]).toBe(false)
    }

    expect(Object.keys(base).sort()).toEqual([...WHEN_KEYS].sort())
  })
})

describe('isWhenKey', () => {
  it('既知の条件だけを通す', () => {
    expect(isWhenKey('editorFocused')).toBe(true)
    expect(isWhenKey('gitRepositoryAvailable')).toBe(false)
    expect(isWhenKey('')).toBe(false)
    expect(isWhenKey(null)).toBe(false)
  })
})

describe('parseWhenClause', () => {
  it('肯定と否定を読む', () => {
    expect(parseWhenClause('editorFocused')).toEqual({ key: 'editorFocused', negated: false })
    expect(parseWhenClause('!editorFocused')).toEqual({ key: 'editorFocused', negated: true })
  })

  it('知らない条件は null', () => {
    expect(parseWhenClause('editorFloating')).toBeNull()
    expect(parseWhenClause('!editorFloating')).toBeNull()
    expect(parseWhenClause('!')).toBeNull()
  })
})

describe('matchesWhen', () => {
  it('条件が無ければ常に通る', () => {
    expect(matchesWhen(undefined, context())).toBe(true)
    expect(matchesWhen([], context())).toBe(true)
  })

  it('肯定は、その条件が成り立つときだけ通る', () => {
    expect(matchesWhen(['editorFocused'], context({ editorFocused: true }))).toBe(true)
    expect(matchesWhen(['editorFocused'], context({ editorFocused: false }))).toBe(false)
  })

  it('否定は、その条件が成り立たないときだけ通る', () => {
    expect(matchesWhen(['!terminalFocused'], context({ terminalFocused: false }))).toBe(true)
    expect(matchesWhen(['!terminalFocused'], context({ terminalFocused: true }))).toBe(false)
  })

  it('並べたものは AND', () => {
    const when = ['!terminalFocused', '!settingsOpen']

    expect(matchesWhen(when, context())).toBe(true)
    expect(matchesWhen(when, context({ terminalFocused: true }))).toBe(false)
    expect(matchesWhen(when, context({ settingsOpen: true }))).toBe(false)
    expect(matchesWhen(when, context({ terminalFocused: true, settingsOpen: true }))).toBe(false)
  })

  it('読めない条件があれば通さない（fail-closed）', () => {
    /*
      逆にすると、綴りを間違えた条件を持つ rule が「条件が無いのと同じ」＝
      どこでも効く、という正反対の壊れ方をする（when.ts の `matchesWhen`）。
    */
    expect(matchesWhen(['editorFloating'], context())).toBe(false)
    expect(matchesWhen(['editorFocused', 'editorFloating'], context({ editorFocused: true }))).toBe(
      false
    )
  })
})

describe('whenOverlaps', () => {
  it('条件が無いものは何とでも重なる', () => {
    expect(whenOverlaps(undefined, ['editorFocused'])).toBe(true)
    expect(whenOverlaps([], [])).toBe(true)
  })

  it('同じ条件どうしは重なる', () => {
    expect(whenOverlaps(['editorFocused'], ['editorFocused'])).toBe(true)
  })

  it('両立しない条件を1つでも持てば重ならない', () => {
    // 「Terminal に focus があるとき」と「無いとき」は同時に起きない。
    expect(whenOverlaps(['terminalFocused'], ['!terminalFocused'])).toBe(false)
    expect(
      whenOverlaps(['editorFocused', 'terminalFocused'], ['editorFocused', '!terminalFocused'])
    ).toBe(false)
  })

  it('別々の条件どうしは重なりうる', () => {
    // workspace が開いていて、かつ Editor に focus がある、はありうる。
    expect(whenOverlaps(['workspaceOpen'], ['editorFocused'])).toBe(true)
  })

  it('読めない条件は「重なりうる」側へ倒す（見逃さない）', () => {
    expect(whenOverlaps(['editorFloating'], ['editorFocused'])).toBe(true)
  })
})
