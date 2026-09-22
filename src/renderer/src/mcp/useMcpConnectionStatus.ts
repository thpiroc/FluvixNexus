import { useCallback, useEffect, useState } from 'react'
import type { McpConnectionId, McpConnectionStatus } from '@shared/mcp'
import { fluvix } from '../api/fluvix'
import type { TranslationKey } from '../i18n/messages'

/**
 * 接続1つの「今の状態」と、それに対する操作の足場（§21.9 / §21.10）。
 *
 * 組み込みの接続（Notion）のカードと、利用者が足したサーバーのカードの両方が使う
 * ── 状態の訊き方・訊き直す間隔・接続テストの押し方を、カードごとに書き分けない。
 */
export interface McpConnectionStatusController {
  readonly status: McpConnectionStatus | null
  readonly busy: boolean
  /** 直前の操作の知らせ（保存した・消した・繋がった）。次の操作で消える。 */
  readonly noticeKey: TranslationKey | null
  readonly refresh: () => Promise<void>
  /** 操作を1つ実行する。返した知らせを出し、終わったら状態を訊き直す。 */
  readonly run: (work: () => Promise<TranslationKey | null>) => Promise<void>
  readonly testConnection: () => void
}

/** 開いている間に訊き直す間隔。押したときは待たずに訊く。 */
const STATUS_POLL_MS = 2000

export function useMcpConnectionStatus(
  connectionId: McpConnectionId
): McpConnectionStatusController {
  const [status, setStatus] = useState<McpConnectionStatus | null>(null)
  const [busy, setBusy] = useState(false)
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
    設定（有効 / 無効）は上の行や登録簿が持っていて、この面は知らない。開いている間
    ときどき訊き直すことで、切り替えた結果がこちらにも出る
    ── 設定の持ち主からこの面へ通知を配ると、設定の持ち主が2つになる。
  */
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh()
    }, STATUS_POLL_MS)

    return () => {
      clearInterval(timer)
    }
  }, [refresh])

  const run = useCallback(
    async (work: () => Promise<TranslationKey | null>): Promise<void> => {
      setBusy(true)
      setNoticeKey(null)

      try {
        setNoticeKey(await work())
      } finally {
        setBusy(false)
        await refresh()
      }
    },
    [refresh]
  )

  const testConnection = useCallback((): void => {
    void run(async () => {
      const result = await fluvix.mcp.testConnection({ connectionId })

      return result.ok ? null : 'settings.mcp.notice.testFailed'
    })
  }, [connectionId, run])

  return { status, busy, noticeKey, refresh, run, testConnection }
}
