import { describe, expect, it } from 'vitest'
import { FILES_BINARY_SNIFF_BYTES } from '@shared/files'
import {
  detectEncoding,
  detectLineEnding,
  encodeFileContent,
  looksBinary,
  stripBom
} from './fileContent'

/**
 * 読み込んだバイト列をテキストとして扱えるかの判断。
 *
 * fs を触らずに済むよう切り離してある部分（readWorkspaceFile.ts が使う）。
 */

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('looksBinary', () => {
  it('普通のテキストはバイナリではない', () => {
    expect(looksBinary(bytes('export const a = 1\n'))).toBe(false)
  })

  it('空のファイルはバイナリではない', () => {
    expect(looksBinary(new Uint8Array())).toBe(false)
  })

  it('日本語や絵文字を含んでもバイナリではない', () => {
    expect(looksBinary(bytes('こんにちは 🎨\n'))).toBe(false)
  })

  it('NUL があればバイナリ', () => {
    expect(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x00, 0x04]))).toBe(true)
  })

  // 判定のためだけに大きなファイルを舐めない、という約束をここで固定する。
  it('先頭の一定量より後ろにある NUL は見ない', () => {
    const data = new Uint8Array(FILES_BINARY_SNIFF_BYTES + 10)
    data.fill(0x41)
    data[FILES_BINARY_SNIFF_BYTES + 5] = 0

    expect(looksBinary(data)).toBe(false)
  })

  it('先頭の一定量の末尾にある NUL は見る', () => {
    const data = new Uint8Array(FILES_BINARY_SNIFF_BYTES + 10)
    data.fill(0x41)
    data[FILES_BINARY_SNIFF_BYTES - 1] = 0

    expect(looksBinary(data)).toBe(true)
  })
})

describe('detectLineEnding', () => {
  it('LF だけなら lf', () => {
    expect(detectLineEnding('a\nb\nc')).toBe('lf')
  })

  it('CRLF なら crlf', () => {
    expect(detectLineEnding('a\r\nb\r\nc')).toBe('crlf')
  })

  it('混在していれば最初に見つかった方を採る', () => {
    expect(detectLineEnding('a\nb\r\nc')).toBe('lf')
    expect(detectLineEnding('a\r\nb\nc')).toBe('crlf')
  })

  // Windows を対象にしているため、新しい行を足すなら CRLF。
  it('改行が無ければ crlf', () => {
    expect(detectLineEnding('single line')).toBe('crlf')
    expect(detectLineEnding('')).toBe('crlf')
  })

  it('先頭が改行でも落ちない', () => {
    expect(detectLineEnding('\nabc')).toBe('lf')
  })
})

describe('stripBom', () => {
  it('先頭の BOM を落とす', () => {
    expect(stripBom('﻿const a = 1')).toBe('const a = 1')
  })

  it('BOM が無ければそのまま', () => {
    expect(stripBom('const a = 1')).toBe('const a = 1')
  })

  it('途中の同じ文字は落とさない', () => {
    expect(stripBom('a﻿b')).toBe('a﻿b')
  })
})

/**
 * 文字コード（Session 3-5）。
 *
 * 今扱うのは UTF-8 の BOM の有無だけ。**開いて保存しただけで差分が出ない**ことが
 * 目的で、そのために「BOM が付いていたか」を持ち回る（shared/files/content.ts）。
 */
describe('detectEncoding', () => {
  it('BOM が無ければ utf8', () => {
    expect(detectEncoding(bytes('const a = 1'))).toBe('utf8')
  })

  it('BOM があれば utf8-bom', () => {
    expect(detectEncoding(bytes('﻿const a = 1'))).toBe('utf8-bom')
  })

  it('空のファイルは utf8', () => {
    expect(detectEncoding(new Uint8Array())).toBe('utf8')
  })

  // BOM の3バイトに満たない中身で、範囲外を読んで誤判定しないこと。
  it('BOM の先頭2バイトだけでは utf8', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb]))).toBe('utf8')
  })

  it('BOM に似た別のバイト列は utf8', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbe, 0x41]))).toBe('utf8')
  })
})

describe('encodeFileContent', () => {
  it('utf8 では BOM を足さない', () => {
    expect([...encodeFileContent('a', 'utf8')]).toEqual([0x61])
  })

  it('utf8-bom では BOM を足す', () => {
    expect([...encodeFileContent('a', 'utf8-bom')]).toEqual([0xef, 0xbb, 0xbf, 0x61])
  })

  /*
    読んで書き戻すと元のバイト列に戻ること。これが崩れると、
    ファイルを開いて Ctrl+S しただけで Git の差分が出る。
  */
  it('読み込み → 書き出しでバイト列が変わらない', () => {
    for (const source of ['const a = 1\r\n', '﻿const a = 1\r\n', 'こんにちは', '﻿こんにちは']) {
      const original = bytes(source)
      const encoding = detectEncoding(original)
      const content = stripBom(Buffer.from(original).toString('utf8'))

      expect([...encodeFileContent(content, encoding)]).toEqual([...original])
    }
  })
})
