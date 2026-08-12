import { asDockNodeId } from './nodeId'
import type { WorkspaceLayout } from './types'

/**
 * 初期レイアウト。
 *
 * 保存されたレイアウト（レイアウトプリセット / 前回終了時の配置）が無いときの既定値であり、
 * 将来はここが「Default プリセット」の実体になる。保存先は main の store/ 側に置く想定
 * （ARCHITECTURE.md §4）。
 *
 * 配置:
 *   ┌────────┬──────────┬────────┐
 *   │ Files  │  Editor  │  Git   │   ← 横並び（row）
 *   ├────────┴──────────┴────────┤
 *   │          Terminal          │   ← 縦並び（column）の下側
 *   └────────────────────────────┘
 *
 * 木の形:
 *   split(column)
 *   ├── split(row)
 *   │   ├── group[files]   240px
 *   │   ├── group[editor]  残り
 *   │   └── group[git]     280px
 *   └── group[terminal]    220px
 *
 * id を手書きの固定値にしているのは、初期レイアウトが常に同じ形になるようにするため
 * （テストと開発時の確認で id を当てにできる）。
 * 操作の途中で生まれる領域の id は nodeId.ts が発番する。
 */
export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  root: {
    kind: 'split',
    id: asDockNodeId('root'),
    direction: 'column',
    size: null,
    children: [
      {
        kind: 'split',
        id: asDockNodeId('main-row'),
        direction: 'row',
        size: null,
        children: [
          {
            kind: 'group',
            id: asDockNodeId('left'),
            panelIds: ['files'],
            activePanelId: 'files',
            size: 240
          },
          {
            kind: 'group',
            id: asDockNodeId('center'),
            panelIds: ['editor'],
            activePanelId: 'editor',
            size: null
          },
          {
            kind: 'group',
            id: asDockNodeId('right'),
            panelIds: ['git'],
            activePanelId: 'git',
            size: 280
          }
        ]
      },
      {
        kind: 'group',
        id: asDockNodeId('bottom'),
        panelIds: ['terminal'],
        activePanelId: 'terminal',
        size: 220
      }
    ]
  }
}
