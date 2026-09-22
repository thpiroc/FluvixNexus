import { useCallback, useEffect, useState, type JSX } from 'react'
import type { McpCustomServerList } from '@shared/mcp/customServers'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'
import { McpCustomServerCard } from './McpCustomServerCard'
import { McpCustomServerForm } from './McpCustomServerForm'

/**
 * MCP Server Manager の面。Settings の MCP カテゴリの、全体の元栓の下に続く。
 *
 * ## ここが出すのは「設定ファイルに書けないもの」だけ
 *
 * 使うかどうか（全体の元栓）は普通の設定項目として上に並ぶ（settingsCatalog.ts）。
 * この面が持つのは、Main だけが書く登録簿（`mcp-servers.json`）に入る
 * **登録したサーバー**と、その状態・接続テストになる。
 *
 * ## 並び
 *
 * ```
 * [+ New MCP Server]         … 先頭。押すとすぐ下に入力欄が開く
 * 追加した MCP サーバー      … 登録簿の順
 * ```
 *
 * どのサービス（GitHub・Notion など）も、ここから同じ形で登録する。
 * 特定のサービスだけのカードや入力欄は持たない。
 *
 * ## 秘密の値は入れる方向にしか流れない
 *
 * 入っている値を欄に出して直させる形にはしていない ── Main から Renderer へ
 * 秘密の値が戻る経路そのものを作らないため（shared/mcp の冒頭）。
 * 入れ直すときは新しい値を丸ごと送る（McpCustomServerForm.tsx）。
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

/** 登録したサーバーの一覧（Main の登録簿の写し）。 */
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
