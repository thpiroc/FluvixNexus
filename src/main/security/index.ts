import { app, session, type WebContents } from 'electron'
import { devServerUrl } from '../app/runtime'
import { createLogger } from '../logger'

/**
 * Main Process 側のセキュリティポリシーを集約するモジュール。
 *
 * Renderer は「Preload が公開した API 以外から OS に触れられない」ことを前提に作られている。
 * その前提を崩しうる経路は次の3つであり、いずれもここで塞ぐ。
 *  1. Renderer が別の場所（外部サイト等）へ遷移し、想定外の画面から API を呼ぶ
 *  2. 新しいウィンドウ / webview が、こちらの管理していない webContents として生まれる
 *  3. Web の権限 API（カメラ・位置情報・通知など）が Chromium 経由で許可されてしまう
 *
 * ウィンドウ単位ではなく webContents / session 単位で適用しているのは、
 * 将来 GitHub パネルを独立ウィンドウ化するなど、ウィンドウが増えたときに
 * 「ガードを掛け忘れたウィンドウ」が生まれないようにするため。
 */

const log = createLogger('security')

/**
 * 既定で許可する Web 権限。空集合 = すべて拒否。
 *
 * Fluvix Nexus はローカルの開発環境として動くアプリであり、
 * カメラ・マイク・位置情報・通知といったブラウザ権限を必要としない。
 * 将来 Monaco Editor の programmatic copy（clipboard-sanitized-write）など
 * 個別に必要になったものだけを、必要になった時点でここへ明示的に追加する。
 */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set<string>()

/**
 * 遷移先が Renderer 自身かどうか。
 *
 * 開発時は dev server と同一オリジンのみ、配布ビルドではアプリに同梱した file: のみを許可する。
 * それ以外（http(s) の外部サイトなど）は Renderer の実行元として想定していない。
 */
function isRendererLocation(target: string): boolean {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }

  return devServerUrl ? url.origin === new URL(devServerUrl).origin : url.protocol === 'file:'
}

/**
 * webContents 単位のガード。
 *
 * 外部リンクを扱うようになった場合も、新規ウィンドウとしては開かず、
 * shell.openExternal で OS 標準ブラウザへ渡す方針とする（実装は必要になった時点で）。
 */
function guardWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    log.warn(`blocked window.open to "${url}".`)
    return { action: 'deny' }
  })

  // will-navigate はメインフレーム、will-frame-navigate はサブフレームを含む遷移を捕捉する。
  const blockForeignNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (isRendererLocation(url)) {
      return
    }

    event.preventDefault()
    log.warn(`blocked navigation to "${url}".`)
  }

  contents.on('will-navigate', (event, url) => blockForeignNavigation(event, url))
  contents.on('will-frame-navigate', (details) => blockForeignNavigation(details, details.url))

  // webviewTag は無効にしてあるが、設定変更で有効になった場合の保険として attach 自体を拒否する。
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    log.warn('blocked webview attachment.')
  })
}

/**
 * すべての webContents に適用するポリシーを登録する。
 *
 * app.whenReady() より前に呼ぶこと。最初のウィンドウが生まれる前に
 * 購読を済ませておかないと、そのウィンドウだけガードが掛からない。
 */
export function applyWebContentsSecurityPolicy(): void {
  app.on('web-contents-created', (_event, contents) => {
    guardWebContents(contents)
  })
}

/**
 * セッション単位のポリシーを適用する。
 * session.defaultSession は app.whenReady() 以降でのみ参照できるため、起動後に呼ぶ。
 */
export function applySessionSecurityPolicy(): void {
  const { defaultSession } = session

  // 権限「要求」の既定拒否。Renderer から navigator.* 経由で要求されたときに通る。
  defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const granted = ALLOWED_PERMISSIONS.has(permission)
    if (!granted) {
      log.warn(`denied permission request "${permission}".`)
    }
    callback(granted)
  })

  // 権限「確認」の既定拒否。Chromium が要求前に現在の許可状態を問い合わせる経路。
  // こちらを塞がないと、要求ダイアログを出さずに機能が使えてしまう権限がある。
  defaultSession.setPermissionCheckHandler((_contents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission)
  })

  // HID / シリアル / USB といったデバイスアクセスも同様に拒否する。
  defaultSession.setDevicePermissionHandler(() => false)
}
