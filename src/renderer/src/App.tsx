import type { JSX } from 'react'
import { WorkspaceShell } from './workspace/WorkspaceShell'

/**
 * Renderer のルート。
 *
 * 画面の組み立ては Workspace Shell の責務のため、ここでは何も持たない。
 * アプリ全体に関わるもの（エラーバウンダリ、テーマの切り替え、
 * 独立ウィンドウ化した際のルート分岐など）が必要になったときだけこの層に足す。
 */
function App(): JSX.Element {
  return <WorkspaceShell />
}

export default App
