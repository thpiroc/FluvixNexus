import { FILES_FILE_MAX_BYTES } from '@shared/files'
import { describe, expect, it } from 'vitest'
import { APPROVAL_CONTENT_MAX_CHARS } from '../approval/approvalAction'
import { prepareFileWriteContent } from './fileWriteContent'

/**
 * 提案された本文の検査（Security Core v1 の STEP7）。
 *
 * **v1 は UTF-8 のテキストだけ。** binary は同じ API に含めない。
 */

function bytesOf(content: string, encoding: 'utf8' | 'utf8-bom' = 'utf8'): Buffer {
  const result = prepareFileWriteContent(content, encoding)

  if (!result.ok) {
    throw new Error(`expected ok, got ${result.denial}`)
  }

  return result.bytes
}

describe('受け付けるもの', () => {
  it('普通のテキスト', () => {
    expect(bytesOf('const a = 1\n').toString('utf8')).toBe('const a = 1\n')
  })

  it('日本語', () => {
    expect(bytesOf('こんにちは\n').toString('utf8')).toBe('こんにちは\n')
  })

  it('絵文字（サロゲートペア）', () => {
    expect(bytesOf('a👍b').toString('utf8')).toBe('a👍b')
  })

  it('空の本文（空のファイルを作る）', () => {
    expect(bytesOf('').byteLength).toBe(0)
  })

  it('CRLF はそのまま書く（Main 側で改行を揃えない）', () => {
    expect(bytesOf('a\r\nb\r\n').toString('utf8')).toBe('a\r\nb\r\n')
  })
})

describe('BOM', () => {
  it('utf8-bom なら BOM が付く', () => {
    expect([...bytesOf('a', 'utf8-bom').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('utf8 なら BOM は付かない', () => {
    expect(bytesOf('a', 'utf8').byteLength).toBe(1)
  })

  it('本文そのものは変わらない', () => {
    const result = prepareFileWriteContent('a', 'utf8-bom')

    expect(result.ok && result.content).toBe('a')
  })
})

describe('拒むもの', () => {
  it('文字列でない', () => {
    expect(prepareFileWriteContent(null, 'utf8')).toEqual({
      ok: false,
      denial: 'invalid-request'
    })
    expect(prepareFileWriteContent(Buffer.from('a'), 'utf8')).toEqual({
      ok: false,
      denial: 'invalid-request'
    })
  })

  it('NUL を含む（binary）', () => {
    expect(prepareFileWriteContent('a\u0000b', 'utf8')).toEqual({
      ok: false,
      denial: 'unsupported-content'
    })
  })

  it('対になっていないサロゲート（UTF-8 として往復できない）', () => {
    expect(prepareFileWriteContent('a\ud800b', 'utf8')).toEqual({
      ok: false,
      denial: 'unsupported-content'
    })
  })

  it('文字数の上限を超える', () => {
    expect(prepareFileWriteContent('a'.repeat(APPROVAL_CONTENT_MAX_CHARS + 1), 'utf8')).toEqual({
      ok: false,
      denial: 'content-too-large'
    })
  })

  it('バイト数の上限を超える（日本語は1文字 3 バイト）', () => {
    const content = 'あ'.repeat(Math.floor(FILES_FILE_MAX_BYTES / 3) + 1)

    expect(content.length).toBeLessThanOrEqual(APPROVAL_CONTENT_MAX_CHARS)
    expect(prepareFileWriteContent(content, 'utf8')).toEqual({
      ok: false,
      denial: 'content-too-large'
    })
  })
})

describe('上限は既存のものを使い回す', () => {
  it('文字数は承認と同じ、バイト数は Editor が開ける上限と同じ', () => {
    expect(APPROVAL_CONTENT_MAX_CHARS).toBe(1_000_000)
    expect(FILES_FILE_MAX_BYTES).toBe(2 * 1024 * 1024)
  })
})
