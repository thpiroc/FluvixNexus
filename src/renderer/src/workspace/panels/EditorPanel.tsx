import type { JSX } from 'react'
import { PanelPlaceholder } from './PanelPlaceholder'

/**
 * Editor パネル（仮）。
 *
 * DESIGN.md §3 の表では「Workspace」と呼んでいるコード編集パネル。
 * 本実装では画面全体の器を Workspace Shell と呼ぶため、
 * 混同を避けてパネル側は Editor という名前にしている（役割は DESIGN.md の Workspace と同じ）。
 */
export function EditorPanel(): JSX.Element {
  return (
    <PanelPlaceholder
      summary="コード編集。Workspace Shell の中心となる作業領域。"
      upcoming={[
        'Monaco Editor の組み込み（worker はバンドル済みのものを使う）',
        '複数タブ / 検索・置換',
        'LSP 連携（TypeScript / Python / C#）',
        'Breakpoint など DAP との連動'
      ]}
    />
  )
}
