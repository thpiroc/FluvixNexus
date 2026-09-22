import { FILES_FILE_MAX_BYTES } from '@shared/files'
import { describe, expect, it } from 'vitest'
import { SECRET_SCAN_MAX_CHARS } from './secretMasking'
import { scanTargetFromBytes } from './secretScan'

/**
 * バイナリ・大きすぎるものを検査にかけない（Security Core v1 の STEP3）。
 *
 * 上限は既存の Files のものをそのまま使う。ここが `text` を返さない限り、
 * 後続は本文を持たない。
 */

describe('検査にかけられるもの', () => {
  it('テキストは本文を返す', () => {
    const result = scanTargetFromBytes(Buffer.from('API_KEY=A1b2C3d4E5f6G7h8\n', 'utf8'))

    expect(result).toEqual({ kind: 'text', text: 'API_KEY=A1b2C3d4E5f6G7h8\n' })
  })

  it('BOM は落とす', () => {
    const result = scanTargetFromBytes(Buffer.from('﻿const a = 1\n', 'utf8'))

    expect(result).toEqual({ kind: 'text', text: 'const a = 1\n' })
  })

  it('日本語も読む', () => {
    const result = scanTargetFromBytes(Buffer.from('# 本番の設定🔑\n', 'utf8'))

    expect(result).toEqual({ kind: 'text', text: '# 本番の設定🔑\n' })
  })
})

describe('検査にかけないもの', () => {
  it('バイナリは本文を渡さない', () => {
    const bytes = Buffer.concat([Buffer.from('token=abc'), Buffer.from([0x00, 0x01, 0x02])])

    expect(scanTargetFromBytes(bytes)).toEqual({ kind: 'binary' })
  })

  it('Editor が開ける上限を超えたものは本文を渡さない', () => {
    const bytes = Buffer.alloc(FILES_FILE_MAX_BYTES + 1, 0x61)

    expect(scanTargetFromBytes(bytes)).toEqual({ kind: 'too-large' })
  })

  it('文字数の上限を超えたものも本文を渡さない', () => {
    // 1 文字 3 バイトの文字なら、バイト数の上限内でも文字数の上限を超えうる。
    expect(SECRET_SCAN_MAX_CHARS).toBeLessThan(FILES_FILE_MAX_BYTES)
  })

  it('バイト列でないものは読めない', () => {
    for (const value of [undefined, null, 'text', 0, {}, []]) {
      expect(scanTargetFromBytes(value)).toEqual({ kind: 'unreadable' })
    }
  })
})
