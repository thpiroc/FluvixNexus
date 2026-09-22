import type { StoredMcpSettings } from '../settings/sections'
import { MCP_BUILTIN_CONNECTION_IDS, type McpBuiltinConnectionId } from './index'

/**
 * MCP 連携を使うかどうか（§21.9）。
 *
 * ## 既定は「使わない」
 *
 * `lsp` の同じ形の設定は**既定で有効**だが、こちらは既定で無効にしてある。
 * 分けたのは、効き方が違うためにほかならない ── Language Server は
 * 自分の PC の中だけで完結し、入っていなければ何も起きない。MCP は
 * **外部のサービスへ、利用者の権限で繋ぐ**もので、何もしていないのに
 * 有効になっている状態を作ってよい種類の機能ではない。
 *
 * token を入れただけでも有効にはならない。入れることと使うことは別の意思で、
 * 「token を消さずに一時的に止める」ができなくなるため。
 *
 * ## 全体と、サーバーごとの2段
 *
 * `enabled` が全体の元栓で、`servers` がサーバーごとの栓にあたる。
 * 両方が真のときだけそのサーバーを使う（`isMcpConnectionEnabled`）──
 * `lsp` とまったく同じ形で、全体を戻したときに
 * 「どれを使っていたか」が消えないようにするためになる。
 *
 * ここの `servers` に並ぶのは**組み込みの接続だけ**。利用者が足した
 * サーバー（§21.10）の栓は、そのサーバーの行と一緒に `mcp-servers.json` が
 * 持つ（shared/mcp/customServers.ts）── 数が決まっていないものを、平らな
 * key しか持てない `settings.json` へ入れない。全体の元栓 `enabled` は
 * どちらにも効く。
 */
export interface McpPreferences {
  /** MCP 連携そのものを使うか。 */
  readonly enabled: boolean
  /** 接続ごとに使うか。 */
  readonly servers: Readonly<Record<McpBuiltinConnectionId, boolean>>
}

/** 何も保存されていないときの値（どれも使わない）。 */
export const DEFAULT_MCP_PREFERENCES: McpPreferences = {
  enabled: false,
  servers: { notion: false }
}

/**
 * 接続 id から、保存ファイルの key へ。
 *
 * `satisfies` を書いてあるので、接続を足して**ここを書き忘れると型が通らない**
 * （shared/lsp/serverSettings.ts の `SERVER_ENABLED_KEYS` と同じ）。
 */
const CONNECTION_ENABLED_KEYS = {
  notion: 'notionEnabled'
} as const satisfies Readonly<Record<McpBuiltinConnectionId, keyof StoredMcpSettings>>

/**
 * 保存されている形から、使う形へ。
 *
 * 読めない値（欠けている・真偽値でない）は**すべて既定＝無効**へ落ちる。
 * `lsp` 側は同じ場面で「有効」へ落とすが、ここで同じことをすると
 * 設定ファイルが壊れただけで外部サービスへの接続が有効になってしまう。
 */
export function normalizeMcpPreferences(stored: StoredMcpSettings | undefined): McpPreferences {
  const servers: Record<McpBuiltinConnectionId, boolean> = { ...DEFAULT_MCP_PREFERENCES.servers }

  for (const id of MCP_BUILTIN_CONNECTION_IDS) {
    servers[id] = readFlag(
      stored?.[CONNECTION_ENABLED_KEYS[id]],
      DEFAULT_MCP_PREFERENCES.servers[id]
    )
  }

  return { enabled: readFlag(stored?.enabled, DEFAULT_MCP_PREFERENCES.enabled), servers }
}

/** 使う形から、保存する形へ。 */
export function toStoredMcpSettings(preferences: McpPreferences): StoredMcpSettings {
  return { enabled: preferences.enabled, notionEnabled: preferences.servers.notion }
}

/**
 * その接続を使ってよいか。
 *
 * **元栓と栓の両方**を見る。呼ぶ側がこの and を書くと、片方だけを見る場所が
 * いずれ生まれる（Main の起動前・Renderer の表示・IPC の入口で3回判断する）。
 */
export function isMcpConnectionEnabled(
  preferences: McpPreferences,
  id: McpBuiltinConnectionId
): boolean {
  return preferences.enabled && preferences.servers[id]
}

/** 同じ内容か（保存の要求を出すかどうかを決める）。 */
export function isSameMcpPreferences(a: McpPreferences, b: McpPreferences): boolean {
  return (
    a.enabled === b.enabled &&
    MCP_BUILTIN_CONNECTION_IDS.every((id) => a.servers[id] === b.servers[id])
  )
}

function readFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
