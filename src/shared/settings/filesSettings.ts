/**
 * Files の見え方の保存形式（Session 3-6-8）。
 *
 * Session 3-6-7 の時点では、選んだ表示方式（ツリー / カラム）はアプリを閉じると
 * 忘れていた（ARCHITECTURE.md §10.13「この節の範囲外」）。**選び直しが毎回要る**のは、
 * 置き場所を決めて使う道具としては筋が通らない ── パネルの配置は Session 2-6 から
 * 保たれているのに、その中の見え方だけが戻る。
 *
 * ## Editor の設定と同じ形にする（別ファイル・別チャンネル）
 *
 * `editor-settings.json` に相乗りさせず `files-settings.json` を足す。
 * 用途ごとに API を切る方針（ARCHITECTURE.md §5）そのもので、
 * 混ぜると「Editor の設定」という限定が最初の相乗りで消える。
 *
 * ## 実行時モデルとは別の型にする
 *
 * 実行時の値は renderer/src/files/filesSettings.ts の `FilesViewSettings`。
 * 分けてある理由は editorSettings.ts と同じで、
 *
 *   保存形式   … 過去のファイルを読めなくしてはいけない。変えるなら schemaVersion を上げる
 *   実行時モデル … いつでも変えてよい
 *
 * `mode` を素の `string` で持つのも同じ線にあたる。**ファイルの中身は型では守れない。**
 * 知らない mode（アプリをダウングレードした場合など）をどうするかは、読む側
 * （renderer/src/files/filesSettings.ts）が決める。
 *
 * ## Workspace ごとには持たない
 *
 * 表示方式もカラムの幅も**パネルの見え方**であって、開いているフォルダの持ち物ではない
 * （ARCHITECTURE.md §10.13）。Workspace を切り替えても変わらないため、
 * 保存先も Workspace とは無関係な1つになる。
 *
 * ## 保存先
 *
 * `%APPDATA%/Fluvix Nexus/files-settings.json`。Renderer はファイルにもパスにも触れない。
 */

export const FILES_SETTINGS_SCHEMA_VERSION = 1

/**
 * 保存文書の上限（バイト）。
 *
 * 中身は mode と幅の2つしかなく、数十バイトの JSON にしかならない。
 * 桁違いに大きな内容をそのままディスクへ残さないための頭打ちで、Editor 設定と同じ考え方。
 */
export const FILES_SETTINGS_DOCUMENT_MAX_BYTES = 16 * 1024

/** Files の見え方（保存形式）。 */
export interface StoredFilesViewSettings {
  /**
   * `auto` / `tree` / `columns`。知らない値は読む側が既定へ落とす。
   *
   * **`auto` を「選んでいない」として保存する。** 保存しないことで表すと、
   * 「一度カラムを選んでから、パネルの形に任せる状態へ戻した」ことが次回に伝わらず、
   * 前回の explicit がそのまま残ることになる。
   */
  readonly mode: string
  /** カラム1枚の幅（px）。上下限は読む側が掛ける。 */
  readonly columnWidth: number
}

/** Files の設定文書。 */
export interface FilesSettingsDocument {
  readonly schemaVersion: number
  readonly view: StoredFilesViewSettings
}
