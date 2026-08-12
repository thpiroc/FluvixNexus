import type { JSX } from 'react'
import { PanelPlaceholder } from './PanelPlaceholder'

/**
 * Terminal パネル（仮）。
 *
 * node-pty は Main に置き、出力のストリームは Main → Renderer のイベント経路を通す。
 * この経路は STEP 1 時点で唯一未実装の部分（ARCHITECTURE.md §3.3）。
 */
export function TerminalPanel(): JSX.Element {
  return (
    <PanelPlaceholder
      summary="PowerShell / Node / Claude Code などの CLI 実行。"
      upcoming={[
        'node-pty によるシェル起動（Main Process 側）',
        '出力ストリームの受信（Main → Renderer のイベント経路）',
        'xterm.js による描画',
        '複数タブの切り替え'
      ]}
    />
  )
}
