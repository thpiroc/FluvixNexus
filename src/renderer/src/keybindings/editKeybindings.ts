import { KEYBINDING_REMOVAL_PREFIX, type StoredKeybindingEntry } from '@shared/keybindings'
import type { CommandId } from '../commands/commandIds'
import { chordToken, parseKeybinding, type KeyChord } from './chord'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { resolveKeybindings, type KeybindingRule } from './resolve'
import { readUserKeybindings } from './userKeybindings'

/**
 * Settings の一覧から割り当てを変える（Shortcuts S4）。
 *
 * React にも DOM にも依存しない純粋な層。画面（settings/KeyboardShortcutsView.tsx）は
 * 「この操作の打鍵を、この並びにしたい」を決めるだけで、`keybindings.json` の
 * 行をどう書くかはここが決める。
 *
 * ## 操作ごとに「その command の行」を書き直す
 *
 * 変更・解除・デフォルトへ戻すの3つは、どれも
 *
 * ```
 * withCommandKeys(stored, commandId, 欲しい打鍵の並び)
 * ```
 *
 * の1本で表せる。その command の（読める）行をいったん全部消し、
 * **既定との差分だけ**を末尾に書き足す。
 *
 *   - 既定にあって欲しくない打鍵 → `-command`（解除）
 *   - 既定に無くて欲しい打鍵     → `command`（追加）
 *   - 既定と同じ並び             → 何も書かない（＝デフォルトへ戻す）
 *
 * 変更を「前の行に1行足す」形で積むと、変えては戻すを繰り返すうちに
 * 打ち消し合う行がファイルに溜まる。差分で書き直せば、ファイルの行は常に
 * 「既定から何が変わっているか」そのものになり、手で読んでも分かる。
 *
 * 末尾に書くのは、解除の rule が「前にある同じ打鍵」だけを外す規則
 * （resolve.ts）と、ユーザーの行はいつも既定より後ろに連結されることによる ──
 * 既定の割り当てを外すのに、ファイルの中での位置は問わない。
 *
 * ## 読めない行には触らない
 *
 * `readUserKeybindings` が `invalid` にした行（知らない command・読めない打鍵・
 * `when` 付き）は、その command の行でも**消さずに元の位置へ残す。**
 * 手で書いた行を画面の操作が黙って消すと、「書いたのに無くなった」になる
 * （読めない行を見せるのは S5）。全体をデフォルトへ戻すときだけは、
 * ファイルを空にする ── その名前の通りの操作にあたる。
 */

/**
 * その command に今付いている打鍵（`chordToken` の形。並び順のまま・重複なし）。
 *
 * 表全体（KeybindingProvider の `entries`）からではなく、**その command の
 * rule だけ**を畳んで求める。別の command が同じ打鍵を後勝ちで奪っていても、
 * この command の側の意図（どの打鍵を持たせたか）は変わらないため ──
 * 表から読むと、奪われた打鍵を編集のたびに黙って捨てることになる。
 */
export function commandKeys(
  commandId: CommandId,
  userRules: readonly KeybindingRule[],
  defaults: readonly KeybindingRule[] = DEFAULT_KEYBINDINGS
): readonly string[] {
  const own = [...defaults, ...userRules].filter((rule) => rule.commandId === commandId)

  return unique(resolveKeybindings(own).entries.map((entry) => entry.token))
}

/** その command の既定の打鍵（`chordToken` の形）。 */
export function defaultCommandKeys(
  commandId: CommandId,
  defaults: readonly KeybindingRule[] = DEFAULT_KEYBINDINGS
): readonly string[] {
  return commandKeys(commandId, [], defaults)
}

/**
 * 既定から変えられている command。
 *
 * 「ユーザーの行があるか」ではなく**打鍵の組が既定と違うか**で見る。
 * 手で `-editor.save` と `editor.save` を同じ打鍵で並べたファイルは、
 * 行はあっても効いているものは既定と同じ ── 「変更済み」と出すと、
 * 戻しても何も変わらないボタンを見せることになる。
 */
export function modifiedCommandIds(
  userRules: readonly KeybindingRule[],
  defaults: readonly KeybindingRule[] = DEFAULT_KEYBINDINGS
): ReadonlySet<CommandId> {
  const touched = new Set(userRules.map((rule) => rule.commandId))
  const modified = new Set<CommandId>()

  for (const commandId of touched) {
    if (
      !sameKeySet(
        commandKeys(commandId, userRules, defaults),
        defaultCommandKeys(commandId, defaults)
      )
    ) {
      modified.add(commandId)
    }
  }

  return modified
}

/**
 * その command の打鍵が `keys` になるように、ファイルの行を書き直す。
 *
 * 並びの意味はこのファイルの冒頭。`keys` は `chordToken` の形でも
 * `'Ctrl+S'` のような書き方でもよい（読めないものは落とす）。
 */
export function withCommandKeys(
  stored: readonly StoredKeybindingEntry[],
  commandId: CommandId,
  keys: readonly string[],
  defaults: readonly KeybindingRule[] = DEFAULT_KEYBINDINGS
): readonly StoredKeybindingEntry[] {
  const invalidIndexes = new Set(readUserKeybindings(stored, defaults).invalid.map((i) => i.index))
  const removal = `${KEYBINDING_REMOVAL_PREFIX}${commandId}`

  const kept = stored.filter(
    (entry, index) =>
      invalidIndexes.has(index) || (entry.command !== commandId && entry.command !== removal)
  )

  const wanted = unique(keys.map(normalizeKey).filter((key): key is string => key !== null))
  const initial = defaultCommandKeys(commandId, defaults)

  const removals = initial
    .filter((key) => !wanted.includes(key))
    .map((key) => ({ key, command: removal }))
  const additions = wanted
    .filter((key) => !initial.includes(key))
    .map((key) => ({ key, command: commandId }))

  return [...kept, ...removals, ...additions]
}

/**
 * 打鍵の並びの `from` を `to` に置き換える（`from` が null なら末尾に足す）。
 *
 * `to` が既に並んでいれば増やさない ── 同じ操作に同じ打鍵を2つ持たせても
 * 意味が無い。
 */
export function replaceKey(
  keys: readonly string[],
  from: string | null,
  to: string
): readonly string[] {
  const replaced = from === null ? [...keys, to] : keys.map((key) => (key === from ? to : key))

  return unique(replaced)
}

/**
 * 記録した打鍵を割り当ててよいか。
 *
 * **Ctrl / Alt / Meta のどれかが付いているか、F1〜F24 であること。**
 *
 * それ以外（`a` / `Shift+A` / `Enter` / `Backspace` / 矢印 …）は、
 * 割り当てた瞬間に**すべての入力欄で文字が打てなくなる** ──
 * KeybindingProvider は打鍵が入力欄で起きたかを見ないため
 * （あちらの「`event.defaultPrevented` を見て降りる形にはしていない」）。
 * これは警告（S5）ではなく、割り当てとして成り立たないものとして断る。
 */
export function isAssignableChord(chord: KeyChord): boolean {
  if (chord.ctrl || chord.alt || chord.meta) {
    return true
  }

  return /^f([1-9]|1[0-9]|2[0-4])$/.test(chord.key)
}

/** 打鍵を `chordToken` の形へ。読めなければ null。 */
export function normalizeKey(key: string): string | null {
  const chord = parseKeybinding(key)

  return chord === null ? null : chordToken(chord)
}

function sameKeySet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
