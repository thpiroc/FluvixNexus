import type { StoredMcpSettings } from '../settings/sections'

/**
 * MCP 連携を使うかどうか（全体の元栓）。
 *
 * ## 既定は「使わない」
 *
 * `lsp` の同じ形の設定は**既定で有効**だが、こちらは既定で無効にしてある。
 * 分けたのは、効き方が違うためにほかならない ── Language Server は
 * 自分の PC の中だけで完結し、入っていなければ何も起きない。MCP は
 * **外部のサービスへ、利用者の権限で繋ぐ**もので、何もしていないのに
 * 有効になっている状態を作ってよい種類の機能ではない。
 *
 * ## サーバーごとの栓は登録簿が持つ
 *
 * ここにあるのは全体の元栓 `enabled` だけ。サーバーごとの栓は、そのサーバーの
 * 行と一緒に `mcp-servers.json` が持つ（shared/mcp/customServers.ts）── 数が
 * 決まっていないものを、平らな key しか持てない `settings.json` へ入れない。
 * 両方が真のときだけそのサーバーを使う（main/mcp/mcpService.ts）。
 */
export interface McpPreferences {
  /** MCP 連携そのものを使うか。 */
  readonly enabled: boolean
}

/** 何も保存されていないときの値（使わない）。 */
export const DEFAULT_MCP_PREFERENCES: McpPreferences = {
  enabled: false
}

/**
 * 保存されている形から、使う形へ。
 *
 * 読めない値（欠けている・真偽値でない）は**既定＝無効**へ落ちる。
 * `lsp` 側は同じ場面で「有効」へ落とすが、ここで同じことをすると
 * 設定ファイルが壊れただけで外部サービスへの接続が有効になってしまう。
 */
export function normalizeMcpPreferences(stored: StoredMcpSettings | undefined): McpPreferences {
  return {
    enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : DEFAULT_MCP_PREFERENCES.enabled
  }
}

/** 使う形から、保存する形へ。 */
export function toStoredMcpSettings(preferences: McpPreferences): StoredMcpSettings {
  return { enabled: preferences.enabled }
}

/** 同じ内容か（保存の要求を出すかどうかを決める）。 */
export function isSameMcpPreferences(a: McpPreferences, b: McpPreferences): boolean {
  return a.enabled === b.enabled
}
