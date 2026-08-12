/**
 * Workspace 契約レイヤーの公開窓口。
 *
 * Main / Preload / Renderer はこのモジュール経由で保存形式の型と定数を参照する。
 * shared 層のルールどおり、ここに実装は置かない。
 */
export {
  WORKSPACE_LAYOUT_DOCUMENT_MAX_BYTES,
  WORKSPACE_LAYOUT_SCHEMA_VERSION
} from './layoutDocument'

export type {
  StoredDockGroupNode,
  StoredDockNode,
  StoredDockSplitNode,
  StoredSplitDirection,
  StoredWorkspaceLayout,
  WorkspaceLayoutDocument
} from './layoutDocument'
