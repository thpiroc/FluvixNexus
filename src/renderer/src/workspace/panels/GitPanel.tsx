import type { JSX } from 'react'
import { PanelPlaceholder } from './PanelPlaceholder'

/**
 * Git パネル（仮）。
 *
 * DESIGN.md §3 の GitHub パネルに相当する。Git 操作そのものは Main Process 側で実行し、
 * 将来は独立ウィンドウとして切り離せるようにする。
 */
export function GitPanel(): JSX.Element {
  return (
    <PanelPlaceholder
      summary="Commit / Push / Pull などの Git 操作。"
      upcoming={[
        '変更ファイルの一覧と差分表示',
        'Commit & Push / Pull の操作ボタン',
        '初回の「GitHub に公開」ガイド',
        '独立ウィンドウ化'
      ]}
    />
  )
}
