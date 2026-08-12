import type { WorkspaceLayoutDocument } from '../../workspace/layoutDocument'

/**
 * workspace ドメインの IPC 契約。
 *
 * 扱うのは **Workspace レイアウトの保存 / 読み込みだけ**に限定する。
 * Renderer から任意のパスを渡して読み書きできる汎用のファイル API は作らない
 * （保存先・ファイル名・書き込み方はすべて Main 側が決める）。
 * この限定が、Renderer を OS から切り離すという STEP 1 の前提を保つ実体になる。
 *
 * 運ぶのは保存形式そのもの（shared/workspace/layoutDocument.ts）で、
 * Main はそのうち schemaVersion しか解釈しない。
 */

export interface LoadWorkspaceLayoutResponse {
  /**
   * 保存済みのレイアウト。
   *
   * 次の場合は null になり、Renderer は Default Layout で起動する。
   *   - まだ一度も保存していない（初回起動）
   *   - ファイルが壊れていて JSON として読めない
   *   - 文書の形（schemaVersion / layout）が想定外
   */
  readonly document: WorkspaceLayoutDocument | null
}

export interface SaveWorkspaceLayoutRequest {
  readonly document: WorkspaceLayoutDocument
}

export interface WorkspaceIpcContract {
  'workspace:load-layout': {
    request: void
    response: LoadWorkspaceLayoutResponse
  }
  'workspace:save-layout': {
    request: SaveWorkspaceLayoutRequest
    response: void
  }
}
