import { describe, expect, it } from 'vitest'
import { MCP_BUILTIN_CONNECTION_IDS } from './index'
import {
  DEFAULT_MCP_PREFERENCES,
  isMcpConnectionEnabled,
  isSameMcpPreferences,
  normalizeMcpPreferences,
  toStoredMcpSettings,
  type McpPreferences
} from './settings'

/**
 * MCP を使うかどうかの設定（shared/mcp/settings.ts）。
 *
 * ここで一番大事なのは**読めない値がどちらへ落ちるか**にほかならない。
 * `lsp` は「有効」へ落ちるが、こちらは外部サービスへ繋ぐので「無効」へ落ちる。
 */

describe('DEFAULT_MCP_PREFERENCES', () => {
  it('既定はどれも無効', () => {
    expect(DEFAULT_MCP_PREFERENCES.enabled).toBe(false)

    for (const id of MCP_BUILTIN_CONNECTION_IDS) {
      expect(DEFAULT_MCP_PREFERENCES.servers[id]).toBe(false)
    }
  })
})

describe('normalizeMcpPreferences', () => {
  it('保存が無ければ既定（どれも無効）', () => {
    expect(normalizeMcpPreferences(undefined)).toEqual(DEFAULT_MCP_PREFERENCES)
    expect(normalizeMcpPreferences({})).toEqual(DEFAULT_MCP_PREFERENCES)
  })

  it('保存されている真偽値をそのまま読む', () => {
    expect(normalizeMcpPreferences({ enabled: true, notionEnabled: true })).toEqual({
      enabled: true,
      servers: { notion: true }
    })
  })

  it('全体だけ有効でも、接続ごとの値は保たれる', () => {
    expect(normalizeMcpPreferences({ enabled: true, notionEnabled: false })).toEqual({
      enabled: true,
      servers: { notion: false }
    })
  })

  /*
    壊れたファイルで外部サービスへの接続が有効になってはいけない。
    `lsp` の同じ場面（有効へ落とす）と**わざと違う**ところになる。
  */
  it('真偽値でない値は、すべて無効へ落ちる', () => {
    for (const broken of ['true', 1, null, {}, []]) {
      const stored = { enabled: broken, notionEnabled: broken } as never

      expect(normalizeMcpPreferences(stored)).toEqual(DEFAULT_MCP_PREFERENCES)
    }
  })
})

describe('toStoredMcpSettings', () => {
  it('読んで書いても内容が変わらない', () => {
    for (const stored of [
      {},
      { enabled: true },
      { notionEnabled: true },
      { enabled: true, notionEnabled: true },
      { enabled: false, notionEnabled: true }
    ]) {
      const once = normalizeMcpPreferences(stored)

      expect(normalizeMcpPreferences(toStoredMcpSettings(once))).toEqual(once)
    }
  })

  it('保存する形に token の欄が無い', () => {
    const stored = toStoredMcpSettings({ enabled: true, servers: { notion: true } })

    expect(Object.keys(stored).sort()).toEqual(['enabled', 'notionEnabled'])
  })
})

describe('isMcpConnectionEnabled', () => {
  const on: McpPreferences = { enabled: true, servers: { notion: true } }

  it('元栓と栓の両方が入っているときだけ使える', () => {
    expect(isMcpConnectionEnabled(on, 'notion')).toBe(true)
    expect(isMcpConnectionEnabled({ ...on, enabled: false }, 'notion')).toBe(false)
    expect(isMcpConnectionEnabled({ enabled: true, servers: { notion: false } }, 'notion')).toBe(
      false
    )
  })

  it('全体を戻しても、接続ごとに選んだ値は消えない', () => {
    const off: McpPreferences = { ...on, enabled: false }

    expect(off.servers.notion).toBe(true)
    expect(isMcpConnectionEnabled(off, 'notion')).toBe(false)
    expect(isMcpConnectionEnabled({ ...off, enabled: true }, 'notion')).toBe(true)
  })
})

describe('isSameMcpPreferences', () => {
  it('同じ内容なら同じ', () => {
    expect(
      isSameMcpPreferences(
        { enabled: true, servers: { notion: true } },
        { enabled: true, servers: { notion: true } }
      )
    ).toBe(true)
  })

  it('どこか1つでも違えば違う', () => {
    expect(
      isSameMcpPreferences(
        { enabled: true, servers: { notion: true } },
        { enabled: false, servers: { notion: true } }
      )
    ).toBe(false)

    expect(
      isSameMcpPreferences(
        { enabled: true, servers: { notion: true } },
        { enabled: true, servers: { notion: false } }
      )
    ).toBe(false)
  })
})
