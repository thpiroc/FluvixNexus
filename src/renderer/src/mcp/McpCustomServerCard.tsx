import { useEffect, useState, type JSX } from 'react'
import type { McpCustomServerList, McpCustomServerSummary } from '@shared/mcp/customServers'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import { ConnectedTools } from './McpConnectedTools'
import { McpCustomServerForm } from './McpCustomServerForm'
import { formatCommandLine } from './mcpCustomServerDraft'
import { canTestConnection, summarizeMcpStatus } from './mcpStatusSummary'
import { useMcpConnectionStatus } from './useMcpConnectionStatus'

/**
 * MCP Server Manager に登録したサーバー1つのカード。
 *
 * 状態の1行・接続テスト・繋がったときのツールの数を出し、編集・削除・
 * 有効 / 無効を切り替えられる（useMcpConnectionStatus / mcpStatusSummary /
 * ConnectedTools）。
 *
 * 削除は2段で押させる（押し間違えで、入れ直せない秘密の値ごと消えないように）。
 */
export function McpCustomServerCard({
  server,
  canStoreSecrets,
  onListChanged,
  onSaved
}: {
  readonly server: McpCustomServerSummary
  readonly canStoreSecrets: boolean
  /** 切り替え・削除の後に Main が返した一覧。 */
  readonly onListChanged: (list: McpCustomServerList) => void
  /** 編集を保存した（一覧を読み直す）。 */
  readonly onSaved: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { status, busy, noticeKey, refresh, run, testConnection } = useMcpConnectionStatus(
    server.id
  )
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)

  /*
    編集・切り替えで行が変わったら、すぐに状態を訊き直す（2秒の訊き直しを待たない）。
    前の Command で試した結末は Main が忘れている（mcpCustomServers.ts の onChanged）。
  */
  useEffect(() => {
    void refresh()
  }, [server, refresh])

  if (editing) {
    return (
      <McpCustomServerForm
        server={server}
        canStoreSecrets={canStoreSecrets}
        onSaved={() => {
          setEditing(false)
          onSaved()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const summary = summarizeMcpStatus(status)
  const secretCount = server.env.filter((variable) => variable.secret).length

  const toggle = (): void => {
    void run(async () => {
      const result = await fluvix.mcp.setCustomServerEnabled({
        id: server.id,
        enabled: !server.enabled
      })

      if (!result.ok) {
        return 'settings.mcp.custom.notice.toggleFailed'
      }

      onListChanged(result.data)
      return null
    })
  }

  /*
    削除だけは `run` を通さない。消えた後にこのカードは一覧から外れ、`run` の
    後始末（状態の訊き直し）が、もう登録簿に無い id を Main へ訊くことになる。
  */
  const remove = async (): Promise<void> => {
    setDeleting(true)
    setDeleteFailed(false)

    const result = await fluvix.mcp.deleteCustomServer({ id: server.id })

    // 消せなかった（ファイルへ書けなかった）なら、一覧にまだ残っている。
    const removed =
      result.ok && !result.data.servers.some((candidate) => candidate.id === server.id)

    if (!removed) {
      setDeleting(false)
      setDeleteFailed(true)
    }

    if (result.ok) {
      onListChanged(result.data)
    }
  }

  return (
    <section
      className="fx-mcp__card"
      data-connection={server.id}
      data-tone={summary.tone}
      data-testid={`settings-mcp-custom-${server.id}`}
    >
      <div className="fx-mcp__head">
        <span className="fx-mcp__name">{server.name}</span>
        <span
          className="fx-mcp__status"
          data-tone={summary.tone}
          data-testid={`settings-mcp-status-${server.id}`}
        >
          {t(summary.messageKey)}
        </span>
      </div>

      <p className="fx-mcp__note fx-mcp__command" data-testid={`settings-mcp-command-${server.id}`}>
        {t('settings.mcp.custom.commandLine', { command: formatCommandLine(server.transport) })}
      </p>

      {server.env.length > 0 ? (
        <p className="fx-mcp__note">
          {t('settings.mcp.custom.envSummary', { count: server.env.length, secret: secretCount })}
        </p>
      ) : null}

      <ConnectedTools status={status} />

      <div className="fx-mcp__row">
        <button
          type="button"
          className="fx-mcp__button"
          data-testid={`settings-mcp-custom-toggle-${server.id}`}
          aria-pressed={server.enabled}
          data-active={server.enabled}
          disabled={busy}
          onClick={toggle}
        >
          {t(server.enabled ? 'settings.mcp.custom.enable' : 'settings.mcp.custom.disable')}
        </button>
        <button
          type="button"
          className="fx-mcp__button"
          data-testid={`settings-mcp-test-${server.id}`}
          disabled={busy || !canTestConnection(status)}
          onClick={testConnection}
        >
          {t('settings.mcp.test')}
        </button>
        <button
          type="button"
          className="fx-mcp__button"
          data-testid={`settings-mcp-custom-edit-${server.id}`}
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          {t('settings.mcp.custom.edit')}
        </button>
        <button
          type="button"
          className="fx-mcp__button"
          data-testid={`settings-mcp-custom-delete-${server.id}`}
          disabled={busy || confirmingDelete}
          onClick={() => setConfirmingDelete(true)}
        >
          {t('settings.mcp.custom.delete')}
        </button>
        {noticeKey === null ? null : (
          <span className="fx-mcp__note" data-testid={`settings-mcp-notice-${server.id}`}>
            {t(noticeKey)}
          </span>
        )}
      </div>

      {confirmingDelete ? (
        <div className="fx-mcp__row" role="alert">
          <span className="fx-mcp__note" data-state="warning">
            {t('settings.mcp.custom.deleteConfirm', { name: server.name })}
          </span>
          <button
            type="button"
            className="fx-mcp__button"
            data-variant="danger"
            data-testid={`settings-mcp-custom-delete-confirm-${server.id}`}
            disabled={busy || deleting}
            onClick={() => void remove()}
          >
            {t('settings.mcp.custom.deleteYes')}
          </button>
          <button
            type="button"
            className="fx-mcp__button"
            data-testid={`settings-mcp-custom-delete-cancel-${server.id}`}
            disabled={busy || deleting}
            onClick={() => setConfirmingDelete(false)}
          >
            {t('settings.mcp.custom.cancel')}
          </button>
        </div>
      ) : null}

      {deleteFailed ? (
        <p className="fx-mcp__note" data-state="warning" role="alert">
          {t('settings.mcp.custom.notice.deleteFailed')}
        </p>
      ) : null}
    </section>
  )
}
