/**
 * Files（Workspace のファイルツリー）が扱う値の型と定数。
 *
 * ## Workspace Layout とは別のモデルにする
 *
 * レイアウト（shared/workspace/layoutDocument.ts）は「利用者が組んだ画面の配置」で、
 * 保存され、復元され、過去のファイルとの互換性を守る対象になる。
 * ここで扱うのは「今ディスクにあるもの」の写しでしかなく、保存もしなければ
 * 互換性を守る相手もいない（次に読めば作り直される）。
 * 混ぜると、ディスクの都合でレイアウトの保存形式を変えることになる。
 *
 * ## Renderer が持つのは relativePath であって絶対パスではない
 *
 * FileEntry に絶対パスを入れていないのは、入れた時点で Renderer が
 * 「OS 上の場所」を正本として持ち始めるため。Renderer が言えるのは
 * 「今の Workspace の中の、この相対位置」までに留める（ARCHITECTURE.md §9.3）。
 *
 * 区切りは OS の表記ではなく **常に `/`** にする。Renderer から見れば単なるキーであり、
 * OS の区切り文字を持ち込むと Renderer に OS 依存が入る（DESIGN.md §8）。
 * OS のパスへ戻すのは Main の仕事。
 *
 * shared 層のルールどおり、このファイルは型と定数だけを持つ（実装は置かない）。
 */

/**
 * Workspace root 自身を指す relativePath。
 *
 * 空文字にしているのは、root を特別扱いしないため。`join(root, '')` は root になり、
 * 木を辿る処理も root だけ別の型にせずに書ける。
 */
export const WORKSPACE_ROOT_RELATIVE_PATH = ''

/**
 * relativePath の長さの上限。
 *
 * 境界の外（Renderer）から来た値をそのまま fs へ渡さないための歯止め。
 * rootPath 側の上限（WORKSPACE_ROOT_PATH_MAX_LENGTH）と揃えてある。
 */
export const FILES_RELATIVE_PATH_MAX_LENGTH = 1024

/**
 * 1回の読み込みで返すエントリ数の上限。
 *
 * node_modules のように数万件を持つフォルダはいくらでもあり、
 * 全件を IPC で運ぶと Renderer が描く前に固まる。上限で切って
 * 「まだ続きがある」ことを truncated で伝える方が、行き止まりにならない。
 */
export const FILES_DIRECTORY_MAX_ENTRIES = 5000

/** ファイルかフォルダか。シンボリックリンクは指し先の種別として扱う。 */
export type FileEntryType = 'file' | 'directory'

/**
 * ツリーに並ぶ1件。
 *
 * hasChildren を持たないのは、それを知るには子フォルダを1つずつ開く必要があり、
 * Lazy Load（開いたときに初めて読む）の意味が無くなるため。
 * 空のフォルダは「展開したら何も無かった」として表示側で扱う。
 */
export interface FileEntry {
  /**
   * ツリー上での一意な鍵。
   *
   * relativePath と種別を組にしてある（`d:src/main` / `f:src/main/index.ts`）。
   * 同じ名前がファイルからフォルダへ置き換わったとき、id が変われば
   * 表示側の選択状態・展開状態がその場で無効になる（別のものとして扱われる）。
   */
  readonly id: string
  /** 表示名（フォルダ内での名前）。 */
  readonly name: string
  /** Workspace root からの相対位置。区切りは常に `/`。root 自身は空文字。 */
  readonly relativePath: string
  readonly type: FileEntryType
  /**
   * 拡張子（小数点なし・小文字）。フォルダと、拡張子を持たないファイルは null。
   *
   * 今は使っていないが、アイコンの出し分けと Editor で開くときの言語判定が
   * どちらもこの値から始まるため、列挙の時点で拾っておく。
   */
  readonly extension: string | null
}
