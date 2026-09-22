import {
  DEFAULT_MCP_PREFERENCES,
  isSameMcpPreferences,
  normalizeMcpPreferences,
  toStoredMcpSettings,
  type McpPreferences
} from '@shared/mcp/settings'
import type { SettingsSectionBinding, SettingsValueUpdate } from '../settings/settingsBinding'

/**
 * MCP を使うかどうか（全体の元栓）の値の持ち主。
 *
 * 形は LSP の `lspSettingsBinding.ts` とまったく同じにしてある ── 読む・書く・
 * 同じなら据え置く、の3つだけで、**秘密の値は1つも通らない**
 * （秘密の値は設定の値ではなく、登録の IPC の口から Main へ渡る）。
 *
 * 登録したサーバーごとの有効 / 無効はここではなく、登録簿（`mcp-servers.json`）が持つ。
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
    setEnabled: (enabled) => apply((previous) => ({ ...previous, enabled }))
  }
}
