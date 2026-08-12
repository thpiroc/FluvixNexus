import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// テーマ変数を先に定義してから、それを使う土台のスタイルを読み込む。
import './styles/theme.css'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
