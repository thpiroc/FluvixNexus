import { describe, expect, it } from 'vitest'
import { SECRET_MASK } from '../secret/secretMasking'
import {
  createSafeFileWriteDiff,
  SAFE_DIFF_CONTROL_MARK,
  SAFE_DIFF_LINE_MAX_LENGTH,
  SAFE_DIFF_MAX_LINES,
  SAFE_DIFF_TRUNCATION_MARK
} from './safeFileWriteDiff'

/**
 * Renderer へ送る Diff（Security Core v1 の STEP7）。
 *
 * **ここを通った後の文字列だけが画面へ出る。** Secret も制御文字も、ここで止める。
 */

function texts(before: string, after: string): readonly string[] {
  const diff = createSafeFileWriteDiff(before, after)

  if (diff === null) {
    throw new Error('expected a diff')
  }

  return diff.lines.map((line) => line.text)
}

describe('Secret を伏せる', () => {
  it('API Key を含む行は伏せ字になる', () => {
    const diff = createSafeFileWriteDiff(
      '',
      'const key = "sk-ant-api03-abcdefghijklmnopqrstuvwx"\n'
    )

    expect(diff?.secretMasked).toBe(true)
    expect(diff?.lines[0].text).toContain(SECRET_MASK)
    expect(diff?.lines[0].text).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')
  })

  it('Private Key の block は、行ごとに伏せられる', () => {
    const body = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAv0Hh8kQfQ2mZ9xLpTn4bYdWc3sJrKvNgEuAqXwBtYzMdPlRi',
      '-----END RSA PRIVATE KEY-----',
      ''
    ].join('\n')
    const diff = createSafeFileWriteDiff('', body)

    expect(diff?.secretMasked).toBe(true)

    for (const line of diff?.lines ?? []) {
      expect(line.text).not.toContain(
        'MIIEowIBAAKCAQEAv0Hh8kQfQ2mZ9xLpTn4bYdWc3sJrKvNgEuAqXwBtYzMdPlRi'
      )
    }
  })

  it('伏せても、行番号と行の対応は崩れない', () => {
    const diff = createSafeFileWriteDiff(
      '',
      [
        'line1',
        '-----BEGIN PRIVATE KEY-----',
        'abcd',
        '-----END PRIVATE KEY-----',
        'line5',
        ''
      ].join('\n')
    )

    expect(diff?.lines.map((line) => line.newLine)).toEqual([1, 2, 3, 4, 5])
  })

  it('Secret が無ければ secretMasked は false', () => {
    expect(createSafeFileWriteDiff('', 'const a = 1\n')?.secretMasked).toBe(false)
  })
})

describe('制御文字', () => {
  it('ESC（ANSI）は印へ置き換わる', () => {
    expect(texts('', '\u001b[31mred\u001b[0m\n')[0]).toBe(
      `${SAFE_DIFF_CONTROL_MARK}[31mred${SAFE_DIFF_CONTROL_MARK}[0m`
    )
  })

  it('CR は印へ置き換わる（行頭へ戻して上書きさせない）', () => {
    expect(texts('', 'a\rIGNORED\n')[0]).toBe(`a${SAFE_DIFF_CONTROL_MARK}IGNORED`)
  })

  it('双方向の制御文字も印へ置き換わる', () => {
    expect(texts('', 'a‮b\n')[0]).toBe(`a${SAFE_DIFF_CONTROL_MARK}b`)
  })

  it('タブは残る（インデントが読めなくなる）', () => {
    expect(texts('', '\tconst a = 1\n')[0]).toBe('\tconst a = 1')
  })

  it('NUL も印へ置き換わる', () => {
    expect(texts('', 'a\u0000b\n')[0]).toBe(`a${SAFE_DIFF_CONTROL_MARK}b`)
  })
})

describe('切る', () => {
  it('長い行は、印を付けて切る', () => {
    const line = 'x'.repeat(SAFE_DIFF_LINE_MAX_LENGTH + 50)
    const text = texts('', `${line}\n`)[0]

    expect(text.length).toBe(SAFE_DIFF_LINE_MAX_LENGTH)
    expect(text.endsWith(SAFE_DIFF_TRUNCATION_MARK)).toBe(true)
  })

  it('行数が多ければ、後ろを落として truncated を立てる', () => {
    const body = `${'a\n'.repeat(SAFE_DIFF_MAX_LINES + 10)}`
    const diff = createSafeFileWriteDiff('', body)

    expect(diff?.lines.length).toBe(SAFE_DIFF_MAX_LINES)
    expect(diff?.truncated).toBe(true)
  })

  it('落としても、数え方は落とす前のまま', () => {
    const body = `${'a\n'.repeat(SAFE_DIFF_MAX_LINES + 10)}`

    expect(createSafeFileWriteDiff('', body)?.addedCount).toBe(SAFE_DIFF_MAX_LINES + 10)
  })

  it('切った端で文字が割れない', () => {
    const text = texts('', `${'あ'.repeat(SAFE_DIFF_LINE_MAX_LENGTH + 10)}\n`)[0]

    expect([...text].length).toBe(SAFE_DIFF_LINE_MAX_LENGTH)
  })
})

describe('数える', () => {
  it('足した行と消した行を数える', () => {
    const diff = createSafeFileWriteDiff('a\nb\nc\n', 'a\nB\nc\nd\n')

    expect(diff?.addedCount).toBe(2)
    expect(diff?.removedCount).toBe(1)
  })

  it('変わっていなければ 0 と 0', () => {
    const diff = createSafeFileWriteDiff('a\n', 'a\n')

    expect(diff?.addedCount).toBe(0)
    expect(diff?.removedCount).toBe(0)
  })
})

describe('日本語', () => {
  it('そのまま出る（伏せ字にも印にもならない）', () => {
    expect(texts('', '日本語のコメントです。\n')[0]).toBe('日本語のコメントです。')
  })
})

describe('作れないもの', () => {
  it('文字列でなければ null', () => {
    expect(createSafeFileWriteDiff(null, 'a')).toBeNull()
    expect(createSafeFileWriteDiff('a', 42)).toBeNull()
  })
})

describe('凍結', () => {
  it('受け取った側が書き換えても効かない', () => {
    const diff = createSafeFileWriteDiff('', 'a\n')

    expect(Object.isFrozen(diff)).toBe(true)
    expect(Object.isFrozen(diff?.lines)).toBe(true)
    expect(Object.isFrozen(diff?.lines[0])).toBe(true)
  })
})
