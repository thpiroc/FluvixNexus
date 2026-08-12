import type { JSX } from 'react'
import { PanelPlaceholder } from './PanelPlaceholder'

/**
 * Files パネル（仮）。
 *
 * 実ファイル操作は Renderer では行わず、main/ipc/handlers/files.ts + preload/api/files.ts を
 * 追加したうえで window.fluvix 経由で呼ぶ（ARCHITECTURE.md §6）。
 */
export function FilesPanel(): JSX.Element {
  return (
    <PanelPlaceholder
      summary="プロジェクトのファイル管理。"
      upcoming={[
        'ファイルツリー表示（縦長時）',
        'カラム表示（横長時 / レスポンシブ・パネル）',
        '作成・リネーム・削除・移動',
        'ファイル変更の検知（Main → Renderer のイベント経路が前提）'
      ]}
    />
  )
}
