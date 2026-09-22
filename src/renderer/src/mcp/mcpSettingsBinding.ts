import type { McpConnectionId } from '@shared/mcp'
import {
  DEFAULT_MCP_PREFERENCES,
  isSameMcpPreferences,
  normalizeMcpPreferences,
  toStoredMcpSettings,
  type McpPreferences
} from '@shared/mcp/settings'
import type { SettingsSectionBinding, SettingsValueUpdate } from '../settings/settingsBinding'

/**
 * MCP を使うかどうかの値の持ち主（§21.9）。
 *
 * 形は LSP の `lspSettingsBinding.ts` とまったく同じにしてある ── 読む・書く・
 * 同じなら据え置く、の3つだけで、**token は1つも通らない**
 * （token は設定の値ではなく、IPC の別の口から Main へ渡る）。
 *
 * この section は application scope なので、Settings 画面でワークスペースを
 * 選んでいる間は押せない状態で出る（shared/settings/scope.ts）。
 */
export const MCP_SETTINGS_BINDING: SettingsSectionBinding<'mcp', McpPreferences> = {
  section: 'mcp',
  initial: DEFAULT_MCP_PREFERENCES,
  fromStored: normalizeMcpPreferences,
  toStored: toStoredMcpSettings
}

export interface McpSetters {
  readonly setEnabled: (enabled: boolean) => void
  readonly setConnectionEnabled: (id: McpConnectionId, enabled: boolean) => void
}

/** 値の変え方（丸め・同じなら据え置く）。画面と打鍵の両方がこれを使う。 */
export function createMcpSetters(update: SettingsValueUpdate<McpPreferences>): McpSetters {
  const apply = (change: (previous: McpPreferences) => McpPreferences): void => {
    update((previous) => {
      const next = change(previous)

      /* 同じ内容なら据え置く（保存の要求も、再描画も起こさない）。 */
      return isSameMcpPreferences(previous, next) ? previous : next
    })
  }

  return {
    setEnabled: (enabled) => apply((previous) => ({ ...previous, enabled })),
    setConnectionEnabled: (id, enabled) =>
      apply((previous) => ({ ...previous, servers: { ...previous.servers, [id]: enabled } }))
  }
}
