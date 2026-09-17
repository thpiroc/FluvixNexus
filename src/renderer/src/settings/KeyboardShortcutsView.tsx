import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { StoredKeybindingEntry } from '@shared/keybindings'
import type { CommandId } from '../commands/commandIds'
import { COMMAND_CATEGORY_ORDER, getCommandCategoryTitle } from '../commands/commandCategoryLabels'
import { listCommands } from '../commands/registry'
import { commandTitle, type CommandCategory } from '../commands/types'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'
import { chordFromEvent, chordToken, formatKeybinding, type KeyChord } from '../keybindings/chord'
import { useKeybindings, type UserKeybindingsStatus } from '../keybindings/context'
import {
  commandKeys,
  defaultCommandKeys,
  isAssignableChord,
  modifiedCommandIds,
  replaceKey,
  withCommandKeys
} from '../keybindings/editKeybindings'
import {
  buildShortcutRows,
  filterShortcutRows,
  type ShortcutRow
} from '../keybindings/shortcutRows'

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
 * ## 競合・予約キーの警告と、読めない行の表示は S5
 *
 * ここでは出さない。行の `conflictsWith` はまだ画面に出ていない。
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
        modified
      ),
    [entries, t, modified]
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
      }
    }),
    [editable, recording, setKeys, userKeybindings.rules]
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

      {error !== null && (
        <p className="fx-shortcuts__error" role="alert" data-testid="settings-keyboard-error">
          {t(error)}
        </p>
      )}

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
            <ShortcutGroup
              key={group.category}
              category={group.category}
              rows={group.rows}
              actions={actions}
            />
          ))}
        </div>
      )}

      <div className="fx-shortcuts__notes">
        <p className="fx-shortcuts__note">{t('settings.keyboard.editNote')}</p>
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
    >
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
          <KeyRecorder onConfirm={actions.confirmRecording} onCancel={actions.cancelRecording} />
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
  onCancel
}: {
  readonly onConfirm: (chord: KeyChord) => void
  readonly onCancel: () => void
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
