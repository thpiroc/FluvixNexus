import { useCallback, useEffect, useState, type JSX } from 'react'
import { MCP_BUILTIN_CONNECTION_IDS, type McpBuiltinConnectionId } from '@shared/mcp'
import type { McpCustomServerList } from '@shared/mcp/customServers'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'
import { ConnectedTools } from './McpConnectedTools'
import { McpCustomServerCard } from './McpCustomServerCard'
import { McpCustomServerForm } from './McpCustomServerForm'
import {
  canClearStoredSecret,
  canTestConnection,
  secretSourceKey,
  summarizeMcpStatus
} from './mcpStatusSummary'
import { useMcpConnectionStatus } from './useMcpConnectionStatus'

/**
 * MCP の接続ごとの面（§21.9 / §21.10）。Settings の MCP カテゴリの、項目の下に続く。
 *
 * ## ここが出すのは「設定ファイルに書けないもの」だけ
 *
 * 使うかどうかの2つの真偽値は普通の設定項目として上に並ぶ（settingsCatalog.ts）。
 * この面が持つのは、
 *
 *   - **token** … 設定ファイルではなく、暗号化した別のファイルへ入る
 *   - **今の状態** … 保存された値ではなく、Main に訊いて分かるもの
 *   - **接続テスト** … 値ではなく操作
 *   - **利用者が足したサーバー**（§21.10）… `settings.json` ではなく、
 *     Main だけが書く登録簿（`mcp-servers.json`）に入る
 *
 * になる。
 *
 * ## 並び
 *
 * ```
 * [+ New MCP Server]         … 先頭。押すとすぐ下に入力欄が開く
 * 組み込みの接続（Notion）
 * 追加した MCP サーバー      … 登録簿の順
 * ```
 *
 * ## token は入れる方向にしか流れない
 *
 * 入っている token を欄に出して直させる形にはしていない ── Main から
 * Renderer へ token が戻る経路そのものを作らないため（shared/mcp の冒頭）。
 * 入れ直すときは新しい値を丸ごと送る。欄は送った時点で空に戻す。
 * 利用者が足したサーバーの秘密の環境変数も同じ扱いにしてある。
 *
 * ## 接続を増やしても、ここは変わらない
 *
 * 組み込みの接続は `MCP_BUILTIN_CONNECTION_IDS` の全部を並べ、Notion という
 * 名前はこの中に1つも書いていない（名前は i18n の側が接続 id から引く）。
 * 利用者が足したサーバーは、Main から届いた一覧をそのまま並べる。
 */
export function McpConnectionPanel(): JSX.Element {
  const { t } = useI18n()
  const custom = useMcpCustomServers()
  const [creating, setCreating] = useState(false)
  const [noticeKey, setNoticeKey] = useState<TranslationKey | null>(null)

  return (
    <div className="fx-mcp" data-testid="settings-mcp-panel">
      <div className="fx-mcp__row">
        <button
          type="button"
          className="fx-mcp__button"
          data-variant="primary"
          data-testid="settings-mcp-new-server"
          disabled={creating || custom.list === null}
          onClick={() => {
            setNoticeKey(null)
            setCreating(true)
          }}
        >
          {t('settings.mcp.custom.newServer')}
        </button>
        {noticeKey === null ? null : (
          <span className="fx-mcp__note" data-testid="settings-mcp-custom-notice">
            {t(noticeKey)}
          </span>
        )}
      </div>

      {creating && custom.list !== null ? (
        <McpCustomServerForm
          server={null}
          canStoreSecrets={custom.list.canStoreSecrets}
          onSaved={() => {
            setCreating(false)
            setNoticeKey('settings.mcp.custom.notice.saved')
            void custom.refresh()
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {MCP_BUILTIN_CONNECTION_IDS.map((id) => (
        <McpConnectionCard key={id} connectionId={id} />
      ))}

      {custom.loadFailed ? (
        <p
          className="fx-mcp__note"
          data-state="warning"
          data-testid="settings-mcp-custom-load-failed"
        >
          {t('settings.mcp.custom.notice.loadFailed')}
        </p>
      ) : null}

      {custom.list !== null && custom.list.servers.length > 0 ? (
        <section className="fx-mcp__group" data-testid="settings-mcp-custom-servers">
          <h3 className="fx-mcp__group-title">{t('settings.mcp.custom.heading')}</h3>
          {custom.list.servers.map((server) => (
            <McpCustomServerCard
              key={server.id}
              server={server}
              canStoreSecrets={custom.list?.canStoreSecrets ?? false}
              onListChanged={custom.replace}
              onSaved={() => void custom.refresh()}
            />
          ))}
        </section>
      ) : null}
    </div>
  )
}

/** 利用者が足したサーバーの一覧（Main の登録簿の写し）。 */
function useMcpCustomServers(): {
  readonly list: McpCustomServerList | null
  readonly loadFailed: boolean
  readonly refresh: () => Promise<void>
  readonly replace: (list: McpCustomServerList) => void
} {
  const [list, setList] = useState<McpCustomServerList | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const result = await fluvix.mcp.listCustomServers()

    if (result.ok) {
      setList(result.data)
      setLoadFailed(false)
    } else {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { list, loadFailed, refresh, replace: setList }
}

function McpConnectionCard({
  connectionId
}: {
  readonly connectionId: McpBuiltinConnectionId
}): JSX.Element {
  const { t } = useI18n()
  const { status, busy, noticeKey, run, testConnection } = useMcpConnectionStatus(connectionId)
  const [token, setToken] = useState('')

  const summary = summarizeMcpStatus(status)

  const saveToken = (): void => {
    void run(async () => {
      const result = await fluvix.mcp.setSecret({ connectionId, token })

      if (!result.ok) {
        return 'settings.mcp.notice.saveFailed'
      }

      if (!result.data.ok) {
        return SAVE_FAILURE_KEYS[result.data.failure]
      }

      /* 送れたら欄を空にする。画面に token が残り続けないようにする。 */
      setToken('')

      return 'settings.mcp.notice.saved'
    })
  }

  const clearToken = (): void => {
    void run(async () => {
      const result = await fluvix.mcp.clearSecret({ connectionId })

      if (!result.ok) {
        return 'settings.mcp.notice.clearFailed'
      }

      /*
        消した後に環境変数の token が残っている場合がある。「消しました」だけ
        だと、まだ繋がることが不具合に見える ── その場合は別の知らせを出す。
      */
      return result.data.source === 'environment'
        ? 'settings.mcp.notice.clearedButEnvironment'
        : 'settings.mcp.notice.cleared'
    })
  }

  const canClear = canClearStoredSecret(status)
  const canTest = canTestConnection(status)

  return (
    <section className="fx-mcp__card" data-connection={connectionId} data-tone={summary.tone}>
      <div className="fx-mcp__head">
        <span className="fx-mcp__name">{t(`settings.mcp.connections.${connectionId}`)}</span>
        <span
          className="fx-mcp__status"
          data-tone={summary.tone}
          data-testid={`settings-mcp-status-${connectionId}`}
        >
          {t(summary.messageKey)}
        </span>
      </div>

      <ConnectedTools status={status} />

      <div className="fx-mcp__field">
        <label className="fx-mcp__label" htmlFor={`fx-mcp-token-${connectionId}`}>
          {t('settings.mcp.secret.label')}
        </label>
        <p className="fx-mcp__note" data-testid={`settings-mcp-secret-source-${connectionId}`}>
          {t(secretSourceKey(status?.secret.source ?? 'none'))}
        </p>

        {status !== null && !status.secret.canStore ? (
          <p
            className="fx-mcp__note"
            data-state="warning"
            data-testid={`settings-mcp-no-store-${connectionId}`}
          >
            {t('settings.mcp.secret.cannotStore')}
          </p>
        ) : null}

        <div className="fx-mcp__row">
          {/*
            `type="password"` にしてあるのは肩越しに読まれないためで、
            欄に入るのはこれから送る値だけになる（保存済みの token は入らない）。
          */}
          <input
            id={`fx-mcp-token-${connectionId}`}
            className="fx-mcp__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-testid={`settings-mcp-token-${connectionId}`}
            placeholder={t('settings.mcp.secret.placeholder')}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button
            type="button"
            className="fx-mcp__button"
            data-testid={`settings-mcp-save-${connectionId}`}
            disabled={busy || token.trim().length === 0 || status?.secret.canStore === false}
            onClick={saveToken}
          >
            {t('settings.mcp.secret.save')}
          </button>
          <button
            type="button"
            className="fx-mcp__button"
            data-testid={`settings-mcp-clear-${connectionId}`}
            disabled={busy || !canClear}
            onClick={clearToken}
          >
            {t('settings.mcp.secret.clear')}
          </button>
        </div>
      </div>

      <div className="fx-mcp__row">
        <button
          type="button"
          className="fx-mcp__button"
          data-testid={`settings-mcp-test-${connectionId}`}
          disabled={busy || !canTest}
          onClick={testConnection}
        >
          {t('settings.mcp.test')}
        </button>
        {noticeKey === null ? null : (
          <span className="fx-mcp__note" data-testid={`settings-mcp-notice-${connectionId}`}>
            {t(noticeKey)}
          </span>
        )}
      </div>
    </section>
  )
}

const SAVE_FAILURE_KEYS = {
  'encryption-unavailable': 'settings.mcp.notice.encryptionUnavailable',
  'token-invalid': 'settings.mcp.notice.tokenInvalid',
  'write-failed': 'settings.mcp.notice.saveFailed'
} as const satisfies Readonly<Record<string, TranslationKey>>
