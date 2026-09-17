import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { StoredKeybindingEntry } from '@shared/keybindings'
import type { CommandId } from '../commands/commandIds'
import { COMMAND_CATEGORY_ORDER, getCommandCategoryTitle } from '../commands/commandCategoryLabels'
import { listCommands } from '../commands/registry'
import { commandTitle, type CommandCategory } from '../commands/types'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'
import {
  BUILTIN_SHORTCUT_GROUP_ORDER,
  BUILTIN_SHORTCUTS,
  buildBuiltinShortcutRows,
  filterBuiltinShortcutRows,
  getBuiltinShortcutGroupTitle,
  type BuiltinShortcutGroup,
  type BuiltinShortcutRow
} from '../keybindings/builtinShortcuts'
import { chordFromEvent, chordToken, formatKeybinding, type KeyChord } from '../keybindings/chord'
import { useKeybindings, type UserKeybindingsStatus } from '../keybindings/context'
import { DEFAULT_KEYBINDINGS } from '../keybindings/defaults'
import {
  commandKeys,
  defaultCommandKeys,
  isAssignableChord,
  modifiedCommandIds,
  replaceKey,
  withCommandKeys
} from '../keybindings/editKeybindings'
import {
  intendedKeybindings,
  previewKeyWarnings,
  type KeyWarnings
} from '../keybindings/keyWarnings'
import {
  buildShortcutRows,
  filterShortcutRows,
  type ShortcutRow
} from '../keybindings/shortcutRows'
import type { InvalidUserKeybinding } from '../keybindings/userKeybindings'

/**
 * Keyboard Shortcuts の一覧（Session 4-7C。Shortcuts S4 で編集できるようになった）。
 *
 * Settings の中の1カテゴリとして出る（`settingsCatalog.ts` の
 * `kind: 'shortcuts'`）。
 *
 * ## 編集（Shortcuts S4）
 *
 * 行ごとに3つ、画面全体に1つの操作がある。
 *
 *   変更 / 割り当て  … 次に押した打鍵を記録し、Enter（または「確定」）で保存する
 *   解除             … その打鍵を外す（既定の打鍵なら `-command` の行になる）
 *   デフォルトへ戻す … その command の行を消す（変更済みの command だけ）
 *   すべてデフォルトへ戻す … `keybindings.json` を空にする（確かめてから）
 *
 * **押した瞬間に保存され、その場で効く。** 他のカテゴリと同じで「適用」は無い
 * （SettingsOverlay.tsx の Theme と同じ扱い）。ファイルの行をどう書くかは
 * keybindings/editKeybindings.ts が決め、ここは「この command の打鍵をこの並びに」
 * を渡すだけ。保存は KeybindingProvider の `saveUserKeybindings` の1本で、
 * Main が受け付けた後に表が作り直される。
 *
 * **行を押しても command は実行されない**（Session 4-7C のまま）── ここは
 * 打鍵を決める場所で、実行の入口は打鍵と各パネルの UI にある。
 *
 * ## 記録中は、アプリのどの打鍵処理にも渡さない
 *
 * `KeyRecorder` は `window` の **capture** で keydown を受け、伝播ごと止める。
 * KeybindingProvider も既存の Esc（Settings を閉じる・メニュー・確認 …）も
 * `window` の bubble で待っているので、記録中の F5 / Ctrl+O / Esc が
 * それらへ届かない（計画の「キー記録中はグローバルの打鍵処理と既存の Esc より
 * 先に受ける」）。既存の購読には1行も触っていない。
 *
 * ## 警告と、読めない行（Shortcuts S5）
 *
 * 行の下に注意を出す。判定は keybindings/keyWarnings.ts と reservedKeys.ts。
 *
 *   競合     … 同じ打鍵を、同時に成り立ちうる条件で別の command も持っている。
 *              どちらが動くかまで書く（「こちらが動く」「〇〇が動く」「この打鍵では動かない」）
 *   予約キー … 割り当ての表の外で既に意味を持つ打鍵（入力欄のコピー・Git の Commit …）
 *
 * **記録中は、押した打鍵を確定したらどうなるか**を同じ場所に出す
 * （`previewKeyWarnings`。保存と同じ書き直しで作ったファイルから判定する）。
 * 警告は確定を止めない ── 計画どおり「警告」で、断るのは S4 の
 * `isAssignableChord`（文字が打てなくなる打鍵）だけ。
 *
 * 同じ条件で別の command に取られた割り当ても行として出る（`intendedKeybindings`）。
 * S4 までは取られた側が「未割り当て」に見えていた。
 *
 * `keybindings.json` の読めない項目（知らない command・読めない打鍵・when 付き）と、
 * Main が形で落とした項目の数は、一覧の上にまとめて出す（`InvalidEntriesNote`）。
 *
 * ## 一覧の組み立て
 *
 * ```
 * listCommands()                     アプリが持つ操作の全体（commands/registry.ts）
 * useKeybindings().entries           効いている割り当て（keybindings/KeybindingProvider.tsx）
 * useKeybindings().userKeybindings   keybindings.json（変更済みの判定と、書き直す元）
 *         ↓ buildShortcutRows（純関数）
 * ShortcutRow[]
 * ```
 *
 * Shortcuts S2 から、Command の群の後ろに**組み込みの群**（編集・ターミナル）が
 * 並ぶ。こちらは `keybindings/builtinShortcuts.ts` の静的な表から作り、
 * `entries` とは関係しない（Monaco / 入力欄 / xterm が直接受け持つ打鍵）。
 * **組み込みの行には編集のボタンを出さない**（変えられないため。S4 の注意）。
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
  const { entries, userKeybindings, saveUserKeybindings } = useKeybindings()

  /*
    絞り込みの文字列と、編集の途中経過。どれも保存しない
    （`SettingsOverlay` が開いているカテゴリを保存しないのと同じ ── 次に開いた
    ときに前の絞り込みや記録が残っていると、一覧が欠けているように見える）。
  */
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<RecordingTarget | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [confirmingResetAll, setConfirmingResetAll] = useState(false)

  const modified = useMemo(() => modifiedCommandIds(userKeybindings.rules), [userKeybindings.rules])

  /* 取られた割り当ても行にするための表（Shortcuts S5。このファイルの冒頭）。 */
  const intended = useMemo(
    () => intendedKeybindings([...DEFAULT_KEYBINDINGS, ...userKeybindings.rules]),
    [userKeybindings.rules]
  )

  /* 警告の文言に相手の名前を入れる。 */
  const titles = useMemo(
    () =>
      new Map<CommandId, string>(
        listCommands().map((descriptor) => [descriptor.id, commandTitle(descriptor, t)])
      ),
    [t]
  )

  /*
    `entries` / `userKeybindings` を KeybindingProvider が作り直すのは
    `keybindings.json` を読み終えたときと保存したときだけ（Shortcuts S3）で、
    `t` は言語が変わったときだけ作り直される（i18n/LanguageProvider.tsx）。
  */
  const rows = useMemo(
    () =>
      buildShortcutRows(
        listCommands(),
        entries,
        (descriptor) => commandTitle(descriptor, t),
        modified,
        intended
      ),
    [entries, t, modified, intended]
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

  /*
    組み込みの行（S2）。Command の行とは別の表から作り、見出しも Command の
    カテゴリの後ろへ別に並べる ── 変えられる行と変えられない行を同じ見出しに
    混ぜると、どれが押せるのか読み分けにくい。
  */
  const builtinRows = useMemo(() => buildBuiltinShortcutRows(BUILTIN_SHORTCUTS, t), [t])

  const builtinGroups = useMemo(() => {
    const matched = filterBuiltinShortcutRows(builtinRows, query)

    return BUILTIN_SHORTCUT_GROUP_ORDER.map((group) => ({
      group,
      rows: matched.filter((row) => row.group === group)
    })).filter((entry) => entry.rows.length > 0)
  }, [builtinRows, query])

  const editable = canEdit(userKeybindings.status) && !saving

  /*
    ファイルを書き直して保存する。失敗しても投げない ── 画面に1行出すだけで、
    表は Provider が「受け付けられたときだけ」作り直すので、失敗した変更が
    効いて見えることは無い。
  */
  const save = useCallback(
    async (next: readonly StoredKeybindingEntry[]): Promise<void> => {
      setSaving(true)
      setError(null)

      const saved = await saveUserKeybindings(next)

      setSaving(false)

      if (!saved) {
        setError('settings.keyboard.saveFailed')
      }
    },
    [saveUserKeybindings]
  )

  const setKeys = useCallback(
    (commandId: CommandId, keys: readonly string[]): Promise<void> =>
      save(withCommandKeys(userKeybindings.entries, commandId, keys)),
    [save, userKeybindings.entries]
  )

  const actions = useMemo<RowActions>(
    () => ({
      editable,
      recording,
      startRecording: (target) => {
        setError(null)
        setConfirmingResetAll(false)
        setRecording(target)
      },
      cancelRecording: () => setRecording(null),
      confirmRecording: (chord) => {
        if (recording === null) {
          return
        }

        const { commandId, key } = recording
        const current = commandKeys(commandId, userKeybindings.rules)

        setRecording(null)
        void setKeys(commandId, replaceKey(current, key, chordToken(chord)))
      },
      remove: (commandId, key) => {
        const current = commandKeys(commandId, userKeybindings.rules)

        void setKeys(
          commandId,
          current.filter((candidate) => candidate !== key)
        )
      },
      reset: (commandId) => {
        void setKeys(commandId, defaultCommandKeys(commandId))
      },
      preview: (target, chord) =>
        previewKeyWarnings(
          userKeybindings.entries,
          target.commandId,
          target.key,
          chordToken(chord)
        ),
      titleOf: (commandId) => titles.get(commandId) ?? commandId
    }),
    [editable, recording, setKeys, userKeybindings.rules, userKeybindings.entries, titles]
  )

  const hasUserChanges = userKeybindings.entries.length > 0 || userKeybindings.skippedCount > 0

  return (
    <div
      className="fx-shortcuts"
      data-testid="settings-keyboard"
      data-status={userKeybindings.status}
      data-saving={saving}
    >
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
        {!confirmingResetAll && (
          <button
            type="button"
            className="fx-shortcuts__clear"
            data-testid="settings-keyboard-reset-all"
            disabled={!editable || recording !== null || !hasUserChanges}
            onClick={() => {
              setError(null)
              setConfirmingResetAll(true)
            }}
          >
            {t('settings.keyboard.actions.resetAll')}
          </button>
        )}
      </div>

      {confirmingResetAll && (
        <div
          className="fx-shortcuts__confirm"
          role="alert"
          data-testid="settings-keyboard-reset-all-prompt"
        >
          <span className="fx-shortcuts__confirm-text">
            {t('settings.keyboard.resetAllConfirm')}
          </span>
          <button
            type="button"
            className="fx-shortcuts__action fx-shortcuts__action--primary"
            data-testid="settings-keyboard-reset-all-confirm"
            disabled={!editable}
            onClick={() => {
              setConfirmingResetAll(false)
              void save([])
            }}
          >
            {t('settings.keyboard.actions.resetAllConfirm')}
          </button>
          <button
            type="button"
            className="fx-shortcuts__action"
            data-testid="settings-keyboard-reset-all-cancel"
            onClick={() => setConfirmingResetAll(false)}
          >
            {t('settings.keyboard.actions.cancel')}
          </button>
        </div>
      )}

      <StatusNote status={userKeybindings.status} />

      <InvalidEntriesNote
        invalid={userKeybindings.invalid}
        skippedCount={userKeybindings.skippedCount}
      />

      {error !== null && (
        <p className="fx-shortcuts__error" role="alert" data-testid="settings-keyboard-error">
          {t(error)}
        </p>
      )}

      {groups.length === 0 && builtinGroups.length === 0 ? (
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
            <ShortcutGroup
              key={group.category}
              category={group.category}
              rows={group.rows}
              actions={actions}
            />
          ))}
          {builtinGroups.map((group) => (
            <BuiltinShortcutGroupView key={group.group} group={group.group} rows={group.rows} />
          ))}
        </div>
      )}

      <div className="fx-shortcuts__notes">
        <p className="fx-shortcuts__note">{t('settings.keyboard.editNote')}</p>
        {/*
          S2 より前は「端末の文字の大きさはここに並ばない」と断っていた。
          今はそれも組み込みの行として並ぶので、代わりに組み込みの行が
          変えられない理由を1行で出す。
        */}
        <p className="fx-shortcuts__note">{t('settings.keyboard.builtinNote')}</p>
      </div>
    </div>
  )
}

/** 記録している相手。`key` が null なら「割り当て」（打鍵を足す）。 */
interface RecordingTarget {
  readonly commandId: CommandId
  readonly key: string | null
}

interface RowActions {
  /** 読み込みが済み、保存中でない。 */
  readonly editable: boolean
  readonly recording: RecordingTarget | null
  readonly startRecording: (target: RecordingTarget) => void
  readonly cancelRecording: () => void
  readonly confirmRecording: (chord: KeyChord) => void
  readonly remove: (commandId: CommandId, key: string) => void
  readonly reset: (commandId: CommandId) => void
  /** 記録中の打鍵を確定したら付く警告（Shortcuts S5）。 */
  readonly preview: (target: RecordingTarget, chord: KeyChord) => KeyWarnings
  /** 警告の文言に入れる command の名前。 */
  readonly titleOf: (commandId: CommandId) => string
}

/**
 * 変更してよいか。
 *
 * 読み込み中・IPC 失敗の間は、ファイルに何が書いてあるか分からない
 * （KeybindingProvider の `canSave` と同じ判断。あちらも保存を断る）。
 */
function canEdit(status: UserKeybindingsStatus): boolean {
  return status !== 'loading' && status !== 'failed'
}

/** 読み込みの状態のうち、利用者が知っておくべきものだけを1行で出す。 */
function StatusNote({ status }: { readonly status: UserKeybindingsStatus }): JSX.Element | null {
  const { t } = useI18n()

  if (status === 'failed') {
    return (
      <p className="fx-shortcuts__error" data-testid="settings-keyboard-load-failed">
        {t('settings.keyboard.loadFailed')}
      </p>
    )
  }

  /*
    壊れたファイルの上へ保存すると、Main が元のファイルを別名で残す
    （main/store/keybindingsStore.ts）。変更を押す前に分かるように断っておく。
  */
  if (status === 'unreadable') {
    return (
      <p className="fx-shortcuts__warning" data-testid="settings-keyboard-unreadable">
        {t('settings.keyboard.unreadableNote')}
      </p>
    )
  }

  return null
}

/**
 * `keybindings.json` の読めない項目（Shortcuts S5）。
 *
 * 書いたのに効かない理由を、項目ごとに出す。位置（何行目か）は出さない ──
 * Main が形で落とした項目は数に入らないので、ファイルの中の位置と食い違う。
 * 代わりに書いてあった `command` / `key` / `when` をそのまま見せ、ファイルの中で探せるようにする。
 *
 * 画面から変更したときの扱いが2種類で違うので、別々に断る。
 *
 *   読めない項目 … 残る（editKeybindings.ts）。「すべてデフォルトへ戻す」でだけ消える
 *   形の合わない項目 … Renderer は中身を持っていないので、保存すると消える（S3 の注意）
 */
function InvalidEntriesNote({
  invalid,
  skippedCount
}: {
  readonly invalid: readonly InvalidUserKeybinding[]
  readonly skippedCount: number
}): JSX.Element | null {
  const { t } = useI18n()

  if (invalid.length === 0 && skippedCount === 0) {
    return null
  }

  return (
    <div className="fx-shortcuts__invalid" role="note" data-testid="settings-keyboard-invalid">
      {invalid.length > 0 && (
        <>
          <p className="fx-shortcuts__warning" data-testid="settings-keyboard-invalid-title">
            {t('settings.keyboard.invalid.title', { count: invalid.length })}
          </p>
          <ul className="fx-shortcuts__invalid-list">
            {invalid.map((item) => (
              <li
                key={item.index}
                className="fx-shortcuts__invalid-item"
                data-testid="settings-keyboard-invalid-item"
                data-problem={item.problem}
              >
                <code className="fx-shortcuts__invalid-entry">
                  {describeStoredEntry(item.entry.command, item.entry.key, item.entry.when)}
                </code>
                <span className="fx-shortcuts__invalid-problem">
                  {t(`settings.keyboard.invalid.problems.${item.problem}`)}
                </span>
              </li>
            ))}
          </ul>
          <p className="fx-shortcuts__note">{t('settings.keyboard.invalid.note')}</p>
        </>
      )}
      {skippedCount > 0 && (
        <p className="fx-shortcuts__warning" data-testid="settings-keyboard-skipped">
          {t('settings.keyboard.invalid.skipped', { count: skippedCount })}
        </p>
      )}
    </div>
  )
}

/** ファイルに書いてあった形に近い1行（JSON の見た目）。 */
function describeStoredEntry(command: string, key: string, when: string | undefined): string {
  const parts = [`"command": ${JSON.stringify(command)}`, `"key": ${JSON.stringify(key)}`]

  if (when !== undefined) {
    parts.push(`"when": ${JSON.stringify(when)}`)
  }

  return `{ ${parts.join(', ')} }`
}

/**
 * 1つの打鍵に付く注意（Shortcuts S5）。
 *
 * `mode` が `preview` のときは記録中（確定したら）の言い回しになる。
 */
function KeyWarningList({
  warnings,
  mode,
  titleOf,
  label
}: {
  readonly warnings: KeyWarnings
  readonly mode: 'row' | 'preview'
  readonly titleOf: (commandId: CommandId) => string
  readonly label: string
}): JSX.Element | null {
  const { t } = useI18n()
  const { conflict, reserved } = warnings

  if (conflict === null && reserved.length === 0) {
    return null
  }

  const messages: { readonly id: string; readonly text: string }[] = []

  if (conflict !== null) {
    const group = mode === 'row' ? 'conflict' : 'preview'
    const variant = conflict.overridden
      ? 'overridden'
      : conflict.commandIds.includes(conflict.winner)
        ? 'loses'
        : 'wins'
    const values = {
      commands: conflict.commandIds
        .map(titleOf)
        .join(t('settings.keyboard.warnings.commandSeparator')),
      winner: titleOf(conflict.winner)
    }

    messages.push({
      id: `conflict-${variant}`,
      text: t(`settings.keyboard.warnings.${group}.${variant}`, values)
    })
  }

  for (const reason of reserved) {
    messages.push({
      id: `reserved-${reason}`,
      text: t(`settings.keyboard.warnings.reserved.${reason}`)
    })
  }

  return (
    <ul
      className="fx-shortcuts__warnings"
      aria-label={label}
      data-testid={mode === 'row' ? 'settings-keyboard-warnings' : 'settings-keyboard-preview'}
    >
      {messages.map((message) => (
        <li key={message.id} className="fx-shortcuts__warning-item" data-warning={message.id}>
          {message.text}
        </li>
      ))}
    </ul>
  )
}

function ShortcutGroup({
  category,
  rows,
  actions
}: {
  readonly category: CommandCategory
  readonly rows: readonly ShortcutRow[]
  readonly actions: RowActions
}): JSX.Element {
  const { t } = useI18n()

  return (
    <section className="fx-shortcuts__group" data-group={category}>
      <h3 className="fx-shortcuts__group-title">{getCommandCategoryTitle(category, t)}</h3>

      {rows.map((row, index) => (
        <ShortcutRowView
          /*
            1つの command が複数の行になりうる（同じ操作に2つの打鍵）。
            `commandId` だけを key にすると衝突する ── 打鍵と組にする。
          */
          key={`${row.commandId}:${row.key ?? 'none'}`}
          row={row}
          /*
            「デフォルトへ戻す」は command 単位の操作なので、その command の
            最初の行にだけ出す（2行ある command で同じボタンを2つ並べない）。
          */
          firstOfCommand={rows.findIndex((other) => other.commandId === row.commandId) === index}
          actions={actions}
        />
      ))}
    </section>
  )
}

/**
 * 1件分の行。
 *
 * `data-*` は画面には出さないが、テストと実機確認が読む。
 *
 *   `data-command`     … どの command の行か
 *   `data-category`    … 見出しに畳んだカテゴリ（機械が読む側の分）
 *   `data-source`      … `'default'` / `'user'` / 未割り当ては `'none'`
 *   `data-key`         … `chordToken` の形の打鍵（未割り当ては属性なし）
 *   `data-modified`    … その command が既定から変えられているか
 */
function ShortcutRowView({
  row,
  firstOfCommand,
  actions
}: {
  readonly row: ShortcutRow
  readonly firstOfCommand: boolean
  readonly actions: RowActions
}): JSX.Element {
  const { t } = useI18n()
  const unassigned = row.keybinding === null
  const isRecording =
    actions.recording !== null &&
    actions.recording.commandId === row.commandId &&
    actions.recording.key === row.key
  const disabled = !actions.editable || actions.recording !== null
  const labelValues = { command: row.title, key: row.keybinding ?? '' }

  /* 記録中に押された打鍵（確定したときの警告を出すため。Shortcuts S5）。 */
  const [captured, setCaptured] = useState<KeyChord | null>(null)

  useEffect(() => {
    if (!isRecording) {
      setCaptured(null)
    }
  }, [isRecording])

  const preview =
    isRecording && captured !== null && isAssignableChord(captured) && actions.recording !== null
      ? actions.preview(actions.recording, captured)
      : null

  return (
    <div
      className="fx-shortcuts__row"
      role="listitem"
      data-testid={`settings-keyboard-row-${row.commandId}`}
      data-command={row.commandId}
      data-category={row.category}
      data-source={row.source ?? 'none'}
      data-key={row.key ?? undefined}
      data-unassigned={unassigned}
      data-modified={row.isModified}
      data-recording={isRecording}
      data-conflict={
        row.conflict === null ? undefined : row.conflict.overridden ? 'overridden' : 'overlap'
      }
      data-reserved={row.reserved.length > 0 ? row.reserved.join(' ') : undefined}
    >
      <div className="fx-shortcuts__row-main">
        <span className="fx-shortcuts__command">
          {row.title}
          {row.isModified && firstOfCommand && (
            <span
              className="fx-shortcuts__badge"
              data-testid={`settings-keyboard-modified-${row.commandId}`}
            >
              {t('settings.keyboard.modified')}
            </span>
          )}
        </span>

        <span className="fx-shortcuts__binding">
          {isRecording ? (
            <KeyRecorder
              onConfirm={actions.confirmRecording}
              onCancel={actions.cancelRecording}
              onCapture={setCaptured}
            />
          ) : (
            <>
              {unassigned ? (
                <span className="fx-shortcuts__key fx-shortcuts__key--unassigned">
                  {t('settings.keyboard.unassigned')}
                </span>
              ) : (
                <kbd className="fx-shortcuts__key">{row.keybinding}</kbd>
              )}

              <span className="fx-shortcuts__actions">
                {row.key === null ? (
                  <button
                    type="button"
                    className="fx-shortcuts__action"
                    data-testid={`settings-keyboard-assign-${row.commandId}`}
                    disabled={disabled}
                    aria-label={t('settings.keyboard.actionLabels.assign', labelValues)}
                    onClick={() => actions.startRecording({ commandId: row.commandId, key: null })}
                  >
                    {t('settings.keyboard.actions.assign')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="fx-shortcuts__action"
                      data-testid={`settings-keyboard-change-${row.commandId}-${row.key}`}
                      disabled={disabled}
                      aria-label={t('settings.keyboard.actionLabels.change', labelValues)}
                      onClick={() =>
                        actions.startRecording({ commandId: row.commandId, key: row.key })
                      }
                    >
                      {t('settings.keyboard.actions.change')}
                    </button>
                    <button
                      type="button"
                      className="fx-shortcuts__action"
                      data-testid={`settings-keyboard-remove-${row.commandId}-${row.key}`}
                      disabled={disabled}
                      aria-label={t('settings.keyboard.actionLabels.remove', labelValues)}
                      onClick={() => {
                        if (row.key !== null) {
                          actions.remove(row.commandId, row.key)
                        }
                      }}
                    >
                      {t('settings.keyboard.actions.remove')}
                    </button>
                  </>
                )}
                {row.isModified && firstOfCommand && (
                  <button
                    type="button"
                    className="fx-shortcuts__action"
                    data-testid={`settings-keyboard-reset-${row.commandId}`}
                    disabled={disabled}
                    aria-label={t('settings.keyboard.actionLabels.reset', labelValues)}
                    onClick={() => actions.reset(row.commandId)}
                  >
                    {t('settings.keyboard.actions.reset')}
                  </button>
                )}
              </span>
            </>
          )}
        </span>
      </div>

      {/*
        記録中は「確定したら」の注意だけを出す（今の注意と並べると、どちらの話か読み分けられない）。
      */}
      {isRecording ? (
        preview !== null && (
          <KeyWarningList
            warnings={preview}
            mode="preview"
            titleOf={actions.titleOf}
            label={t('settings.keyboard.warnings.label', {
              command: row.title,
              key: captured === null ? '' : formatKeybinding(captured)
            })}
          />
        )
      ) : (
        <KeyWarningList
          warnings={row}
          mode="row"
          titleOf={actions.titleOf}
          label={t('settings.keyboard.warnings.label', labelValues)}
        />
      )}
    </div>
  )
}

/**
 * 次に押された打鍵を記録する。
 *
 * ## `window` の capture で受け、伝播ごと止める
 *
 * 記録中の打鍵は**アプリのどこにも渡さない。** KeybindingProvider と既存の
 * Esc の購読はすべて `window` の bubble にあるので、capture で
 * `stopImmediatePropagation()` すれば1つも走らない（このファイルの冒頭）。
 * `preventDefault()` も呼ぶ ── Tab で focus が動いたり、Enter / Space で
 * ボタンが押されたりしないように。
 *
 * ## Enter と Esc だけは記録しない
 *
 * 修飾キー無しの Enter は「確定」、Esc は「取り消し」。どちらも単体では
 * 割り当てられない打鍵（editKeybindings.ts の `isAssignableChord`）なので、
 * 記録から外しても失うものが無い。Ctrl+Enter などは記録する。
 *
 * ## IME の変換中は何もしない
 *
 * 変換の確定の Enter を「確定」と読まないため（S1 の端末と同じ判断）。
 */
function KeyRecorder({
  onConfirm,
  onCancel,
  onCapture
}: {
  readonly onConfirm: (chord: KeyChord) => void
  readonly onCancel: () => void
  /** 打鍵を記録するたびに呼ぶ（行が警告を出すため。Shortcuts S5）。 */
  readonly onCapture: (chord: KeyChord) => void
}): JSX.Element {
  const { t } = useI18n()
  const [captured, setCaptured] = useState<KeyChord | null>(null)
  const boxRef = useRef<HTMLSpanElement>(null)

  const capturedRef = useRef(captured)
  capturedRef.current = captured
  const confirmRef = useRef(onConfirm)
  confirmRef.current = onConfirm
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  const captureRef = useRef(onCapture)
  captureRef.current = onCapture

  const assignable = captured !== null && isAssignableChord(captured)

  useEffect(() => {
    /*
      押した「変更」ボタンから focus を移す。ボタンに focus が残ったままだと、
      Space を離したときにボタンがもう一度押され、記録がやり直しになる。
    */
    boxRef.current?.focus()

    function onKeyDown(event: KeyboardEvent): void {
      event.preventDefault()
      event.stopImmediatePropagation()

      if (event.isComposing || event.keyCode === 229) {
        return
      }

      const plain = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey

      if (plain && event.key === 'Escape') {
        cancelRef.current()
        return
      }

      if (plain && event.key === 'Enter') {
        const chord = capturedRef.current

        if (chord !== null && isAssignableChord(chord)) {
          confirmRef.current(chord)
        }
        return
      }

      const chord = chordFromEvent(event)

      if (chord !== null) {
        setCaptured(chord)
        captureRef.current(chord)
      }
    }

    /* keyup も止める（押し下げだけを止めると、離した側で動く処理が残る）。 */
    function onKeyUp(event: KeyboardEvent): void {
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [])

  return (
    <span className="fx-shortcuts__recorder" data-testid="settings-keyboard-recorder">
      <span
        ref={boxRef}
        className="fx-shortcuts__recorder-box"
        tabIndex={-1}
        role="status"
        aria-live="polite"
        aria-label={t('settings.keyboard.recorder.label')}
        data-testid="settings-keyboard-recorder-box"
        data-captured={captured === null ? undefined : chordToken(captured)}
      >
        {captured === null ? t('settings.keyboard.recorder.prompt') : formatKeybinding(captured)}
      </span>
      <button
        type="button"
        className="fx-shortcuts__action fx-shortcuts__action--primary"
        data-testid="settings-keyboard-recorder-confirm"
        disabled={!assignable}
        onClick={() => {
          if (captured !== null && assignable) {
            onConfirm(captured)
          }
        }}
      >
        {t('settings.keyboard.actions.confirm')}
      </button>
      <button
        type="button"
        className="fx-shortcuts__action"
        data-testid="settings-keyboard-recorder-cancel"
        onClick={onCancel}
      >
        {t('settings.keyboard.actions.cancel')}
      </button>
      <span
        className="fx-shortcuts__recorder-hint"
        data-testid="settings-keyboard-recorder-hint"
        data-assignable={captured === null ? undefined : assignable}
      >
        {captured !== null && !assignable
          ? t('settings.keyboard.recorder.notAssignable')
          : t('settings.keyboard.recorder.hint')}
      </span>
    </span>
  )
}

function BuiltinShortcutGroupView({
  group,
  rows
}: {
  readonly group: BuiltinShortcutGroup
  readonly rows: readonly BuiltinShortcutRow[]
}): JSX.Element {
  const { t } = useI18n()

  return (
    <section className="fx-shortcuts__group" data-group={`builtin-${group}`} data-builtin="true">
      <h3 className="fx-shortcuts__group-title">{getBuiltinShortcutGroupTitle(group, t)}</h3>

      {rows.map((row) => (
        <BuiltinShortcutRowView key={row.id} row={row} />
      ))}
    </section>
  )
}

/**
 * 組み込みの1行（S2）。
 *
 * Command の行と同じ `fx-shortcuts__row` で描き、`data-builtin` で見分ける。
 * `data-command` を持たないので、Command の行だけを数える側
 * （`[data-command]`）には混ざらない。打鍵が2つある操作（やり直す）は
 * `kbd` を並べる。
 */
function BuiltinShortcutRowView({ row }: { readonly row: BuiltinShortcutRow }): JSX.Element {
  const { t } = useI18n()

  return (
    <div
      className="fx-shortcuts__row fx-shortcuts__row--builtin"
      role="listitem"
      data-testid={`settings-keyboard-builtin-${row.id}`}
      data-builtin-id={row.id}
      data-builtin="true"
    >
      <span className="fx-shortcuts__command">
        {row.title}
        {row.scope !== null && <span className="fx-shortcuts__scope">{row.scope}</span>}
        <span className="fx-shortcuts__badge">{t('settings.keyboard.builtin.badge')}</span>
      </span>
      <span className="fx-shortcuts__keys">
        {row.keybindings.map((keybinding) => (
          <kbd key={keybinding} className="fx-shortcuts__key">
            {keybinding}
          </kbd>
        ))}
      </span>
    </div>
  )
}
