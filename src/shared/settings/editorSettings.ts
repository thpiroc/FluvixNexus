/**
 * Editor の設定の保存形式。
 *
 * DESIGN.md §9 の Settings のうち、**最初の利用者が Auto Save** になる。
 * 設定画面そのものはまだ無いが、保存形式だけは先に決めておく
 * （後から足すと、その時点で既に保存されている値の扱いが決められない）。
 *
 * ## 実行時モデルとは別の型にする
 *
 * 実行時の設定は renderer/src/editor/autoSave.ts の `AutoSaveSettings` で、
 * こちらは**ディスクに置く形**。Workspace レイアウト（§7.8）と同じ理由で分けてある。
 *
 *   保存形式   … 過去のファイルを読めなくしてはいけない。変えるなら schemaVersion を上げる
 *   実行時モデル … いつでも変えてよい
 *
 * `mode` を `AutoSaveMode` ではなく素の `string` で持つのも同じ線
 * （StoredDockNode が `PanelId` を素の文字列で持つのと同じ）。**ファイルの中身は
 * 型では守れない。** 知らない mode が入っていた場合にどうするかは、読む側
 * （normalizeAutoSaveSettings）が決める。
 *
 * ## 保存先
 *
 * `%APPDATA%/Fluvix Nexus/editor-settings.json`。レイアウト・Workspace とは
 * 別ファイル・別 API にする（用途ごとに API を切る方針。ARCHITECTURE.md §5）。
 * Renderer はファイルにもパスにも触れない。
 */

export const EDITOR_SETTINGS_SCHEMA_VERSION = 1

/**
 * 保存文書の上限（バイト）。
 *
 * 設定は数十バイトの JSON にしかならない。桁違いに大きな内容を
 * そのままディスクへ残さないための頭打ちで、レイアウト側と同じ考え方。
 */
export const EDITOR_SETTINGS_DOCUMENT_MAX_BYTES = 16 * 1024

/** 自動保存の設定（保存形式）。 */
export interface StoredAutoSaveSettings {
  /** `off` / `afterDelay` / `onFocusChange` / `onWindowChange`。知らない値は読む側が既定へ落とす。 */
  readonly mode: string
  /** `afterDelay` の待ち時間（ミリ秒）。上下限は読む側が掛ける。 */
  readonly delayMs: number
}

/** Editor の設定文書。 */
export interface EditorSettingsDocument {
  readonly schemaVersion: number
  readonly autoSave: StoredAutoSaveSettings
}
