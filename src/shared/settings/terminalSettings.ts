/**
 * Terminal の見え方の保存形式（Session 3-7-5）。
 *
 * Session 3-7-3 の時点では、文字の大きさは Ctrl + `+` / `-` / `0` で変えられるものの
 * **開き直せば 13px に戻り**、さかのぼれる行数は 5000 の固定値だった
 * （ARCHITECTURE.md §13.11「文字の大きさの永続化」）。端末は毎日開く道具で、
 * 開くたびに文字を大きくし直すのは、パネルの配置が Session 2-6 から保たれているのに
 * その中の文字だけが戻る、という食い違いになる。
 *
 * ## Editor / Files の設定と同じ形にする（別ファイル・別チャンネル）
 *
 * `editor-settings.json` にも `files-settings.json` にも相乗りさせず
 * `terminal-settings.json` を足す。用途ごとに API を切る方針
 * （ARCHITECTURE.md §5）そのもので、混ぜると「Editor の設定」という限定が
 * 最初の相乗りで消える。ここは3つめの利用者にあたるが、**形は2つめ（Files）と
 * 一字も変えていない** ── 3つ並んで初めて「これがこのアプリの設定の形」になる。
 *
 * ## 実行時モデルとは別の型にする
 *
 * 実行時の値は renderer/src/terminal/terminalSettings.ts の `TerminalDisplaySettings`。
 * 分けてある理由は editorSettings.ts / filesSettings.ts と同じで、
 *
 *   保存形式   … 過去のファイルを読めなくしてはいけない。変えるなら schemaVersion を上げる
 *   実行時モデル … いつでも変えてよい
 *
 * 数値をそのまま `number` で持ち、上下限を型で表さないのも同じ線にあたる。
 * **ファイルの中身は型では守れない。** 範囲の外の値をどうするかは、読む側
 * （renderer/src/terminal/terminalDisplay.ts の clamp）が決める。
 *
 * ## Workspace ごとには持たない
 *
 * 文字の大きさもさかのぼれる行数も**パネルの見え方**であって、開いているフォルダの
 * 持ち物ではない（Files の見え方と同じ扱い。ARCHITECTURE.md §10.13）。
 * Workspace を切り替えても変わらないため、保存先も Workspace とは無関係な1つになる。
 *
 * ## 保存先
 *
 * `%APPDATA%/Fluvix Nexus/terminal-settings.json`。Renderer はファイルにもパスにも触れない。
 */

export const TERMINAL_SETTINGS_SCHEMA_VERSION = 1

/**
 * 保存文書の上限（バイト）。
 *
 * 中身は数が2つしかなく、数十バイトの JSON にしかならない。
 * 桁違いに大きな内容をそのままディスクへ残さないための頭打ちで、
 * Editor / Files の設定と同じ考え方。
 */
export const TERMINAL_SETTINGS_DOCUMENT_MAX_BYTES = 16 * 1024

/** 端末の見え方（保存形式）。 */
export interface StoredTerminalDisplaySettings {
  /** 文字の大きさ（px）。上下限は読む側が掛ける。 */
  readonly fontSize: number
  /** さかのぼれる行数。上下限は読む側が掛ける。 */
  readonly scrollback: number
}

/** Terminal の設定文書。 */
export interface TerminalSettingsDocument {
  readonly schemaVersion: number
  readonly display: StoredTerminalDisplaySettings
}
