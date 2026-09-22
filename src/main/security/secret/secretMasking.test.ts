import { describe, expect, it, vi } from 'vitest'
import {
  describeErrorWithoutSecrets,
  maskSecretText,
  redactSecretText,
  SECRET_MASK,
  SECRET_SCAN_MAX_CHARS
} from './secretMasking'
import * as patterns from './secretPatterns'

/**
 * Masking（Security Core v1 の STEP3）。
 *
 * 伏せた結果にも metadata にも元の値が残らないこと、失敗しても平文へ倒れないこと。
 */

const SECRET = 'ghp_1234567890abcdefGHIJKLMNOPqrstuvwx'

describe('伏せ字', () => {
  it('元の値は、本文にも metadata にも残らない', () => {
    const result = maskSecretText(`token=${SECRET}`)

    expect(result.text).toBe(`token=${SECRET_MASK}`)
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('先頭も末尾も残さない', () => {
    const result = maskSecretText(`token=${SECRET}`)

    // 元の値の断片（前半・後半・端の数文字）が1つも出てこない。
    for (const fragment of [
      SECRET.slice(0, 8),
      SECRET.slice(0, SECRET.length - 4),
      SECRET.slice(4),
      SECRET.slice(-8),
      SECRET.slice(-4)
    ]) {
      expect(result.text).not.toContain(fragment)
    }
  })

  it('長さも形も残さない', () => {
    const short = maskSecretText('token=A1b2C3d4E5f6G7h8').text
    const long = maskSecretText(`token=${SECRET}`).text

    expect(short).toBe(`token=${SECRET_MASK}`)
    expect(long).toBe(`token=${SECRET_MASK}`)
  })

  it('伏せ字から元へ戻す経路は無い（置き換えであって変換ではない）', () => {
    expect(SECRET_MASK).toBe('***REDACTED***')
    expect(maskSecretText(`a=${SECRET}`).text).toBe(maskSecretText(`a=${SECRET}`).text)
  })
})

describe('metadata', () => {
  it('Secret が無ければ、知らせる必要も無い', () => {
    const result = maskSecretText('const a = 1\n')

    expect(result).toEqual({
      text: 'const a = 1\n',
      secretsFound: false,
      maskedCount: 0,
      categories: [],
      userNoticeRequired: false,
      truncated: false
    })
  })

  it('件数と種別を返し、利用者へ知らせるべきと伝える', () => {
    const result = maskSecretText(
      ['API_KEY=A1b2C3d4E5f6G7h8', `Authorization: Bearer ${SECRET}`].join('\n')
    )

    expect(result.maskedCount).toBe(2)
    expect(result.categories).toEqual(['authorization-value', 'github-token', 'key-value'])
    expect(result.userNoticeRequired).toBe(true)
  })

  it('返り値は凍結してあり、受け取った側が書き換えても効かない', () => {
    const result = maskSecretText(`token=${SECRET}`)

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.categories)).toBe(true)
  })

  it('値を持つ欄は無い', () => {
    const result = maskSecretText(`token=${SECRET}`)

    expect(Object.keys(result).sort()).toEqual([
      'categories',
      'maskedCount',
      'secretsFound',
      'text',
      'truncated',
      'userNoticeRequired'
    ])
  })
})

describe('本文の形は変えない', () => {
  it('改行はそのまま残る', () => {
    const source = ['# settings', 'API_KEY=A1b2C3d4E5f6G7h8', '', 'PORT=3000', ''].join('\n')
    const result = maskSecretText(source)

    expect(result.text.split('\n')).toEqual([
      '# settings',
      `API_KEY=${SECRET_MASK}`,
      '',
      'PORT=3000',
      ''
    ])
  })

  it('CRLF も残る', () => {
    const result = maskSecretText('a=1\r\nAPI_KEY=A1b2C3d4E5f6G7h8\r\n')

    expect(result.text).toBe(`a=1\r\nAPI_KEY=${SECRET_MASK}\r\n`)
  })

  it('日本語・絵文字は壊さない', () => {
    const result = maskSecretText(
      ['# 本番の設定です🔑', 'API_KEY=A1b2C3d4E5f6G7h8', '# ここまで'].join('\n')
    )

    expect(result.text).toBe(
      ['# 本番の設定です🔑', `API_KEY=${SECRET_MASK}`, '# ここまで'].join('\n')
    )
  })

  it('値が日本語でも伏せる', () => {
    const result = maskSecretText('password=ひみつの合言葉2026')

    expect(result.secretsFound).toBe(true)
    expect(result.text).toBe(`password=${SECRET_MASK}`)
  })

  it('離れた複数箇所を、間を残したまま伏せる', () => {
    const result = maskSecretText(
      `head ${SECRET} middle sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 tail`
    )

    expect(result.maskedCount).toBe(2)
    expect(result.text).toBe(`head ${SECRET_MASK} middle ${SECRET_MASK} tail`)
  })

  it('重なった検出は1つの範囲にまとめる（はみ出した分を残さない）', () => {
    // Bearer の値としても JWT としても当たる。
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const result = maskSecretText(`Authorization: Bearer ${jwt}`)

    expect(result.text).toBe(`Authorization: Bearer ${SECRET_MASK}`)
    expect(result.maskedCount).toBe(1)
    expect([...result.categories].sort()).toEqual(['authorization-value', 'jwt'])
  })
})

describe('上限', () => {
  it('上限を超えた分は捨てる（未検査の文字は返さない）', () => {
    const body = 'a'.repeat(SECRET_SCAN_MAX_CHARS)
    const result = maskSecretText(`${body}TAIL_NOT_SCANNED`)

    expect(result.truncated).toBe(true)
    expect(result.text).toBe(`${body}${SECRET_MASK}`)
    expect(result.text).not.toContain('TAIL_NOT_SCANNED')
    expect(result.categories).toContain('unscanned')
    expect(result.userNoticeRequired).toBe(true)
  })

  it('上限ちょうどまでは、そのまま検査する', () => {
    const body = 'a'.repeat(SECRET_SCAN_MAX_CHARS)

    expect(maskSecretText(body).truncated).toBe(false)
  })
})

describe('fail closed', () => {
  it('文字列でないものからは、何も渡さない', () => {
    for (const value of [undefined, null, 0, true, {}, [], Symbol('x')]) {
      const result = maskSecretText(value)

      expect(result.text).toBe('')
      expect(result.secretsFound).toBe(true)
      expect(result.userNoticeRequired).toBe(true)
      expect(result.categories).toEqual(['unscanned'])
    }
  })

  it('検出が落ちても、元の本文は返さない', () => {
    const spy = vi.spyOn(patterns, 'findSecretMatches').mockImplementation(() => {
      throw new Error('detector failed')
    })

    try {
      const result = maskSecretText(`token=${SECRET}`)

      expect(result.text).toBe(SECRET_MASK)
      expect(result.text).not.toContain(SECRET)
      expect(result.text).not.toContain('token=')
      expect(result.secretsFound).toBe(true)
      expect(result.categories).toEqual(['unscanned'])
    } finally {
      spy.mockRestore()
    }
  })

  it('検出が壊れた範囲を返しても、本文は壊れない', () => {
    const spy = vi.spyOn(patterns, 'findSecretMatches').mockReturnValue([
      { start: -5, end: 3, category: 'key-value' },
      { start: 2, end: 1, category: 'key-value' },
      { start: 0, end: 10_000, category: 'key-value' },
      { start: Number.NaN, end: 4, category: 'key-value' }
    ])

    try {
      expect(maskSecretText('abcdef').text).toBe('abcdef')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('redactSecretText', () => {
  it('伏せた本文だけを返す', () => {
    expect(redactSecretText(`token=${SECRET}`)).toBe(`token=${SECRET_MASK}`)
  })

  it('文字列でないものには伏せ字を返す', () => {
    expect(redactSecretText(undefined)).toBe(SECRET_MASK)
    expect(redactSecretText({ token: SECRET })).toBe(SECRET_MASK)
  })
})

describe('describeErrorWithoutSecrets', () => {
  it('Error の message から Secret を伏せる', () => {
    const error = new Error(`request failed: https://bob:p4ssw0rd-xyz@api.example.com/v1`)

    const described = describeErrorWithoutSecrets(error)

    expect(described).toBe(`Error: request failed: https://${SECRET_MASK}@api.example.com/v1`)
    expect(described).not.toContain('p4ssw0rd-xyz')
  })

  it('errno も残す（Secret ではない）', () => {
    const error = Object.assign(new Error('spawn failed'), { code: 'ENOENT' })

    expect(describeErrorWithoutSecrets(error)).toBe('Error (ENOENT): spawn failed')
  })

  it('文字列も伏せる', () => {
    expect(describeErrorWithoutSecrets(`Authorization: Bearer ${SECRET}`)).toBe(
      `Authorization: Bearer ${SECRET_MASK}`
    )
  })

  it('形の分からないものは中身を辿らない', () => {
    expect(describeErrorWithoutSecrets({ token: SECRET })).toBe('[object]')
    expect(describeErrorWithoutSecrets(null)).toBe('null')
    expect(describeErrorWithoutSecrets(undefined)).toBe('undefined')
  })
})
