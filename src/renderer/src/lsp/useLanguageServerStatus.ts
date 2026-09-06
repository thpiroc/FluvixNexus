import { useEffect, useState } from 'react'
import type { LanguageServerStatus } from '@shared/lsp'
import { fluvix } from '../api/fluvix'

/**
 * サーバが今どうなっているかを読む（Session 5-4）。
 *
 * ```
 * main/lsp/serverStatus.ts
 *    ↓  lsp:get-status（最初の1回）/ lsp:status-changed（変わったとき）
 * window.fluvix.lsp        Preload の薄いラッパ
 *    ↓
 * ここ                      届いた一覧をそのまま持つ
 *    ↓
 * LanguageServerStatusItem  ステータスバーに1つ出す
 * ```
 *
 * ## 読むだけ
 *
 * このフックから起こせることは何も無い。サーバを立てる / 止めるのは Main の判断で、
 * 使うかどうかを変える口は Settings（`settings:save-section`）にある
 * ── 状態を見る場所と、設定を変える場所を混ぜない。
 *
 * ## 最初の1回を読む理由
 *
 * `lsp:status-changed` は**変わったときにしか流れない**。ウィンドウを開き直した
 * 直後や、Editor をずっと使っていて何も変わっていない場面では1本も届かないので、
 * 購読を張るのと同時に今の状態を1度読む（`workspaceFolder.getCurrent` と同じ形）。
 *
 * **購読を先に張る。** 逆にすると、読んでいる最中に起きた変化を取りこぼす。
 *
 * ## Workspace には紐づかない
 *
 * 診断や文書同期と違い、`workspaceId` を突き合わせない ── サーバの状態は
 * アプリ全体のもので、切り替えの前後で行き違っても捨てる理由が無い
 * （切り替えでは全部終わり、その終了が状態として届く。shared/ipc/events/lsp.ts）。
 */
export function useLanguageServerStatus(): readonly LanguageServerStatus[] {
  const [servers, setServers] = useState<readonly LanguageServerStatus[]>([])

  useEffect(() => {
    let cancelled = false

    // 購読が先（上記）。
    const unsubscribe = fluvix.lsp.onStatusChanged((event) => {
      setServers(event.servers)
    })

    void fluvix.lsp.getStatus().then((result) => {
      /*
        読んでいる間に通知が届いていることがある。**後から届いた最初の1回で
        上書きしない** ── 通知の方が新しいので、そちらを残す必要がある。
        ここでは「まだ1本も持っていないとき」だけ入れる。
      */
      if (cancelled || !result.ok) {
        return
      }

      setServers((previous) => (previous.length === 0 ? result.data.servers : previous))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return servers
}
