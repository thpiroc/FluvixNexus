import { useMemo, useState, type JSX } from 'react'
import { COMMAND_CATEGORY_ORDER, getCommandCategoryTitle } from '../commands/commandCategoryLabels'
import { listCommands } from '../commands/registry'
import { commandTitle, type CommandCategory } from '../commands/types'
import { useI18n } from '../i18n/context'
import { useKeybindings } from '../keybindings/context'
import {
  buildShortcutRows,
  filterShortcutRows,
  type ShortcutRow
} from '../keybindings/shortcutRows'

/**
 * Keyboard Shortcuts の一覧（Session 4-7C）。
 *
 * Settings の中の1カテゴリとして出る（`settingsCatalog.ts` の
 * `kind: 'shortcuts'`）。他のカテゴリが「値を変える場所」であるのに対し、
 * ここは**読むだけの表**にあたる。
 *
 * ## 閲覧専用（v1）
 *
 * 打鍵の変更・User / Workspace の割り当て・`keybindings.json` の永続化は
 * どれも入っていない。**行を押しても command は実行されない** ──
 * 実行の入口は打鍵と各パネルの UI のままで、ここは一覧にほかならない。
 * `onClick` を1つも持たないのはそのためになる（検索欄と、それを消す × を除く）。
 *
 * ## 値を1つも持たないという点は、他のカテゴリと同じ
 *
 * この component が持つ state は**検索の文字列だけ**で、それも保存しない
 * （`SettingsOverlay` が開いているカテゴリを保存しないのと同じ ── 次に開いた
 * ときに前の絞り込みが残っていると、一覧が欠けているように見える）。
 *
 * 一覧そのものは2つの層から**その場で組み立てる**。
 *
 * ```
 * listCommands()             アプリが持つ操作の全体（commands/registry.ts）
 * useKeybindings().entries   効いている割り当て（keybindings/KeybindingProvider.tsx）
 *         ↓ buildShortcutRows（純関数）
 * ShortcutRow[]
 * ```
 *
 * どちらも**この画面のために新しく作った口ではない** ── `entries` は
 * Session 4-7A から `KeybindingContext` にあり、読む相手がここで初めてできた。
 * 新しい IPC も、Main / preload / shared への変更も1つも無い。
 *
 * ## `useCommands().isRegistered` を使わない
 *
 * 「今それを実行できるか」を出したくなるが、handler の表は `useRef` の `Map`
 * で React の state ではない（`commands/CommandProvider.tsx`）── 描画中に
 * 読んでも**変化で再描画されず、必ず古い値が出る。** 一覧が出すのは
 * 「アプリが持つ操作の全体」であって、その瞬間に実行できるものではない
 * （`listCommands()` の doc）。Git パネルを閉じていても Git の7件は並ぶ。
 *
 * ## カテゴリは列ではなく見出し
 *
 * 21件のうち Git だけで7件あり、列にすると同じ語が7回並ぶ。見出しに畳むと
 * 幅も取らず、左の nav と同じ読み方になる。機械が読む側には
 * 各行の `data-category` が残してある。
 */
export function KeyboardShortcutsView(): JSX.Element {
  const { t } = useI18n()
  const { entries } = useKeybindings()

  /*
    絞り込みの文字列。**この画面が持つ唯一の state。**
  */
  const [query, setQuery] = useState('')

  /*
    `entries` は KeybindingProvider が `useMemo(..., [])` で作るので参照が安定し、
    `t` は言語が変わったときだけ作り直される（i18n/LanguageProvider.tsx）──
    つまりここが走り直すのは**言語を切り替えたときだけ**になる。
    ja / en を切り替えると command の名前がその場で入れ替わるのはこのため。
  */
  const rows = useMemo(
    () => buildShortcutRows(listCommands(), entries, (descriptor) => commandTitle(descriptor, t)),
    [entries, t]
  )

  const visible = useMemo(() => filterShortcutRows(rows, query), [rows, query])

  const groups = useMemo(
    () =>
      COMMAND_CATEGORY_ORDER.map((category) => ({
        category,
        rows: visible.filter((row) => row.category === category)
      })).filter((group) => group.rows.length > 0),
    [visible]
  )

  return (
    <div className="fx-shortcuts" data-testid="settings-keyboard">
      <div className="fx-shortcuts__toolbar">
        <input
          type="search"
          className="fx-shortcuts__search"
          data-testid="settings-keyboard-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('settings.keyboard.searchLabel')}
          placeholder={t('settings.keyboard.searchPlaceholder')}
        />
        {query !== '' && (
          <button
            type="button"
            className="fx-shortcuts__clear"
            data-testid="settings-keyboard-search-clear"
            onClick={() => setQuery('')}
          >
            {t('settings.keyboard.searchClear')}
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="fx-shortcuts__empty" data-testid="settings-keyboard-empty">
          {t('settings.keyboard.noResults', { query })}
        </p>
      ) : (
        <div
          className="fx-shortcuts__groups"
          role="list"
          aria-label={t('settings.keyboard.tableLabel')}
        >
          {groups.map((group) => (
            <ShortcutGroup key={group.category} category={group.category} rows={group.rows} />
          ))}
        </div>
      )}

      <div className="fx-shortcuts__notes">
        <p className="fx-shortcuts__note">{t('settings.keyboard.viewOnlyNote')}</p>
        {/*
          端末の文字の大きさ（Ctrl と ＋ / － / 0）はこの一覧に出てこない。
          あれは `terminal/terminalDisplay.ts` → `TerminalSurface.tsx` の
          `onAppKey` が受け持っており、Command Registry を通っていない
          （日本語配列のための `=` / `_` の読み替えを持つため。commandIds.ts）。
          **実際に使われている打鍵が並ばない**ことは、黙っていると
          「一覧が全部だ」という誤解になる ── 1行で断っておく。
        */}
        <p className="fx-shortcuts__note">{t('settings.keyboard.terminalNote')}</p>
      </div>
    </div>
  )
}

function ShortcutGroup({
  category,
  rows
}: {
  readonly category: CommandCategory
  readonly rows: readonly ShortcutRow[]
}): JSX.Element {
  const { t } = useI18n()

  return (
    <section className="fx-shortcuts__group" data-group={category}>
      <h3 className="fx-shortcuts__group-title">{getCommandCategoryTitle(category, t)}</h3>

      {rows.map((row) => (
        <ShortcutRowView
          /*
            1つの command が複数の行になりうる（同じ操作に2つの打鍵）。
            `commandId` だけを key にすると、User の割り当てが入った日に
            静かに壊れる ── `buildShortcutRows` が明示的に許している形なので、
            今は衝突しないというだけの理由で前提を焼き込まない。
          */
          key={`${row.commandId}:${row.keybinding ?? 'none'}`}
          row={row}
        />
      ))}
    </section>
  )
}

/**
 * 1件分の行。
 *
 * `data-*` を3つ出している。画面には出さないが、テストと将来の列追加が読む。
 *
 *   `data-command`     … どの command の行か
 *   `data-category`    … 見出しに畳んだカテゴリ（機械が読む側の分）
 *   `data-source`      … `'default'` / 未割り当ては `'none'`
 *                        （v1 は Source 列を出さない。keybindings/shortcutRows.ts）
 */
function ShortcutRowView({ row }: { readonly row: ShortcutRow }): JSX.Element {
  const { t } = useI18n()
  const unassigned = row.keybinding === null

  return (
    <div
      className="fx-shortcuts__row"
      role="listitem"
      data-testid={`settings-keyboard-row-${row.commandId}`}
      data-command={row.commandId}
      data-category={row.category}
      data-source={row.source ?? 'none'}
      data-unassigned={unassigned}
    >
      <span className="fx-shortcuts__command">{row.title}</span>
      {unassigned ? (
        <span className="fx-shortcuts__key fx-shortcuts__key--unassigned">
          {t('settings.keyboard.unassigned')}
        </span>
      ) : (
        <kbd className="fx-shortcuts__key">{row.keybinding}</kbd>
      )}
    </div>
  )
}
