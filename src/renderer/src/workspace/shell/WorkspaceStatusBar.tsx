import { useEffect, useState, type JSX } from 'react'
import type { AppInfoResponse } from '@shared/ipc'
import { fluvix } from '../../api/fluvix'

/**
 * Workspace の下部領域（ステータスバー）。
 *
 * 上部バーと同じく Dock 対象ではなく Shell の外枠。
 *
 * ここで実行環境とアプリ情報を出しているのは、Session 1 の暫定 UI が持っていた
 * 「Renderer → Preload → Main の経路が生きているか」の目視確認を、
 * デバッグ用の画面を残さずに引き継ぐため。app info は IPC 越しにしか取得できない。
 *
 * 後続セッションでここに載るもの:
 *   - Git のブランチ名 / 変更件数
 *   - カーソル位置・文字コード・改行コード
 *   - LSP / DAP の状態
 */
export function WorkspaceStatusBar(): JSX.Element {
  const { platform, versions } = fluvix.env
  const [appInfo, setAppInfo] = useState<AppInfoResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    void fluvix.system.getAppInfo().then((result) => {
      if (cancelled || !result.ok) {
        return
      }
      setAppInfo(result.data)
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <footer className="fx-statusbar">
      <span className="fx-statusbar__item">
        {appInfo === null ? '接続中…' : `${appInfo.name} v${appInfo.version}`}
      </span>
      <span className="fx-statusbar__spacer" />
      <span className="fx-statusbar__item">
        {platform} / Electron {versions.electron} / Chromium {versions.chrome} / Node{' '}
        {versions.node}
      </span>
    </footer>
  )
}
