import type { CommandId } from '../commands/commandIds'
import type { CommandCategory, CommandDescriptor } from '../commands/types'
import { formatKeybinding } from './chord'
import { findKeybindingConflicts, type KeybindingSource, type ResolvedKeybinding } from './resolve'
import type { WhenClause } from './when'

/**
 * Settings の「Keyboard Shortcuts」に並べる行（Session 4-7A、画面は 4-7C）。
 *
 * 行の中身は Command Registry と解決済みの割り当てから機械的に決まり、
 * React も DOM も要らない ── **純粋関数で表せる**ので、画面の側
 * （`settings/KeyboardShortcutsView.tsx`）は「並べるだけ」になる。
 * `settings/settingsCatalog.ts` が並びを持ち、`SettingsOverlay.tsx` が
 * 配置だけを持つのと同じ分担にあたる。
 *
 * ## 画面が必要とするものは全部ここに出ている
 *
 * | 画面の要素 | この型のどれか                                  | v1 で出すか |
 * | ---------- | ------------------------------------------------ | ----------- |
 * | 検索       | `title` ＋ `commandId` ＋ `keybinding`（`filterShortcutRows`） | ○ |
 * | Command    | `title`（`titleKey` 経由の翻訳。Session 4-7C）   | ○ |
 * | Category   | `category`（見出しとして畳む）                   | ○ |
 * | Keybinding | `keybinding`（未割り当ては null）                | ○ |
 * | When       | `when`                                           | ✕ |
 * | Source     | `source`                                         | ✕（下記） |
 * | 競合表示   | `conflictsWith`                                  | ✕ |
 * | Reset      | `source !== 'default'`（v1 では常に false）      | ✕ |
 *
 * **`source` / `when` / `conflictsWith` を v1 の画面が出さないのは、
 * 値が1種類しか無いか、内部の識別子だから**にほかならない ── 既定しか無い今、
 * Source 列は全行に同じ語を並べるだけになり、`when` は `'!terminalFocused'` の
 * ような内部の名前をそのまま見せることになる。この型からは**外していない** ──
 * User / Workspace の割り当てが入ったとき、変わるのは画面だけで済む。
 *
 * ## Settings のカテゴリの型（Session 4-7C で広げた）
 *
 * `SettingsItemDescriptor` は `section: SettingsSectionId` を必須にしており、
 * カテゴリは「値の項目が並ぶもの」を前提にしていた。Keyboard Shortcuts は
 * 一覧表なので、`settingsCatalog.ts` のカテゴリを `kind` で分けた
 * （あちらの `SettingsCategoryDescriptor`）。
 *
 * **`shared/settings/sections.ts` には触っていない** ── 保存するものが
 * 1つも無いので、空の `keyboard` section を切らない
 * （「中身が決まっていない section を先に作らない」）。
 */
export interface ShortcutRow {
  readonly commandId: CommandId
  readonly category: CommandCategory
  /** 画面に出す名前（`commandTitle()` の結果）。 */
  readonly title: string
  /** `'Ctrl+Shift+S'`。割り当てが無ければ null。 */
  readonly keybinding: string | null
  readonly when: readonly WhenClause[]
  /** 割り当てが無い行は `'default'` を名乗らない。 */
  readonly source: KeybindingSource | null
  /** 同じ打鍵を、同時に成り立つ条件で持っている他の command。 */
  readonly conflictsWith: readonly CommandId[]
  /** 既定から変えられているか（`Reset` の活性。v1 では常に false）。 */
  readonly isModified: boolean
}

/**
 * 一覧の行を組み立てる。
 *
 * **登録されている command を1つ残らず出す**（割り当ての無いものも）。
 * 割り当ての側から作ると「打鍵が付いている操作しか設定画面に出ない」ことになり、
 * 新しく割り当てたい操作を見つけられない。
 *
 * 同じ command に複数の割り当てがある場合は、その数だけ行になる
 * （VS Code と同じ。1つの操作に2つの打鍵を置けることを表に出す）。
 */
export function buildShortcutRows(
  commands: readonly CommandDescriptor[],
  entries: readonly ResolvedKeybinding[],
  title: (descriptor: CommandDescriptor) => string
): readonly ShortcutRow[] {
  const conflicts = findKeybindingConflicts(entries)

  const conflictsFor = (commandId: CommandId, token: string): readonly CommandId[] =>
    conflicts
      .filter((conflict) => conflict.token === token && conflict.commandIds.includes(commandId))
      .flatMap((conflict) => conflict.commandIds.filter((id) => id !== commandId))

  return commands.flatMap((descriptor): readonly ShortcutRow[] => {
    const bound = entries.filter((entry) => entry.commandId === descriptor.id)

    if (bound.length === 0) {
      return [
        {
          commandId: descriptor.id,
          category: descriptor.category,
          title: title(descriptor),
          keybinding: null,
          when: [],
          source: null,
          conflictsWith: [],
          isModified: false
        }
      ]
    }

    return bound.map((entry) => ({
      commandId: descriptor.id,
      category: descriptor.category,
      title: title(descriptor),
      keybinding: formatKeybinding(entry.chord),
      when: entry.when,
      source: entry.source,
      conflictsWith: conflictsFor(descriptor.id, entry.token),
      isModified: entry.source !== 'default'
    }))
  })
}

/**
 * 一覧を1つの文字列で絞り込む（Session 4-7C）。
 *
 * 当てるのは3つ ── **表示名・command の id・打鍵**。
 *
 *   - 表示名 … 探す人が最初に打つもの（「保存」「Commit」）
 *   - id     … 英語のまま探せる（`git.push`）。表示が日本語でも当たる
 *   - 打鍵   … 「Ctrl+S は何に割り当たっているか」を逆から引ける
 *
 * `category` は当てていない。カテゴリは見出しとして常に見えており
 * （`settings/KeyboardShortcutsView.tsx`）、id の先頭語がカテゴリ名そのものなので
 * `git` と打てば Git の行に当たる ── 二重に当てる必要が無い。
 *
 * 空白だけの入力は「絞り込んでいない」と見なして全件返す。**当たらなかったことと
 * 何も入力していないことを、呼ぶ側が区別せずに済む**ようにしてある。
 *
 * 大小は無視する。`toLowerCase()` で足りるのは、当てる3つがいずれも
 * ASCII か、日本語（大小の概念が無い）だからにあたる。
 */
export function filterShortcutRows(
  rows: readonly ShortcutRow[],
  query: string
): readonly ShortcutRow[] {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return rows
  }

  return rows.filter((row) =>
    [row.title, row.commandId, row.keybinding ?? ''].some((value) =>
      value.toLowerCase().includes(needle)
    )
  )
}
