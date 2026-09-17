import { normalizeKey } from './editKeybindings'
import { whenOverlaps, type WhenClause } from './when'

/**
 * 予約キー（Shortcuts S5）。
 *
 * React にも DOM にも依存しない純粋な層。
 *
 * **割り当ての表（defaults.ts）の外で、すでに意味を持っている打鍵**の一覧。
 * command に割り当てること自体はできる（editKeybindings.ts の `isAssignableChord`
 * が断るのは「文字が打てなくなる」ものだけ）が、割り当てると何かと重なるので、
 * 記録中と一覧の行で警告を出す。
 *
 * ## 載せる基準
 *
 * **コードか実機で、その打鍵を誰かが使っていると確かめたものだけ。**
 * Monaco の打鍵をすべて並べることはしない ── エディターの中ではエディター自身の
 * 打鍵が優先される、という断りは一覧の下に常に出ている（`editNote`）。
 * ここに載せるのは、その断りだけでは分からない害のあるもの。
 *
 * | 理由               | 使っている所                                        | 重なるとどうなるか |
 * | ------------------ | --------------------------------------------------- | ------------------ |
 * | `textEditing`      | 入力欄の既定動作（Chromium）                        | 入力欄でコピー等ができなくなる（KeybindingProvider が実行した打鍵の既定を止める） |
 * | `editorFind`       | Monaco の検索・置換（S2 で実機確認）                | エディターの中では割り当てが効かない |
 * | `terminalFontSize` | terminal/terminalDisplay.ts（preventDefault のみ）  | 端末の中で両方が動く |
 * | `terminalClipboard`| xterm のコピー・貼り付け（S2 で実機確認）            | 端末の中で重なる |
 * | `gitCommit`        | git/GitView.tsx の Commit 欄（preventDefault のみ） | Commit 欄で両方が動く |
 * | `filesRename`      | files/FileTree.tsx・FileColumns.tsx（preventDefault のみ） | Files で両方が動く |
 * | `commandPalette`   | defaults.ts が空けてある席                          | 将来の版で重なる |
 * | `imeToggle`        | 日本語配列の半角/全角の位置（defaults.ts）          | IME の切り替えとぶつかる |
 * | `windowClose`      | Windows（Alt+F4）                                   | ウィンドウが閉じる |
 *
 * ## 条件（when）で絞る
 *
 * 予約の側にも「どこで使われているか」を `when` で持たせ、割り当てる command の
 * 条件と**同時に成り立ちうるときだけ**警告する（`whenOverlaps`）。
 * F2 は Files で名前の変更に使われているが、`editor.renameSymbol` の既定の条件は
 * `editorFocused` なので重ならない ── 既定の割り当てが自分で警告を出すことは無い
 * （reservedKeys.test.ts が確かめている）。
 *
 * Files / Git の Commit 欄は条件の名前を持たないので、「エディターでも端末でもない所」
 * （`!editorFocused` + `!terminalFocused`）で表す。入力欄も同じ場所にある。
 */

export type ReservedKeyReason =
  | 'textEditing'
  | 'editorFind'
  | 'terminalFontSize'
  | 'terminalClipboard'
  | 'gitCommit'
  | 'filesRename'
  | 'commandPalette'
  | 'imeToggle'
  | 'windowClose'

export interface ReservedKey {
  /** `chordToken` の形。 */
  readonly key: string
  readonly reason: ReservedKeyReason
  /** その打鍵が使われている場所。空ならどこでも。 */
  readonly when: readonly WhenClause[]
}

const OUTSIDE_EDITOR_AND_TERMINAL: readonly WhenClause[] = ['!editorFocused', '!terminalFocused']

function reserve(
  keys: readonly string[],
  reason: ReservedKeyReason,
  when: readonly WhenClause[]
): readonly ReservedKey[] {
  return keys.map((key) => ({ key, reason, when }))
}

export const RESERVED_KEYS: readonly ReservedKey[] = [
  ...reserve(
    ['ctrl+c', 'ctrl+x', 'ctrl+v', 'ctrl+z', 'ctrl+y', 'ctrl+shift+z', 'ctrl+a'],
    'textEditing',
    []
  ),
  ...reserve(['ctrl+f', 'ctrl+h'], 'editorFind', ['editorFocused']),
  /*
    端末の文字の大きさは `event.key` で見ている（terminalDisplay.ts）。
    ここは `event.code` 基準の打鍵なので、US 配列と日本語配列の両方で
    `+` / `=` / `-` / `_` / `0` になる物理キーを並べてある。

      US … `=`（Equal）/ Shift+`=` で `+` / `-`（Minus）/ Shift+`-` で `_`
      JP … Shift+`;` で `+` / Shift+`-` で `=` / `-` / Shift+`\`（IntlRo → `_`）
  */
  ...reserve(
    ['ctrl+=', 'ctrl+shift+=', 'ctrl+-', 'ctrl+shift+-', 'ctrl+0', 'ctrl+shift+;', 'ctrl+shift+_'],
    'terminalFontSize',
    ['terminalFocused']
  ),
  ...reserve(['ctrl+insert', 'ctrl+shift+v'], 'terminalClipboard', ['terminalFocused']),
  ...reserve(['ctrl+enter', 'meta+enter'], 'gitCommit', OUTSIDE_EDITOR_AND_TERMINAL),
  ...reserve(['f2'], 'filesRename', OUTSIDE_EDITOR_AND_TERMINAL),
  ...reserve(['ctrl+p', 'ctrl+shift+p'], 'commandPalette', []),
  ...reserve(['ctrl+`', 'alt+`'], 'imeToggle', []),
  ...reserve(['alt+f4'], 'windowClose', [])
]

/**
 * その打鍵を、その条件の command に割り当てたときに重なる予約（理由の並び・重複なし）。
 *
 * `key` は `chordToken` の形でも `'Ctrl+P'` のような書き方でもよい。
 */
export function reservedKeyReasons(
  key: string,
  when: readonly WhenClause[],
  reserved: readonly ReservedKey[] = RESERVED_KEYS
): readonly ReservedKeyReason[] {
  const token = normalizeKey(key)

  if (token === null) {
    return []
  }

  const reasons = reserved
    .filter((entry) => normalizeKey(entry.key) === token && whenOverlaps(entry.when, when))
    .map((entry) => entry.reason)

  return [...new Set(reasons)]
}
