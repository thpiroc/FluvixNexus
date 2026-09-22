import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MCP_PREFERENCES,
  isSameMcpPreferences,
  normalizeMcpPreferences,
  toStoredMcpSettings
} from './settings'

/**
 * MCP を使うかどうかの設定（shared/mcp/settings.ts）。全体の元栓だけを持つ。
 *
 * ここで一番大事なのは**読めない値がどちらへ落ちるか**にほかならない。
 * `lsp` は「有効」へ落ちるが、こちらは外部サービスへ繋ぐので「無効」へ落ちる。
 */

describe('DEFAULT_MCP_PREFERENCES', () => {
  it('既定は無効', () => {
    expect(DEFAULT_MCP_PREFERENCES).toEqual({ enabled: false })
  })
})

describe('normalizeMcpPreferences', () => {
  it('保存が無ければ既定（無効）', () => {
    expect(normalizeMcpPreferences(undefined)).toEqual(DEFAULT_MCP_PREFERENCES)
    expect(normalizeMcpPreferences({})).toEqual(DEFAULT_MCP_PREFERENCES)
  })

  it('保存されている真偽値をそのまま読む', () => {
    expect(normalizeMcpPreferences({ enabled: true })).toEqual({ enabled: true })
    expect(normalizeMcpPreferences({ enabled: false })).toEqual({ enabled: false })
  })

  /*
    壊れたファイルで外部サービスへの接続が有効になってはいけない。
    `lsp` の同じ場面（有効へ落とす）と**わざと違う**ところになる。
  */
  it('真偽値でない値は無効へ落ちる', () => {
    for (const broken of ['true', 1, null, {}, []]) {
      expect(normalizeMcpPreferences({ enabled: broken } as never)).toEqual(DEFAULT_MCP_PREFERENCES)
    }
  })

  it('旧 Notion MCP の栓（notionEnabled）が残っていても、何にも効かない', () => {
    expect(normalizeMcpPreferences({ notionEnabled: true } as never)).toEqual({ enabled: false })
  })
})

describe('toStoredMcpSettings', () => {
  it('読んで書いても内容が変わらない', () => {
    for (const stored of [{}, { enabled: true }, { enabled: false }]) {
      const once = normalizeMcpPreferences(stored)

      expect(normalizeMcpPreferences(toStoredMcpSettings(once))).toEqual(once)
    }
  })

  it('保存する形は全体の元栓だけ（秘密の値もサーバーごとの栓も無い）', () => {
    expect(toStoredMcpSettings({ enabled: true })).toEqual({ enabled: true })
  })
})

describe('isSameMcpPreferences', () => {
  it('同じ内容なら同じ', () => {
    expect(isSameMcpPreferences({ enabled: true }, { enabled: true })).toBe(true)
  })

  it('違えば違う', () => {
    expect(isSameMcpPreferences({ enabled: true }, { enabled: false })).toBe(false)
  })
})
