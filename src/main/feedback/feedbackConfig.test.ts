import { describe, expect, it } from 'vitest'
import {
  NOTION_DATABASE_ID_ENV,
  NOTION_TOKEN_ENV,
  normalizeNotionDatabaseId,
  resolveFeedbackDestinationsConfig
} from './feedbackConfig'

/**
 * フィードバックの保存先の設定。
 *
 * 確かめているのは「何も無ければ保存先無し（成功）」「中途半端なら失敗」
 * 「失敗の説明に token が混ざらない」の3つ。
 */

const ID = '0123456789abcdef0123456789abcdef'
const TOKEN = 'ntn_secret_value_do_not_log'

describe('resolveFeedbackDestinationsConfig', () => {
  it('環境変数もファイルも無ければ、保存先は無し（失敗ではない）', () => {
    expect(resolveFeedbackDestinationsConfig({}, { kind: 'missing' })).toEqual({
      ok: true,
      config: { notion: null }
    })
  })

  it('環境変数が2つ揃っていれば Notion を使う', () => {
    const read = resolveFeedbackDestinationsConfig(
      { [NOTION_TOKEN_ENV]: TOKEN, [NOTION_DATABASE_ID_ENV]: ID },
      { kind: 'missing' }
    )

    expect(read).toEqual({ ok: true, config: { notion: { token: TOKEN, databaseId: ID } } })
  })

  it('環境変数が片方だけなら失敗にし、ファイルへは落ちない', () => {
    const read = resolveFeedbackDestinationsConfig(
      { [NOTION_TOKEN_ENV]: TOKEN },
      { kind: 'present', raw: { notion: { token: 'other', databaseId: ID } } }
    )

    expect(read.ok).toBe(false)
    expect(JSON.stringify(read)).not.toContain(TOKEN)
  })

  it('token に制御文字などが混ざっていれば、文字の符号だけを添えて失敗にする', () => {
    for (const [token, code] of [
      ['', 'U+0016'], // Read-Host -AsSecureString で Ctrl+V
      [`[200~${TOKEN}[201~`, 'U+001B'],
      [`ntn_ab​cd`, 'U+200B'],
      [`ntn_ab cd`, 'U+0020']
    ] as const) {
      const read = resolveFeedbackDestinationsConfig(
        { [NOTION_TOKEN_ENV]: token, [NOTION_DATABASE_ID_ENV]: ID },
        { kind: 'missing' }
      )

      expect(read.ok, code).toBe(false)
      expect(read.ok ? '' : read.problem, code).toContain(code)
      expect(JSON.stringify(read)).not.toContain(TOKEN)
      expect(JSON.stringify(read)).not.toContain('ntn_ab')
    }
  })

  it('ファイルの notion から読む', () => {
    const read = resolveFeedbackDestinationsConfig(
      {},
      { kind: 'present', raw: { notion: { token: TOKEN, databaseId: ID } } }
    )

    expect(read).toEqual({ ok: true, config: { notion: { token: TOKEN, databaseId: ID } } })
  })

  it('ファイルに notion が無ければ保存先は無し', () => {
    expect(resolveFeedbackDestinationsConfig({}, { kind: 'present', raw: {} })).toEqual({
      ok: true,
      config: { notion: null }
    })
  })

  it('壊れた JSON・形の違うファイル・欠けた項目は失敗（token は説明に出ない）', () => {
    for (const file of [
      { kind: 'unreadable', cause: new Error('bad') } as const,
      { kind: 'present', raw: [] } as const,
      { kind: 'present', raw: { notion: 'x' } } as const,
      { kind: 'present', raw: { notion: { token: TOKEN } } } as const,
      { kind: 'present', raw: { notion: { token: TOKEN, databaseId: 'not-an-id' } } } as const
    ]) {
      const read = resolveFeedbackDestinationsConfig({}, file)

      expect(read.ok, JSON.stringify(file.kind)).toBe(false)
      expect(JSON.stringify(read)).not.toContain(TOKEN)
    }
  })
})

describe('normalizeNotionDatabaseId', () => {
  it('32桁・ハイフン付き・URL を同じ ID に揃える', () => {
    const dashed = '01234567-89ab-cdef-0123-456789ABCDEF'

    expect(normalizeNotionDatabaseId(ID)).toBe(ID)
    expect(normalizeNotionDatabaseId(dashed)).toBe(ID)
    expect(
      normalizeNotionDatabaseId(
        `https://www.notion.so/ws/Feedback-${ID}?v=ffffffffffffffffffffffffffffffff`
      )
    ).toBe(ID)
  })

  it('Notion がコピーさせる URL の形をどれも読む', () => {
    const view = 'ffffffffffffffffffffffffffffffff'

    for (const url of [
      `https://app.notion.com/p/${ID}?pvs=204`,
      `https://www.notion.so/${ID}?v=${view}&pvs=4`,
      `https://www.notion.so/FluvixNexus-フィードバック管理-${ID}?v=${view}`,
      `https://app.notion.com/p/${ID}/`
    ]) {
      expect(normalizeNotionDatabaseId(url), url).toBe(ID)
    }
  })

  it('貼り付けで付いた引用符・<>・空白を外す', () => {
    for (const value of [
      `"https://www.notion.so/${ID}?v=ffffffffffffffffffffffffffffffff"`,
      `'https://app.notion.com/p/${ID}?pvs=204'`,
      `<https://app.notion.com/p/${ID}>`,
      `  "${ID}"  `
    ]) {
      expect(normalizeNotionDatabaseId(value), value).toBe(ID)
    }
  })

  it('https:// が無い URL でも、ビューの ID を取り違えない', () => {
    expect(
      normalizeNotionDatabaseId(`www.notion.so/${ID}?v=ffffffffffffffffffffffffffffffff`)
    ).toBe(ID)
  })

  it('data source の URL（collection://）は受け付けず、ログで分かる', () => {
    const dataSource = 'collection://544d860a-0195-4f39-ad9e-2ae9f582bf56'

    expect(normalizeNotionDatabaseId(dataSource)).toBeNull()

    const read = resolveFeedbackDestinationsConfig(
      { [NOTION_TOKEN_ENV]: TOKEN, [NOTION_DATABASE_ID_ENV]: dataSource },
      { kind: 'missing' }
    )

    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.problem).toContain('data source URL')
    expect(JSON.stringify(read)).not.toContain(TOKEN)
  })

  it('ID が読み取れなければ null', () => {
    expect(normalizeNotionDatabaseId('https://www.notion.so/ws/Feedback')).toBeNull()
    expect(normalizeNotionDatabaseId('abc')).toBeNull()
  })
})
