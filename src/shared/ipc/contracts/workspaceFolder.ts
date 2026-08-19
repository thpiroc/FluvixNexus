import type { WorkspaceFolder } from '../../workspace/folder'

/**
 * workspace-folder ドメインの IPC 契約（開いているプロジェクトフォルダ）。
 *
 * レイアウトの `workspace:*` とは別のドメインとして分けてある（語の使い分けは
 * shared/workspace/folder.ts の冒頭）。
 *
 * **公開するのは Workspace の切り替えだけ**で、フォルダの中身を読む API はここに置かない。
 * ファイルの列挙・読み書きは Files ドメイン（STEP 3 の後続セッション）の担当であり、
 * この契約が広がると「Renderer は OS に触れない」という前提がここで崩れる。
 *
 * パスは **Renderer から渡さない**。開く対象を決めるのはネイティブのフォルダ選択
 * ダイアログ（Main が出す）だけで、Renderer は「ダイアログを出して」としか言えない。
 * 「最近開いた一覧」から開き直す操作を足すときも、Renderer が渡すのは一覧の項目の id とし、
 * パスは Main が自分の持っている一覧から引く（ARCHITECTURE.md §8.4）。
 */

export interface GetCurrentWorkspaceFolderResponse {
  /** 今開いている Workspace。未選択なら null。 */
  readonly workspace: WorkspaceFolder | null
  /**
   * 復元できなかった前回の rootPath。
   *
   * 保存されていた Workspace のフォルダが見つからず、未選択の状態で起動したときだけ入る。
   * 黙って Welcome を出すと利用者には「前回の状態が消えた」ようにしか見えないため、
   * 理由を UI に出せるようにしている。
   */
  readonly unavailableRootPath: string | null
}

/**
 * フォルダ選択の結果。
 *
 * 取り消しを IpcResult の失敗（CANCELLED）にしていないのは、取り消しが
 * 「失敗」ではなく通常の結末だから。失敗として返すと、Renderer 側の対応表
 * （renderer/src/api/result.ts）が持つエラー文言を出さないための分岐が要る。
 */
export type OpenWorkspaceFolderResponse =
  | { readonly status: 'opened'; readonly workspace: WorkspaceFolder }
  | { readonly status: 'cancelled' }

export interface WorkspaceFolderIpcContract {
  'workspace-folder:get-current': {
    request: void
    response: GetCurrentWorkspaceFolderResponse
  }
  'workspace-folder:open': {
    request: void
    response: OpenWorkspaceFolderResponse
  }
  'workspace-folder:close': {
    request: void
    response: void
  }
}
