import { useEffect, useState, type JSX } from 'react'
import type { AppInfoResponse } from '@shared/ipc'
import { fluvix } from '../../api/fluvix'
import { DebugStatusItem } from '../../debug/DebugStatusItem'
import { useI18n } from '../../i18n/context'
import { LanguageServerStatusItem } from '../../lsp/LanguageServerStatusItem'
import { useWorkspaceFolder } from '../../workspaceFolder/context'

/**
 * Workspace の下部領域（ステータスバー）。
 *
 * 上部バーと同じく Dock 対象ではなく Shell の外枠。
 *
 * ここで実行環境とアプリ情報を出しているのは、Session 1 の暫定 UI が持っていた
 * 「Renderer → Preload → Main の経路が生きているか」の目視確認を、
 * デバッグ用の画面を残さずに引き継ぐため。app info は IPC 越しにしか取得できない。
 *
 * 開いている Workspace の場所（rootPath）もここに出す。上部バーに出しているのは
 * フォルダ名だけで、同じ名前のフォルダが複数ある場合に「今どれを開いているか」を
 * 見分けられないため。長いパスで他の表示を押し出さないよう、幅は CSS 側で抑える。
 *
 * Session 5-4 で Language Server の状態が載った（lsp/LanguageServerStatusItem.tsx）。
 * **このファイルは状態を1つも持たない** ── 出す場所を決めるだけで、
 * 何を出すかは持ち込んだ部品の側にある。ステータスバーに載るものが増えるたびに
 * ここが太らないようにするためで、Git のブランチ名も同じ形で入る想定になる。
 *
 * Session 6-9 で Debug の状態が同じ形で載った（debug/DebugStatusItem.tsx）。
 *
 * 後続セッションでここに載るもの:
 *   - Git のブランチ名 / 変更件数
 *   - カーソル位置・文字コード・改行コード
 */
export function WorkspaceStatusBar(): JSX.Element {
  const { platform, versions } = fluvix.env
  const { status, workspace } = useWorkspaceFolder()
  const { t } = useI18n()
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
      <span
        className="fx-statusbar__item fx-statusbar__workspace"
        data-workspace-state={
          status === 'loading' ? 'loading' : workspace === null ? 'none' : 'open'
        }
        title={workspace?.rootPath}
      >
        {status === 'loading' ? '' : (workspace?.rootPath ?? t('workspace.noWorkspace'))}
      </span>
      <span className="fx-statusbar__item">
        {appInfo === null ? t('workspace.connecting') : `${appInfo.name} v${appInfo.version}`}
      </span>
      {/*
        Language Server の状態（Session 5-4）。Workspace とアプリ情報の隣に置く
        ── どれも「今この画面が何を相手にしているか」で、実行環境の情報
        （右端）とは性格が違う。
      */}
      <LanguageServerStatusItem />
      {/*
        Debug の状態（Session 6-9）。LSP の隣 ── どちらも「言語の道具が今どうなっているか」で、
        置き方（押せない・1語・内訳は title）も揃えてある。
      */}
      <DebugStatusItem />
      <span className="fx-statusbar__spacer" />
      <span className="fx-statusbar__item">
        {platform} / Electron {versions.electron} / Chromium {versions.chrome} / Node{' '}
        {versions.node}
      </span>
    </footer>
  )
}
