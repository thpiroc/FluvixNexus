import type { JSX } from 'react'
import type { McpConnectionStatus } from '@shared/mcp'
import { useI18n } from '../i18n/context'

/**
 * 繋がったときに、相手が何を出しているか。
 *
 * ツールの名前まで出すのは、**繋がったことの証拠**にあたるため
 * ── 「繋がりました」だけだと、token が合っているのか確かめようがない。
 *
 * 今の設定に足りないもの（無効にした・token を消した）があるときは出さない。
 * 状態の1行と同じく、前の結末が今の設定の話として読まれないようにする
 * （mcpStatusSummary.ts の「3 を 4 より先に見る」）。
 */
export function ConnectedTools({
  status
}: {
  readonly status: McpConnectionStatus | null
}): JSX.Element | null {
  const { t } = useI18n()
  const test = status?.lastTest

  if (
    status === null ||
    status.problems.length > 0 ||
    test === undefined ||
    test === null ||
    test.outcome !== 'connected'
  ) {
    return null
  }

  return (
    <p className="fx-mcp__note" data-testid="settings-mcp-tools">
      {t('settings.mcp.tools', {
        name: test.server.name ?? t('settings.mcp.unknownServer'),
        count: test.tools.length
      })}
    </p>
  )
}
