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
      minify: true,
      /*
        Monaco Editor は素の React アプリより一桁大きい。既定の警告（500KB）は
        毎回出るだけで判断材料にならないため、実際に見張りたい水準まで引き上げる。
      */
      chunkSizeWarningLimit: 4000
    },
    /*
      Monaco の Worker（editor / typescript / json / css / html）を
      **アプリにバンドルされたファイル**として出すための設定。

      `format: 'es'` にしているのは、Monaco の Worker が ES Module であり、
      既定の iife では TypeScript サービスのような分割を含むものを出力できないため。

      これが CSP と直結している。Monaco の既定の経路は Worker の起動用スクリプトを
      blob として作るため `worker-src 'self'` では動かない。Renderer 側で
      `MonacoEnvironment.getWorker` を定義してその経路を迂回し、ここでバンドルした
      Worker を返している（renderer/src/editor/monaco/monacoSetup.ts）。
      外部 CDN も blob も経由しないので、STEP 1 の CSP はそのまま維持できる。
    */
    worker: {
      format: 'es'
    },
    plugins: [react()]
  }
})
