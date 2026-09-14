import { describe, expect, it } from 'vitest'
import {
  createSetBreakpointsArguments,
  DAP_BREAKPOINT_MESSAGE_MAX_LENGTH,
  parseBreakpointEvent,
  parseSetBreakpointsResponse
} from './dapBreakpoints'

const SOURCE = { path: 'D:\\proj\\src\\app.js', name: 'app.js' }

describe('setBreakpoints の要求の形', () => {
  it('breakpoints と lines の両方を載せる', () => {
    const args = createSetBreakpointsArguments(SOURCE, [3, 10])

    expect(args).toEqual({
      source: SOURCE,
      breakpoints: [{ line: 3 }, { line: 10 }],
      lines: [3, 10],
      sourceModified: false
    })
  })

  /* 最後の1件を外したときは、空の配列を送って adapter 側の印を消す。 */
  it('空の一覧も送れる', () => {
    const args = createSetBreakpointsArguments(SOURCE, [])

    expect(args.breakpoints).toEqual([])
    expect(args.lines).toEqual([])
  })

  /*
    未保存の編集があっても true にしない。true にすると adapter によっては
    一切 verify しなくなり、印がすべて灰色になる（dapBreakpoints.ts の冒頭）。
  */
  it('sourceModified は常に false', () => {
    expect(createSetBreakpointsArguments(SOURCE, [1]).sourceModified).toBe(false)
  })
})

describe('breakpoint event の読み取り', () => {
  it('後から届く verified と source path を読む', () => {
    expect(
      parseBreakpointEvent({
        reason: 'changed',
        breakpoint: {
          verified: true,
          line: 11,
          source: { path: 'D:\\proj\\Program.cs', name: 'Program.cs' }
        }
      })
    ).toEqual({
      sourcePath: 'D:\\proj\\Program.cs',
      verification: { verified: true, line: 11, message: null }
    })
  })

  it('adapter の文言は setBreakpoints 応答と同じ上限で切る', () => {
    const parsed = parseBreakpointEvent({
      reason: 'changed',
      breakpoint: {
        verified: false,
        message: 'x'.repeat(2000),
        source: { path: 'D:\\proj\\Program.cs' }
      }
    })

    expect(parsed?.verification.message?.length).toBe(DAP_BREAKPOINT_MESSAGE_MAX_LENGTH + 3)
  })

  it('removed と壊れた event は読まない', () => {
    expect(
      parseBreakpointEvent({
        reason: 'removed',
        breakpoint: { verified: true, source: { path: 'D:\\proj\\Program.cs' } }
      })
    ).toBeNull()
    expect(parseBreakpointEvent({ breakpoint: { line: 11 } })).toBeNull()
  })

  it('source path が無い場合も verification は読める', () => {
    expect(
      parseBreakpointEvent({
        reason: 'changed',
        breakpoint: { verified: true, line: 11 }
      })
    ).toEqual({
      sourcePath: null,
      verification: { verified: true, line: 11, message: null }
    })
  })
})

describe('setBreakpoints の応答の読み取り', () => {
  it('verified を読む', () => {
    expect(parseSetBreakpointsResponse({ breakpoints: [{ verified: true }] }, 1)).toEqual([
      { verified: true, line: null, message: null }
    ])
  })

  it('adapter が返した行と文言を読む', () => {
    expect(
      parseSetBreakpointsResponse(
        { breakpoints: [{ verified: false, line: 12, message: 'no code here' }] },
        1
      )
    ).toEqual([{ verified: false, line: 12, message: 'no code here' }])
  })

  it('複数件を送った順で返す', () => {
    expect(
      parseSetBreakpointsResponse(
        { breakpoints: [{ verified: true }, { verified: false }, { verified: true }] },
        3
      )
    ).toEqual([
      { verified: true, line: null, message: null },
      { verified: false, line: null, message: null },
      { verified: true, line: null, message: null }
    ])
  })

  it('送った数より少ない答えは、足りない分を null にする', () => {
    expect(parseSetBreakpointsResponse({ breakpoints: [{ verified: true }] }, 3)).toEqual([
      { verified: true, line: null, message: null },
      null,
      null
    ])
  })

  it('送った数より多い答えは、送った分だけを読む', () => {
    expect(
      parseSetBreakpointsResponse({ breakpoints: [{ verified: true }, { verified: false }] }, 1)
    ).toEqual([{ verified: true, line: null, message: null }])
  })

  /* 仕様上 `verified` は必須だが、省く adapter が実在する。省略は失敗ではない。 */
  it('verified を持たない要素は「分からない」', () => {
    expect(parseSetBreakpointsResponse({ breakpoints: [{ line: 3 }] }, 1)).toEqual([null])
  })

  it.each([
    null,
    undefined,
    42,
    'breakpoints',
    {},
    { breakpoints: null },
    { breakpoints: 'nope' },
    []
  ])('読めない応答は null: %s', (body) => {
    expect(parseSetBreakpointsResponse(body, 1)).toBeNull()
  })

  it('空の一覧を送った場合は空を返す（null にしない）', () => {
    expect(parseSetBreakpointsResponse({ breakpoints: [] }, 0)).toEqual([])
  })

  it('桁違いに長い文言は切る', () => {
    const parsed = parseSetBreakpointsResponse(
      { breakpoints: [{ verified: false, message: 'x'.repeat(2000) }] },
      1
    )

    expect(parsed?.[0]?.message?.length).toBe(DAP_BREAKPOINT_MESSAGE_MAX_LENGTH + 3)
  })

  it('行として読めない値は落とす', () => {
    expect(parseSetBreakpointsResponse({ breakpoints: [{ verified: true, line: 0 }] }, 1)).toEqual([
      { verified: true, line: null, message: null }
    ])
    expect(
      parseSetBreakpointsResponse({ breakpoints: [{ verified: true, line: '3' }] }, 1)
    ).toEqual([{ verified: true, line: null, message: null }])
  })
})
