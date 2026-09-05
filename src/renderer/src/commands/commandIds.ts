/**
 * Command の識別子（Session 4-7A）。
 *
 * Keyboard Shortcut 基盤は **command（何をするか）** と **shortcut（どの打鍵で呼ぶか）**
 * を分けて持つ。このファイルが持つのは前者の名前だけで、打鍵は1つも出てこない
 * （keybindings/defaults.ts）。分けておくと、
 *
 *   - 同じ command を複数の入口（打鍵・メニュー・将来の Command Palette）から呼べる
 *   - 打鍵を変えても command 側は1行も変わらない
 *   - 割り当ての無い command が「一覧に出るが打鍵は空」として自然に表せる
 *
 * となる。
 *
 * ## 閉じた集合にする
 *
 * `COMMAND_IDS` に載っているものだけが command で、任意の文字列を command として
 * 実行する経路は存在しない。これは `shared/settings/sections.ts` の section と
 * まったく同じ理由にあたる ── **任意の名前を許した時点で「アプリが決めた操作」
 * という限定が消える。** 将来 `keybindings.json` からユーザーの割り当てを読むように
 * なったとき、そこに書かれた command 名は必ず `isCommandId` を通す
 * （`workspace/panels/registry.ts` の `isPanelId`・
 * `shared/settings/sections.ts` の `isSettingsSectionId` と同じ作法）。
 *
 * **`execute(id: string)` のような汎用の入口を作らないこと。** 作った瞬間、
 * ディスクの文字列がそのまま実行対象になる。
 *
 * ## 名前の付け方
 *
 * `<領域>.<動詞>` の2段（`view.togglePanel.files` だけは対象が続く3段）。
 * 領域は `CommandCategory`（types.ts）と対応させてあり、Session 4-7B で
 * Settings の Keyboard Shortcuts 画面に並べるときの区切りになる。
 *
 * **一度決めた id は変えない。** 将来ユーザーの割り当てがディスクに残るため、
 * 名前を変えると「その人が設定した打鍵だけが静かに効かなくなる」。
 *
 * ## Session 4-7A に載せていないもの
 *
 * Git（`git.commit` / `git.push` …）と Files 検索（`files.search.*`）は
 * handler が panel の中（`GitView` / `FilesView` のローカル state）にあり、
 * 所有者が自分で登録する形（contribution）になる。**Session 4-7B の範囲。**
 *
 * Terminal の文字の大きさ（Ctrl + `+` / `-` / `0`）もここには無い。既存の経路
 * （`terminal/terminalDisplay.ts` → `TerminalSurface.tsx` の `onAppKey`）を
 * 1行も変えないためで、あちらは日本語配列のための `=` / `_` の読み替えを持っている
 * ── registry へ移すなら、その読み替えごと設計し直すことになる（4-7B）。
 *
 * `Ctrl+P` / `Ctrl+Shift+P` は **Command Palette のために空けてある**。
 * ここにも defaults.ts にも現れない。
 */

/**
 * 既知の command の名前。
 *
 * 並びは `CommandCategory` の順（workspace / editor / view / settings）。
 * 配列リテラルなので同じ名前を2つ書くこと自体は防げないが、
 * registry.ts の `Record<CommandId, …>` が同じ key を2度書けないため、
 * **重複した id は登録表の側で必ず潰れる**（registry.test.ts が実数で確かめる）。
 */
export const COMMAND_IDS = [
  'workspace.openFolder',
  'workspace.closeFolder',
  'editor.save',
  'editor.saveAs',
  'view.togglePanel.files',
  'view.togglePanel.editor',
  'view.togglePanel.terminal',
  'view.togglePanel.git',
  'view.resetLayout',
  'settings.open',
  'settings.close'
] as const

/** 既知の command の名前。ここに無い名前は command ではない。 */
export type CommandId = (typeof COMMAND_IDS)[number]

/**
 * 素の値が既知の command 名か。
 *
 * 今は使い道が無い（v1 は defaults.ts しか rule を作らない）。それでも先に
 * 置いてあるのは、**外から来た文字列を通す唯一の関門をここに固定しておく**ため
 * ── 永続化が入るとき、読み込み側がこれを呼ぶ以外の選択肢を持たない形にしておく。
 */
export function isCommandId(value: unknown): value is CommandId {
  return typeof value === 'string' && (COMMAND_IDS as readonly string[]).includes(value)
}
