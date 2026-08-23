import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOutputCoalescer,
  TERMINAL_OUTPUT_FLUSH_INTERVAL_MS,
  TERMINAL_OUTPUT_FLUSH_LENGTH
} from './outputCoalescer'

/**
 * 出力を束ねる層（outputCoalescer.ts）。
 *
 * ファイル変更の通知と違い、**間引いてはいけない**のが要点にあたる。
 * 束ねた結果が元の連結と1文字も違わないことを、どの経路でも確かめる。
 */
describe('createOutputCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('届いた直後には送らない（束ねる）', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.push('a')
    coalescer.push('b')

    expect(emit).not.toHaveBeenCalled()
  })

  it('短い時間のうちに届いたものを1回にまとめて送る', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.push('a')
    coalescer.push('b')
    coalescer.push('c')

    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_INTERVAL_MS)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('abc')
  })

  it('送った後にまた届けば、次の束として送る', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.push('1')
    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_INTERVAL_MS)

    coalescer.push('2')
    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_INTERVAL_MS)

    expect(emit.mock.calls.map(([data]) => data)).toEqual(['1', '2'])
  })

  /*
    上限は「捨てる基準」ではなく「待たずに送る基準」。
    捨ててしまうと、消えた文字の分だけ画面が壊れる（取り戻す手段が無い）。
  */
  it('溜まった長さが上限を超えたら、時間を待たずに送る', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.push('x'.repeat(TERMINAL_OUTPUT_FLUSH_LENGTH))

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]?.[0]).toHaveLength(TERMINAL_OUTPUT_FLUSH_LENGTH)
  })

  it('大量に届いても1文字も落とさない', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    const chunks = Array.from({ length: 500 }, (_, index) => `${index}:`.repeat(100))

    for (const chunk of chunks) {
      coalescer.push(chunk)
    }

    coalescer.flush()

    const delivered = emit.mock.calls.map(([data]) => data as string).join('')

    expect(delivered).toBe(chunks.join(''))
  })

  it('flush で溜まっているものを今すぐ送る', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.push('tail')
    coalescer.flush()

    expect(emit).toHaveBeenCalledWith('tail')
  })

  it('溜まっていなければ flush で何も送らない', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.flush()

    expect(emit).not.toHaveBeenCalled()
  })

  /*
    利用者が閉じた画面へ最後の出力を送っても、受け取る器がもう無い。
    プロセスが自分から終わった場合だけは、その直前の出力に意味があるので
    呼び出し側が flush してから片付ける（terminalSessions.ts）。
  */
  it('dispose では溜まっているものを送らない', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.push('dropped')
    coalescer.dispose()

    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_INTERVAL_MS * 10)

    expect(emit).not.toHaveBeenCalled()
  })

  /*
    node-pty は kill の後にも最後の出力を渡してくることがある。
    来ないことを前提にしない。
  */
  it('dispose の後に届いたものを送らない', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.dispose()
    coalescer.push('late')
    coalescer.flush()

    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_INTERVAL_MS * 10)

    expect(emit).not.toHaveBeenCalled()
  })

  it('空の入力ではタイマーを起こさない', () => {
    const emit = vi.fn()
    const coalescer = createOutputCoalescer(emit)

    coalescer.push('')

    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_INTERVAL_MS * 10)

    expect(emit).not.toHaveBeenCalled()
  })
})
