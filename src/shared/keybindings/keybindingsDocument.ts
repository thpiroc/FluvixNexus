/**
 * `keybindings.json` の保存形式（Shortcuts S3）。
 *
 * ## 形は VS Code と同じ「素の配列」
 *
 * ```json
 * [
 *   { "key": "ctrl+alt+s", "command": "editor.save" },
 *   { "key": "ctrl+s", "command": "-editor.save" }
 * ]
 * ```
 *
 * `settings.json` の section に入れないのは、あちらの値が string / number /
 * boolean に閉じており**配列を持てない**ため（main/store/settingsSections.ts）。
 * 封筒（`schemaVersion`）を付けていないのも VS Code に合わせたもので、
 * 利用者が手で書く・貼り付けるファイルとして、見たままの形を保つ。
 *
 * ## 並び順に意味がある
 *
 * 後ろにある行が勝つ（renderer/src/keybindings/resolve.ts）。`-command` の行は
 * **それより前にある**同じ command × 同じ打鍵の割り当てを外す。
 *
 * ## 分担
 *
 * shared 層のルールどおり、ここは型と定数だけを持つ。
 *
 *   - 形（文字列か・長さ・件数）を見るのは Main（main/store/keybindingsDocument.ts）
 *   - 意味（command 名・打鍵・条件）を見るのは Renderer
 *     （renderer/src/keybindings/userKeybindings.ts）
 *
 * command の一覧も打鍵の読み方も Renderer にしか無いので、Main が二重に解釈すると
 * 「どちらが正しいか」が生まれる（設定と同じ分担。main/ipc/handlers/settings.ts）。
 */

/** 保存された1行。`command` の先頭が `-` なら割り当ての解除。 */
export interface StoredKeybindingEntry {
  readonly key: string
  readonly command: string
  /**
   * 手で書かれた条件。**アプリはこの欄を書かない**（条件は既定の割り当てから
   * 引き継ぐ）。書かれていた場合に黙って捨てると「条件付きのつもりが
   * どこでも効く」になるため、Main は形だけ確かめて渡し、Renderer が
   * 読めない行として扱う。
   */
  readonly when?: string
}

/** 1ファイルに置ける行数の上限。既定の割り当ては十数件で、桁違いの量は破損とみなす。 */
export const KEYBINDINGS_MAX_ENTRIES = 500

/** `key` / `command` / `when` それぞれの文字数の上限。 */
export const KEYBINDING_TEXT_MAX_LENGTH = 256

/** 解除の行の印（`-editor.save`）。 */
export const KEYBINDING_REMOVAL_PREFIX = '-'

/**
 * 読み込みの結果。
 *
 *   missing    … ファイルが無い（初回起動。既定のまま）
 *   loaded     … 読めた（形の合わない行は `skippedCount` に数えて落とす）
 *   unreadable … JSON として読めない・配列でない（既定のまま。保存すると退避してから書く）
 */
export type KeybindingsFileStatus = 'missing' | 'loaded' | 'unreadable'
