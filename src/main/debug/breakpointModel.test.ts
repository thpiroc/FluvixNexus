import { describe, expect, it } from 'vitest'
import { DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE } from '@shared/debug'
import {
  applyDebugBreakpointVerification,
  clearDebugBreakpointVerification,
  createDebugBreakpointRecord,
  listDebugBreakpointPaths,
  normalizeDebugBreakpointRecords,
  toDebugBreakpointLines,
  toDebugBreakpoints,
  toggleDebugBreakpointRecord,
  toStoredDebugBreakpoints,
  type DebugBreakpointRecord
} from './breakpointModel'

function records(...entries: readonly (readonly [string, number])[]): DebugBreakpointRecord[] {
  return entries.map(([relativePath, line]) => createDebugBreakpointRecord(relativePath, line))
}

describe('入れ替え', () => {
  it('無ければ付ける', () => {
    const outcome = toggleDebugBreakpointRecord([], 'src/a.ts', 3)

    expect(outcome.status).toBe('added')

    if (outcome.status !== 'added') {
      return
    }

    expect(outcome.records).toEqual(records(['src/a.ts', 3]))
  })

  it('あれば外す', () => {
    const outcome = toggleDebugBreakpointRecord(records(['src/a.ts', 3]), 'src/a.ts', 3)

    expect(outcome.status).toBe('removed')

    if (outcome.status !== 'removed') {
      return
    }

    expect(outcome.records).toEqual([])
  })

  /* 同じ位置が2つ並ぶ形を作らない（重複は「入れ替え」で閉じる）。 */
  it('同じ位置を続けて押しても増えない', () => {
    let current: readonly DebugBreakpointRecord[] = []

    for (let count = 0; count < 5; count += 1) {
      const outcome = toggleDebugBreakpointRecord(current, 'src/a.ts', 7)

      expect(outcome.status === 'added' || outcome.status === 'removed').toBe(true)

      if (outcome.status === 'added' || outcome.status === 'removed') {
        current = outcome.records
      }
    }

    expect(current).toHaveLength(1)
  })

  it('別のファイルの同じ行は別の1件になる', () => {
    const first = toggleDebugBreakpointRecord([], 'src/a.ts', 3)
    const second =
      first.status === 'added' ? toggleDebugBreakpointRecord(first.records, 'src/b.ts', 3) : first

    expect(second.status === 'added' ? second.records : []).toHaveLength(2)
  })

  it('相対位置 → 行の順に並ぶ', () => {
    const added = [
      ['src/b.ts', 1],
      ['src/a.ts', 20],
      ['src/a.ts', 2]
    ] as const

    let current: readonly DebugBreakpointRecord[] = []

    for (const [relativePath, line] of added) {
      const outcome = toggleDebugBreakpointRecord(current, relativePath, line)

      if (outcome.status === 'added') {
        current = outcome.records
      }
    }

    expect(current.map((record) => `${record.relativePath}:${String(record.line)}`)).toEqual([
      'src/a.ts:2',
      'src/a.ts:20',
      'src/b.ts:1'
    ])
  })
})

describe('行の検証', () => {
  it.each([0, -1, 1.5, Number.NaN, '3', null, undefined])('行として受け取らない: %s', (line) => {
    expect(toggleDebugBreakpointRecord([], 'src/a.ts', line).status).toBe('invalid-line')
  })

  it('上限に達したら断る', () => {
    const full = Array.from({ length: DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE }, (_unused, index) =>
      createDebugBreakpointRecord('src/a.ts', index + 1)
    )

    expect(toggleDebugBreakpointRecord(full, 'src/b.ts', 1).status).toBe('limit-reached')
  })

  /* 上限に達していても、既にあるものを外すのは通る（行き止まりを作らない）。 */
  it('上限に達していても外せる', () => {
    const full = Array.from({ length: DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE }, (_unused, index) =>
      createDebugBreakpointRecord('src/a.ts', index + 1)
    )

    expect(toggleDebugBreakpointRecord(full, 'src/a.ts', 1).status).toBe('removed')
  })
})

describe('読み直しの正規化', () => {
  it('重複を畳んで並べる', () => {
    const normalized = normalizeDebugBreakpointRecords([
      createDebugBreakpointRecord('src/b.ts', 1),
      createDebugBreakpointRecord('src/a.ts', 5),
      createDebugBreakpointRecord('src/a.ts', 5)
    ])

    expect(normalized.map((record) => `${record.relativePath}:${String(record.line)}`)).toEqual([
      'src/a.ts:5',
      'src/b.ts:1'
    ])
  })

  it('上限で切る', () => {
    const many = Array.from(
      { length: DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE + 20 },
      (_unused, index) => createDebugBreakpointRecord('src/a.ts', index + 1)
    )

    expect(normalizeDebugBreakpointRecords(many)).toHaveLength(DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE)
  })
})

describe('外へ出す形', () => {
  const record: DebugBreakpointRecord = {
    relativePath: 'src/a.ts',
    line: 3,
    enabled: true,
    verified: true,
    adapterLine: 4,
    message: 'D:\\proj\\src\\a.ts has no executable code on line 3.'
  }

  /*
    Renderer へ返す形に adapter の文言も、動かされた行も載らない
    （docs/ARCHITECTURE.md §20.12）。文言は絶対パスを含みうる。
  */
  it('Renderer へは4欄だけを返す', () => {
    expect(toDebugBreakpoints([record])).toEqual([
      { relativePath: 'src/a.ts', line: 3, enabled: true, verified: true }
    ])
  })

  it('保存するのは3欄だけ（adapter の答えは保存しない）', () => {
    expect(toStoredDebugBreakpoints([record])).toEqual([
      { relativePath: 'src/a.ts', line: 3, enabled: true }
    ])
  })

  it('adapter へ送るのは有効なものだけ', () => {
    const mixed: readonly DebugBreakpointRecord[] = [
      { ...createDebugBreakpointRecord('src/a.ts', 10), enabled: false },
      createDebugBreakpointRecord('src/a.ts', 2),
      createDebugBreakpointRecord('src/b.ts', 1)
    ]

    expect(toDebugBreakpointLines(mixed, 'src/a.ts')).toEqual([2])
    expect(listDebugBreakpointPaths(mixed)).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

describe('adapter の答え', () => {
  const current = records(['src/a.ts', 2], ['src/a.ts', 5], ['src/b.ts', 1])

  it('送った順に当てる', () => {
    const applied = applyDebugBreakpointVerification(
      current,
      'src/a.ts',
      [2, 5],
      [
        { verified: true, line: null, message: null },
        { verified: false, line: null, message: 'no code here' }
      ]
    )

    expect(applied.map((record) => record.verified)).toEqual([true, false, null])
    expect(applied[1]?.message).toBe('no code here')
  })

  it('adapter が動かした行を控える（印の行は動かさない）', () => {
    const applied = applyDebugBreakpointVerification(
      current,
      'src/a.ts',
      [2],
      [{ verified: true, line: 3, message: null }]
    )

    expect(applied[0]?.line).toBe(2)
    expect(applied[0]?.adapterLine).toBe(3)
  })

  it('同じ行を答えた場合は動かされていないものとして扱う', () => {
    const applied = applyDebugBreakpointVerification(
      current,
      'src/a.ts',
      [2],
      [{ verified: true, line: 2, message: null }]
    )

    expect(applied[0]?.adapterLine).toBeNull()
  })

  /* 数が合わないという理由で、正しく答えられている前半まで捨てない。 */
  it('答えが足りない分は「まだ分からない」に落とす', () => {
    const applied = applyDebugBreakpointVerification(
      current,
      'src/a.ts',
      [2, 5],
      [{ verified: true, line: null, message: null }]
    )

    expect(applied.map((record) => record.verified)).toEqual([true, null, null])
  })

  it('答えが無ければ、そのファイルの分だけを「まだ分からない」に戻す', () => {
    const answered = applyDebugBreakpointVerification(
      current,
      'src/a.ts',
      [2, 5],
      [
        { verified: true, line: null, message: null },
        { verified: true, line: null, message: null }
      ]
    )

    const cleared = applyDebugBreakpointVerification(answered, 'src/a.ts', [2, 5], null)

    expect(cleared.map((record) => record.verified)).toEqual([null, null, null])
  })

  it('他のファイルの控えには触れない', () => {
    const applied = applyDebugBreakpointVerification(
      current,
      'src/b.ts',
      [1],
      [{ verified: true, line: null, message: null }]
    )

    expect(applied.map((record) => record.verified)).toEqual([null, null, true])
  })

  /*
    verified は「今動いている adapter がどう答えたか」であって breakpoint の
    性質ではない。セッションが終われば忘れる。
  */
  it('セッションが終われば忘れる', () => {
    const answered = applyDebugBreakpointVerification(
      current,
      'src/a.ts',
      [2],
      [{ verified: true, line: 3, message: 'moved' }]
    )

    const cleared = clearDebugBreakpointVerification(answered)

    expect(cleared.map((record) => record.verified)).toEqual([null, null, null])
    expect(cleared.map((record) => record.adapterLine)).toEqual([null, null, null])
    expect(cleared.map((record) => record.message)).toEqual([null, null, null])
  })

  /* 忘れるものが無ければ同じ配列を返す（通知を出さないための判断に使う）。 */
  it('忘れるものが無ければ同じ配列を返す', () => {
    expect(clearDebugBreakpointVerification(current)).toBe(current)
  })
})
