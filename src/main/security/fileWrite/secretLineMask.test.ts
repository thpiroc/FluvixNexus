import { describe, expect, it } from 'vitest'
import { SECRET_MASK, SECRET_SCAN_MAX_CHARS } from '../secret/secretMasking'
import { maskSecretLines } from './secretLineMask'

/**
 * 行の数を変えずに Secret を伏せる（Security Core v1 の STEP7）。
 *
 * 見ているのは2つ。**複数行の Secret を素通りさせないこと**と、
 * **行の数が変わらないこと**（変わると Diff の行番号がずれる）。
 */

describe('複数行の Secret', () => {
  const block = [
    'const before = 1',
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAv0Hh8kQfQ2mZ9xLpTn4bYdWc3sJrKvNgEuAqXwBtYzMdPlRi',
    'QkLmNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
    '-----END RSA PRIVATE KEY-----',
    'const after = 2'
  ].join('\n')

  it('鍵の本体の行が伏せられる', () => {
    const { lines } = maskSecretLines(block)

    expect(lines[2]).not.toContain(
      'MIIEowIBAAKCAQEAv0Hh8kQfQ2mZ9xLpTn4bYdWc3sJrKvNgEuAqXwBtYzMdPlRi'
    )
    expect(lines[3]).not.toContain(
      'QkLmNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'
    )
  })

  it('行の数は変わらない', () => {
    expect(maskSecretLines(block).lines.length).toBe(6)
  })

  it('block の外の行は、そのまま残る', () => {
    const { lines } = maskSecretLines(block)

    expect(lines[0]).toBe('const before = 1')
    expect(lines[5]).toBe('const after = 2')
  })

  it('伏せたことを返す', () => {
    expect(maskSecretLines(block).masked).toBe(true)
  })
})

describe('1行の Secret', () => {
  it('行の中の、当たった部分だけが伏せ字になる', () => {
    const { lines } = maskSecretLines('const key = "sk-ant-api03-abcdefghijklmnopqrstuvwx"\n')

    expect(lines[0]).toContain('const key = "')
    expect(lines[0]).toContain(SECRET_MASK)
    expect(lines[0]).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')
  })

  it('Secret が無ければ、1文字も変わらない', () => {
    const text = 'const a = 1\nconst b = 2\n'

    expect(maskSecretLines(text)).toEqual({
      lines: ['const a = 1', 'const b = 2'],
      masked: false
    })
  })
})

describe('端', () => {
  it('空の本文は、行が1つも無い', () => {
    expect(maskSecretLines('')).toEqual({ lines: [], masked: false })
  })

  it('上限を超えた先は、丸ごと伏せる', () => {
    const text = `${'a\n'.repeat(10)}${'b'.repeat(SECRET_SCAN_MAX_CHARS)}`
    const { lines, masked } = maskSecretLines(text)

    expect(masked).toBe(true)
    expect(lines[lines.length - 1]).toContain(SECRET_MASK)
  })
})
