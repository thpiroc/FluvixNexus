import type { TranslationKey } from '../i18n/messages'
import { formatKeybinding, parseKeybinding } from './chord'

/**
 * 組み込みショートカット（Shortcuts S2）。
 *
 * Command Registry を通らず、**Monaco・Chromium の入力欄・xterm（とその手前の
 * `TerminalSurface.tsx`）が直接受け持っている打鍵**の一覧。Settings の
 * Keyboard Shortcuts に「組み込み（変更不可）」として並べるためだけにある。
 *
 * ## ここは「効き方」を決めない
 *
 * 行を消しても足しても、打鍵の動きは1つも変わらない ── 動きを決めているのは
 * Monaco / Chromium / xterm / `terminal/terminalDisplay.ts` の側で、この表は
 * **それを書き写した説明**にあたる。`keybindings/defaults.ts` と違い、
 * `KeybindingProvider` はこの表を読まない。
 *
 * そのため、書いてある打鍵は**実機で確かめたもの**だけにしてある
 * （2026-09-17、production build を Playwright で駆動）。
 *
 *   - Editor：Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z / Ctrl+A / Ctrl+C / Ctrl+F / Ctrl+H
 *   - Terminal：Ctrl+C → `03`、Ctrl+V → `16`、Ctrl+Shift+V と Shift+Insert →
 *     bracketed paste、Ctrl+Insert → 選択範囲がクリップボードへ
 *   - Terminal の Ctrl+Shift+C は**何もしない**（xterm がシェルへも送らず、
 *     コピーにもならない）ので並べていない
 *
 * ## 打鍵は `parseKeybinding` が読める形で持つ
 *
 * 表示は `formatKeybinding` を通すので、Command の行と同じ表記（`Ctrl+Shift+V`）に
 * 揃う。読める形で持っておくのは、S5 の「予約キーの警告」でそのまま照合に
 * 使えるようにするため（builtinShortcuts.test.ts が全件読めることを確かめる）。
 *
 * ## AI CLI モード（S1）の打鍵はまだ無い
 *
 * S1 と S2 は別々に main から分岐している。このブランチには AI CLI モードが
 * 無いので、その打鍵（Enter / Shift+Enter / Ctrl+Enter / Ctrl+V の読み替え）は
 * 並べていない ── 統合するときに `terminal` の群へ足す。
 */

/** 一覧での見出し。Command のカテゴリとは別に、Command の群の後ろへ並ぶ。 */
export type BuiltinShortcutGroup = 'editing' | 'terminal'

/** どこで効くか。群の中で効く場所が行ごとに違う `editing` だけが持つ。 */
export type BuiltinShortcutScope = 'editorAndInputs' | 'editor'

export interface BuiltinShortcutDescriptor {
  /** 画面の目印（`data-testid`）。Command の id とは別の名前空間。 */
  readonly id: string
  readonly group: BuiltinShortcutGroup
  readonly titleKey: TranslationKey
  /** 同じ操作に複数の打鍵があれば、その数だけ並べる（先頭が主）。 */
  readonly keys: readonly string[]
  readonly scope?: BuiltinShortcutScope
}

export const BUILTIN_SHORTCUT_GROUP_ORDER: readonly BuiltinShortcutGroup[] = ['editing', 'terminal']

export const BUILTIN_SHORTCUTS: readonly BuiltinShortcutDescriptor[] = [
  {
    id: 'editing.copy',
    group: 'editing',
    titleKey: 'settings.keyboard.builtin.actions.copy',
    keys: ['ctrl+c'],
    scope: 'editorAndInputs'
  },
  {
    id: 'editing.cut',
    group: 'editing',
    titleKey: 'settings.keyboard.builtin.actions.cut',
    keys: ['ctrl+x'],
    scope: 'editorAndInputs'
  },
  {
    id: 'editing.paste',
    group: 'editing',
    titleKey: 'settings.keyboard.builtin.actions.paste',
    keys: ['ctrl+v'],
    scope: 'editorAndInputs'
  },
  {
    id: 'editing.undo',
    group: 'editing',
    titleKey: 'settings.keyboard.builtin.actions.undo',
    keys: ['ctrl+z'],
    scope: 'editorAndInputs'
  },
  {
    id: 'editing.redo',
    group: 'editing',
    titleKey: 'settings.keyboard.builtin.actions.redo',
    keys: ['ctrl+y', 'ctrl+shift+z'],
    scope: 'editorAndInputs'
  },
  {
    id: 'editing.selectAll',
    group: 'editing',
    titleKey: 'settings.keyboard.builtin.actions.selectAll',
    keys: ['ctrl+a'],
    scope: 'editorAndInputs'
  },
  {
    id: 'editing.find',
    group: 'editing',
    titleKey: 'settings.keyboard.builtin.actions.find',
    keys: ['ctrl+f'],
    scope: 'editor'
  },
  {
    id: 'editing.replace',
    group: 'editing',
    titleKey: 'settings.keyboard.builtin.actions.replace',
    keys: ['ctrl+h'],
    scope: 'editor'
  },
  {
    id: 'terminal.interrupt',
    group: 'terminal',
    titleKey: 'settings.keyboard.builtin.actions.terminalInterrupt',
    keys: ['ctrl+c']
  },
  {
    id: 'terminal.copy',
    group: 'terminal',
    titleKey: 'settings.keyboard.builtin.actions.terminalCopy',
    keys: ['ctrl+insert']
  },
  {
    id: 'terminal.paste',
    group: 'terminal',
    titleKey: 'settings.keyboard.builtin.actions.terminalPaste',
    keys: ['ctrl+shift+v', 'shift+insert']
  },
  /*
    Ctrl+V は xterm が `0x16` にしてシェルへ送る。貼り付けになるかはシェル次第
    （PowerShell の PSReadLine は貼り付けとして扱う）── 「Ctrl+V が効かない」と
    読まれないよう、何が起きているかを1行で出しておく。
  */
  {
    id: 'terminal.sendCtrlV',
    group: 'terminal',
    titleKey: 'settings.keyboard.builtin.actions.terminalSendCtrlV',
    keys: ['ctrl+v']
  },
  /* `+` と `=`、`-` と `_` は同じ操作（日本語配列のため。terminalDisplay.ts）。 */
  {
    id: 'terminal.fontSizeIncrease',
    group: 'terminal',
    titleKey: 'settings.keyboard.builtin.actions.terminalFontSizeIncrease',
    keys: ['ctrl++', 'ctrl+=']
  },
  {
    id: 'terminal.fontSizeDecrease',
    group: 'terminal',
    titleKey: 'settings.keyboard.builtin.actions.terminalFontSizeDecrease',
    keys: ['ctrl+-']
  },
  {
    id: 'terminal.fontSizeReset',
    group: 'terminal',
    titleKey: 'settings.keyboard.builtin.actions.terminalFontSizeReset',
    keys: ['ctrl+0']
  }
]

const GROUP_TITLE_KEYS: Readonly<Record<BuiltinShortcutGroup, TranslationKey>> = {
  editing: 'settings.keyboard.builtin.groups.editing',
  terminal: 'settings.keyboard.builtin.groups.terminal'
}

const SCOPE_KEYS: Readonly<Record<BuiltinShortcutScope, TranslationKey>> = {
  editorAndInputs: 'settings.keyboard.builtin.scopes.editorAndInputs',
  editor: 'settings.keyboard.builtin.scopes.editor'
}

/** 画面に出す1行。Command の `ShortcutRow` と違い、変更も競合も持たない。 */
export interface BuiltinShortcutRow {
  readonly id: string
  readonly group: BuiltinShortcutGroup
  readonly title: string
  /** `['Ctrl+Y', 'Ctrl+Shift+Z']`。 */
  readonly keybindings: readonly string[]
  /** 効く場所の表示名。群の見出しで足りる行は null。 */
  readonly scope: string | null
}

export function getBuiltinShortcutGroupTitle(
  group: BuiltinShortcutGroup,
  t: (key: TranslationKey) => string
): string {
  return t(GROUP_TITLE_KEYS[group])
}

/**
 * 表示用の行を組み立てる。
 *
 * 読めない打鍵は**その場で落とさず例外にする**。この表はソースに書いた定数で、
 * 読めないのは書き間違いにほかならない（テストで必ず踏む）。
 */
export function buildBuiltinShortcutRows(
  descriptors: readonly BuiltinShortcutDescriptor[],
  t: (key: TranslationKey) => string
): readonly BuiltinShortcutRow[] {
  return descriptors.map((descriptor) => ({
    id: descriptor.id,
    group: descriptor.group,
    title: t(descriptor.titleKey),
    keybindings: descriptor.keys.map((key) => {
      const chord = parseKeybinding(key)

      if (chord === null) {
        throw new Error(`builtin shortcut ${descriptor.id} has an unreadable key: ${key}`)
      }

      return formatKeybinding(chord)
    }),
    scope: descriptor.scope === undefined ? null : t(SCOPE_KEYS[descriptor.scope])
  }))
}

/**
 * 組み込みの行を絞り込む。当て方は `filterShortcutRows` と同じ
 * （表示名・id・打鍵の素の部分一致、大小無視、空白だけなら全件）。
 * 効く場所の表示名（「入力欄」）にも当てる。群の名前には当てない ──
 * Command の側がカテゴリに当てないのと同じで、id の先頭語（`terminal.`）が代わりになる。
 */
export function filterBuiltinShortcutRows(
  rows: readonly BuiltinShortcutRow[],
  query: string
): readonly BuiltinShortcutRow[] {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return rows
  }

  return rows.filter((row) =>
    [row.title, row.id, row.scope ?? '', ...row.keybindings].some((value) =>
      value.toLowerCase().includes(needle)
    )
  )
}
