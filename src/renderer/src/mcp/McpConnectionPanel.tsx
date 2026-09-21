import { useCallback, useEffect, useState, type JSX } from 'react'
import { MCP_CONNECTION_IDS, type McpConnectionId, type McpConnectionStatus } from '@shared/mcp'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'
import {
  canClearStoredSecret,
  canTestConnection,
  secretSourceKey,
  summarizeMcpStatus
} from './mcpStatusSummary'

/**
 * MCP の接続ごとの面（§21.9）。Settings の MCP カテゴリの、項目の下に続く。
 *
 * ## ここが出すのは「設定ファイルに書けないもの」だけ
 *
 * 使うかどうかの2つの真偽値は普通の設定項目として上に並ぶ（settingsCatalog.ts）。
 * この面が持つのは、
 *
 *   - **token** … 設定ファイルではなく、暗号化した別のファイルへ入る
 *   - **今の状態** … 保存された値ではなく、Main に訊いて分かるもの
 *   - **接続テスト** … 値ではなく操作
 *
 * の3つになる。
 *
 * ## token は入れる方向にしか流れない
 *
 * 入っている token を欄に出して直させる形にはしていない ── Main から
 * Renderer へ token が戻る経路そのものを作らないため（shared/mcp の冒頭）。
 * 入れ直すときは新しい値を丸ごと送る。欄は送った時点で空に戻す。
 *
 * ## 接続を増やしても、ここは変わらない
 *
 * 並べるのは `MCP_CONNECTION_IDS` の全部で、Notion という名前はこの中に
 * 1つも書いていない（名前は i18n の側が接続 id から引く）。
 */
export function McpConnectionPanel(): JSX.Element {
  return (
    <div className="fx-mcp" data-testid="settings-mcp-panel">
      {MCP_CONNECTION_IDS.map((id) => (
        <McpConnectionCard key={id} connectionId={id} />
      ))}
    </div>
  )
}

function McpConnectionCard({
  connectionId
}: {
  readonly connectionId: McpConnectionId
}): JSX.Element {
  const { t } = useI18n()
  const [status, setStatus] = useState<McpConnectionStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  /** 直前の操作の知らせ（保存した・消した・繋がった）。次の操作で消える。 */
  const [noticeKey, setNoticeKey] = useState<TranslationKey | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const result = await fluvix.mcp.getStatus({ connectionId })

    /*
      読めなかったときに前の状態を残さない。「有効」と出たまま操作できる面は、
      押しても何も起きない状態になる。
    */
    setStatus(result.ok ? result.data : null)
  }, [connectionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*
    設定（有効 / 無効）は上の行が持っていて、この面は知らない。開いている間
    ときどき訊き直すことで、上を切り替えた結果がこちらにも出る
    ── 上の行からこの面へ通知を配ると、設定の持ち主が2つになる。
  */
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh()
    }, STATUS_POLL_MS)

    return () => {
      clearInterval(timer)
    }
  }, [refresh])

  const summary = summarizeMcpStatus(status)

  const run = async (work: () => Promise<TranslationKey | null>): Promise<void> => {
    setBusy(true)
    setNoticeKey(null)

    try {
      setNoticeKey(await work())
    } finally {
      setBusy(false)
      await refresh()
    }
  }

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

  const testConnection = (): void => {
    void run(async () => {
      const result = await fluvix.mcp.testConnection({ connectionId })

      return result.ok ? null : 'settings.mcp.notice.testFailed'
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

/**
 * 繋がったときに、相手が何を出しているか。
 *
 * ツールの名前まで出すのは、**繋がったことの証拠**にあたるため
 * ── 「繋がりました」だけだと、token が合っているのか確かめようがない。
 */
function ConnectedTools({
  status
}: {
  readonly status: McpConnectionStatus | null
}): JSX.Element | null {
  const { t } = useI18n()
  const test = status?.lastTest

  if (test === undefined || test === null || test.outcome !== 'connected') {
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

/** 開いている間に訊き直す間隔。押したときは待たずに訊く。 */
const STATUS_POLL_MS = 2000

const SAVE_FAILURE_KEYS = {
  'encryption-unavailable': 'settings.mcp.notice.encryptionUnavailable',
  'token-invalid': 'settings.mcp.notice.tokenInvalid',
  'write-failed': 'settings.mcp.notice.saveFailed'
} as const satisfies Readonly<Record<string, TranslationKey>>
