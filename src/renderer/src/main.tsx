import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { fluvix } from './api/fluvix'
import { installRendererErrorReporting } from './diagnostics/rendererErrorReporting'
// テーマ変数を先に定義してから、それを使う土台のスタイルを読み込む。
import './styles/theme.css'
import './styles/global.css'

// 描画より先に張る（最初の描画で投げたものも記録に残す）。既定のコンソール出力は変えない。
installRendererErrorReporting(window, (request) => {
  void fluvix.diagnostics.reportRendererError(request).catch(() => undefined)
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
