/**
 * Workspace（開いているプロジェクトフォルダ）の型と、その永続化フォーマット。
 *
 * ## 「Workspace」という語について
 *
 * この実装では次のように呼び分ける（DESIGN.md §3 の用語表）。
 *
 *   Workspace Folder … 今開いているプロジェクトフォルダ（このファイルが扱うもの）
 *   Workspace Shell  … 画面全体の器（Dockable UI。renderer/src/workspace/）
 *   Workspace Layout … その器の配置（shared/workspace/layoutDocument.ts）
 *
 * IPC ドメインも同じ理由で分けてある。レイアウトは `workspace:*`、
 * プロジェクトフォルダは `workspace-folder:*`。
 *
 * ## 保存形式と実行時の値を分ける
 *
 * レイアウト（layoutDocument.ts）と同じ理由で、ディスクに置く形（StoredWorkspaceFolder）と
 * Renderer へ渡す形（WorkspaceFolder）を別の型にしてある。
 * 守るべき互換性の対象が違うため。
 *
 *   保存形式   … 過去のファイルを読めなくしてはいけない。変えるときは schemaVersion を上げる
 *   実行時の値 … いつでも変えてよい（例: exists のような「今どうか」を足せる）
 *
 * shared 層のルールどおり、このファイルは型と定数だけを持つ（実装は置かない）。
 */

/**
 * 保存データの構造バージョン。
 *
 * lastWorkspace の形を変えたら必ず上げ、main/store/workspaceFolderDocument.ts に
 * 「1つ前から今の形へ」の変換を足すこと。
 */
export const WORKSPACE_FOLDER_SCHEMA_VERSION = 1

/**
 * 保存データの上限（おおよそのバイト数）。
 *
 * 保存されるのはフォルダ1件の情報でしかなく、通常は 1KB にも満たない。
 * それでも上限を設けるのは、破損や想定外の使われ方を「桁違いの大きさ」として弾くため。
 */
export const WORKSPACE_FOLDER_DOCUMENT_MAX_BYTES = 64 * 1024

/**
 * rootPath の長さの上限。
 *
 * Windows の拡張パス（`\\?\` 付き）でも 32767 文字までだが、Workspace として開くフォルダが
 * その桁になることは無い。境界の外から来た値をそのままディスクへ書かないための歯止め。
 */
export const WORKSPACE_ROOT_PATH_MAX_LENGTH = 1024

/**
 * 保存形式での Workspace。
 *
 * 「次回起動時に同じフォルダを開き直すために必要なもの」だけを持つ。
 * exists を持たないのは、それが保存した時点の事実でしかなく、次回起動時には
 * 改めて確かめ直す必要があるため（保存された「存在した」は信用できない）。
 */
export interface StoredWorkspaceFolder {
  /**
   * Workspace を開いた記録1件の識別子。
   *
   * 同じフォルダを開き直せば別の id になる（＝フォルダの識別子ではない）。
   * 「最近開いた一覧」を足す際は rootPath で重複を判定し、id は一覧の項目を
   * 指す鍵として使う（Renderer からパスを渡さずに開き直せるようにするため。§ 下の recent を参照）。
   */
  readonly id: string
  /** 絶対パス。区切りは OS の表記のまま持つ。 */
  readonly rootPath: string
  /** UI に出す名前。既定はフォルダ名で、将来の「名前を付ける」に備えて別の項目にしてある。 */
  readonly displayName: string
  /** 開いた時刻（epoch ミリ秒）。「最近開いた順」の並べ替えに使う。 */
  readonly openedAt: number
}

/**
 * Renderer が受け取る Workspace。
 *
 * 保存形式に「今どうか」を足したもの。
 */
export interface WorkspaceFolder extends StoredWorkspaceFolder {
  /**
   * この値を作った時点で rootPath が実在するフォルダだったか。
   *
   * **現在の Workspace として返るものは常に true** になる。存在しないフォルダは
   * Workspace にせず未選択の状態に戻すため（DESIGN.md §3・ARCHITECTURE.md §8.5）。
   * false が現れるのは「最近開いた一覧」を足したときで、消えたフォルダの項目を
   * 一覧から消さずに選べない状態で見せるために要る。
   */
  readonly exists: boolean
}

/**
 * ディスクに置かれる文書そのもの。
 *
 * lastWorkspace は「現在開いている Workspace」ではなく **次回起動時に復元する対象**。
 * Workspace を閉じれば null になり、次回は未選択の状態で起動する。
 *
 * 「最近開いた一覧」（DESIGN.md §3）を足すときは、この文書に
 * `recent: readonly StoredWorkspaceFolder[]` を増やす形になる。
 * schemaVersion を上げて、無い場合は空配列として読めばよい。
 */
export interface WorkspaceFolderDocument {
  readonly schemaVersion: number
  readonly lastWorkspace: StoredWorkspaceFolder | null
}
