import type { CommandId } from '../commands/commandIds'
import type { CommandCategory, CommandDescriptor } from '../commands/types'
import { formatKeybinding } from './chord'
import { findKeybindingConflicts, type KeybindingSource, type ResolvedKeybinding } from './resolve'
import type { WhenClause } from './when'

/**
 * Settings の「Keyboard Shortcuts」に並べる行（Session 4-7A）。
 *
 * **画面はまだ無い。** Session 4-7A で作るのは、その画面が読むだけで済む形に
 * 情報を畳んでおくところまでになる（UI は Session 4-7B 以降）。
 *
 * 先に作っておく理由は、これが**純粋関数で表せる**ことにある ── 行の中身は
 * Command Registry と解決済みの割り当てから機械的に決まり、React も DOM も
 * 要らない。ここに置いておけば、画面の側は「並べるだけ」になる
 * （`settings/settingsCatalog.ts` が並びを持ち、`SettingsOverlay.tsx` が
 * 配置だけを持つのと同じ分担）。
 *
 * ## 画面が必要とするものは全部ここに出ている
 *
 * | 画面の要素 | この型のどれか                                  |
 * | ---------- | ------------------------------------------------ |
 * | 検索       | `title` ＋ `commandId` ＋ `keybinding` の文字列一致 |
 * | Command    | `title`（4-7B で `titleKey` 経由の翻訳になる）   |
 * | Keybinding | `keybinding`（未割り当ては null）                |
 * | When       | `when`                                           |
 * | Source     | `source`                                         |
 * | 競合表示   | `conflictsWith`                                  |
 * | Reset      | `source !== 'default'`（v1 では常に false）      |
 *
 * ## Settings のカテゴリの型には、まだ乗らない
 *
 * `settings/settingsCatalog.ts` の `SettingsItemDescriptor` は
 * `section: SettingsSectionId` を必須にしており、カテゴリは「値の項目が並ぶもの」
 * を前提にしている。Keyboard Shortcuts は一覧表の画面なので、あの型を
 * 広げる必要がある ── **それは画面を作るときの話**なので、Session 4-7A では
 * `settingsCatalog.ts` に1行も触っていない。
 *
 * 空の `keyboard` section を先に切ることもしない
 * （`shared/settings/sections.ts`「中身が決まっていない section を先に作らない」）。
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
