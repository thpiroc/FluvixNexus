import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * ユニットテストの設定。
 *
 * テスト対象は「Electron に依存しない純粋なロジック」に限定する。
 * Electron の API を使う層（ウィンドウ生成・IPC の登録など）は実際に起動して確認する方が
 * 確実で、モックを厚く積むと実装の写しにしかならないため、ここでは扱わない。
 *
 * この方針を成立させるために、判断を含むロジックは Electron 依存の薄い層から
 * 切り離しておくこと（例: store/windowBounds.ts と store/windowState.ts の分離）。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
      Vitest は既定で CSS の import を空文字へ差し替える（見た目は実機で見るもので、
      テストが読む必要は無い）。**`theme.css` だけは例外**にしてある ── Session 4-4
      から、あのファイルは見た目ではなく**契約**を持つため
      （Dark と Light に同じ変数が揃っているか、Monaco / xterm が読む名前があるか。
      renderer/src/styles/themeCss.test.ts）。

      差し替えられたままだと `?raw` でも空文字が返り、テストは
      「1つも定義が無い」ではなく「選択子が見つからない」で落ちる。
    */
    css: { include: [/theme\.css/] }
  }
})
