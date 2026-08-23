import { Menu, type MenuItemConstructorOptions } from 'electron'
import { isDevelopment } from './runtime'

/**
 * アプリケーションメニューの構成。
 *
 * Electron は何も設定しないと既定メニュー（File / Edit / View / Window / Help）を出す。
 * 既定メニューには Reload や Toggle DevTools が含まれるため、配布ビルドでそのまま残すと
 * 利用者が意図せず開発者向け機能に触れてしまう。かといって開発中に消してしまうと
 * デバッグが不便になるため、開発時と配布ビルドで構成を分ける。
 *
 * Fluvix Nexus の操作面はアプリ内 UI（Dockable UI・コマンド類）に置く方針のため、
 * ネイティブメニューを本格的に育てる予定はない。File / Edit などの項目は、
 * 対応する機能（Files パネル・Workspace）が実装された段階で必要性を再検討する。
 *
 * なお Windows では Ctrl+C / Ctrl+V / Ctrl+A などの標準編集操作は Chromium 側が処理するため、
 * メニューを外しても入力欄やエディタのコピー & ペーストは動作する。
 */
export function applyApplicationMenu(): void {
  if (!isDevelopment) {
    // 配布ビルドではネイティブメニューを持たない（メニューバーごと消える）。
    Menu.setApplicationMenu(null)
    return
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: '開発',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        /*
          ズームの3項目は外してある（Session 3-7-3）。

          Electron のズームは**メニュー項目が持つアクセラレータ**として効くため、
          置いておくと Ctrl + `+` / `-` / `0` を native メニューが先に取る。
          Session 3-7-3 で端末の文字の大きさを同じ組み合わせに割り当てたので、
          **開発中だけ端末側へ届かない**という食い違いが生まれる
          （配布ビルドはメニューを持たない ＝ 常に端末側へ届く）。

          アプリ自身に画面全体を拡大する機能は無く、この3項目は
          開発中の便宜でしか無かったため、食い違いの側を消した。
        */
        { role: 'quit' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
