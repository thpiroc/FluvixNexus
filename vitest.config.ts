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
    include: ['src/**/*.test.ts']
  }
})
