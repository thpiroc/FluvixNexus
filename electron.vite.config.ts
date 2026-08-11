import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @shared は Main / Preload / Renderer の3層すべてから参照される契約レイヤーのため、
// 3つの build すべてに同じエイリアスを通す。
const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: {
      alias: sharedAlias
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: {
      alias: sharedAlias
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...sharedAlias
      }
    },
    build: {
      // electron-vite の既定は minify: false。Renderer は React を含めて肥大するため配布ビルドでは圧縮する。
      // Main / Preload は数 KB しかなく、圧縮すると例外のスタックトレースが読みづらくなるだけなので既定のままにする。
      minify: true
    },
    plugins: [react()]
  }
})
