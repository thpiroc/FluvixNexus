import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { StoredKeybindingEntry } from '@shared/keybindings'
import { fluvix } from '../api/fluvix'
import { useCommands } from '../commands/context'
import { useEditorContext } from '../editor/context'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { chordFromEvent } from './chord'
import {
  KeybindingContext,
  type KeybindingController,
  type UserKeybindingsState,
  type UserKeybindingsStatus
} from './context'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { dispatchKeybinding } from './dispatch'
import { resolveKeybindings } from './resolve'
import { readUserKeybindings } from './userKeybindings'
import { emptyWhenContext, type WhenContext, type WhenKey } from './when'

/**
 * 打鍵を受け、command を1つ実行する（Session 4-7A）。
 *
 * **アプリ全体で `window` の keydown を待つのはこの1箇所だけ。**
 * 既存の Esc（17箇所）とパネルのドラッグ / リサイズの取り消しは、
 * それぞれ自分の状態が生きている間だけ購読する形のまま ── Session 4-7A では
 * **1行も触っていない**（Esc は割り当てではなく「今している操作をやめる」で、
 * `ui/Popover.tsx` の `escapeSuspended` を含む層順の作法が既にある）。
 *
 * ## Monaco とぶつからない理由（構造として）
 *
 * Monaco は自分が処理した打鍵に `preventDefault()` **と `stopPropagation()` の
 * 両方**を呼ぶ（`monaco-editor/esm/vs/editor/standalone/browser/
 * standaloneServices.js` の `StandaloneKeybindingService`）。
 * したがって **`ctrl+f` などはそもそも `window` まで上がってこない。**
 *
 * 「今は動く」ではなく構造として決まる ── Monaco が処理する打鍵は伝播が
 * 止まっている以上、ここのコードには到達しない。逆に `ctrl+s` は Monaco が
 * 何も割り当てていないので上がってくる（`editor/useEditorSession.ts` が
 * Session 3-5 から前提にしていたことと同じ）。
 *
 * **Monaco の既定を上書きしたい command が将来出たら、ここではなく
 * `editor.addAction()` 側で登録すること。** `window` から Monaco と戦うと、
 * 「Editor の中だけ挙動が違う」を作ることになる。
 *
 * ## Terminal とぶつからない理由（2段ある）
 *
 * **1段目は xterm 自身。** xterm も、自分がシェルへ流す打鍵には
 * `preventDefault()` と `stopPropagation()` の両方を呼ぶ
 * （`cancel(event, true)`。`@xterm/xterm` の `CoreBrowserTerminal`）。
 * したがって `ctrl+s` / `ctrl+j` のような**制御文字になる打鍵は、
 * 端末に focus があるとここまで上がってこない。**
 *
 * これは Session 4-7A で実機に window listener を仕込んで確かめてある ──
 * 端末に focus を置いて Ctrl+S / Ctrl+J / Ctrl+`,` を打つと、
 * window に届くのは `Control` 自身と `,` だけになる。
 *
 * **2段目がここ。** 上の通り `ctrl+,` は xterm が消費しないので届く ──
 * つまり1段目だけでは足りない。そこで `terminalFocused` を見て、
 * **端末を触っている最中にアプリ側の操作を走らせない**
 * （`defaults.ts` の `'!terminalFocused'`）。焦点が端末パネルの中でも
 * xterm の textarea の外（タブ列・設定メニュー）にある場合も、これが受け持つ。
 *
 * ## `event.defaultPrevented` を見て降りる形にはしていない
 *
 * Monaco も xterm も、自分が処理した打鍵では**伝播ごと止める**ので、
 * この判定を足しても防げるものが増えない。一方で、`preventDefault()` だけを
 * 呼ぶ無関係な handler（入力欄の Enter など）が1つ増えるたびに、
 * **割り当てが黙って効かなくなる経路**ができる。買えるものが無く、
 * 失うものがある判定なので置いていない。
 *
 * ## 端末側の横取り経路は1行も変えていない
 *
 * `terminal/xtermSetup.ts` の `attachCustomKeyEventHandler` →
 * `TerminalSurface.tsx` の `onAppKey` は **Session 4-7A では素通り。**
 * 文字の大きさの3つ（Ctrl + `+` / `-` / `0`）は今までどおりあちらが受け持つ
 * ── あちらは日本語配列のための `=` / `_` の読み替えを持っており、
 * registry へ移すならその設計ごと見直すことになる（Session 4-7B）。
 *
 * **端末の中だけで効く command を足すときは、この Provider ではなく
 * あちらへ繋ぐこと。** ここから届かない打鍵があるのは上の1段目の通りで、
 * それは xterm の窓口で決めるべきものにあたる。
 *
 * ## `preventDefault()` を呼ぶ条件
 *
 * **command を実際に実行できたときだけ。** 割り当てが無いとき、条件が合わない
 * とき、所有者が居ないとき（`execute` が false）は呼ばない ── 先回りして
 * 止めると、何も起きないのにブラウザの既定（入力・IME）まで死ぬ。
 */
export function KeybindingProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { execute } = useCommands()
  const { workspace } = useWorkspaceFolder()
  const { activeTab } = useEditorContext()

  const [stored, setStored] = useState<StoredFile>(INITIAL_STORED_FILE)

  useEffect(() => {
    let cancelled = false

    void loadStoredFile().then((file) => {
      if (!cancelled) {
        setStored(file)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const user = useMemo(() => readUserKeybindings(stored.entries), [stored.entries])

  /*
    効く割り当ての表（Shortcuts S3 で固定でなくなった）。

    既定の後ろにユーザーの rule を連結するだけで、上書きも解除も
    resolve.ts の後勝ちの規則から出る。**ユーザーの行が空なら v1 と同じ表になる**
    （keybindings.dom.test.ts）。読み込みが返るまでは既定だけで動く ──
    起動直後の打鍵を、ファイルを待つために捨てない。

    作り直されるのは読み込みが返ったときと保存したときだけ。`entries` の参照は
    それ以外で変わらない（Settings の一覧が依存に載せている）。
  */
  const { entries } = useMemo(
    () => resolveKeybindings([...DEFAULT_KEYBINDINGS, ...user.rules]),
    [user.rules]
  )

  /*
    DOM からは見て取れない条件（React が持つ真偽値）。

    state ではなく ref にしてあるのは CommandProvider と同じ理由 ──
    読むのは打鍵が届いた瞬間だけで、描画には1つも使わない。
    state にすると Settings を開閉するたびに配下が描き直される。
  */
  const flagsRef = useRef<Map<WhenKey, boolean>>(new Map())

  /*
    こちらは「今の値」を打鍵の瞬間に読むための控え。
    listener を1度だけ張るために、変わりうる値はすべて ref を経由させる。
  */
  const stateRef = useRef({ workspaceOpen: false, editorHasActiveTab: false })
  stateRef.current = {
    workspaceOpen: workspace !== null,
    editorHasActiveTab: activeTab !== null
  }

  const executeRef = useRef(execute)
  executeRef.current = execute

  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const setFlag = useCallback((key: WhenKey, value: boolean): (() => void) => {
    flagsRef.current.set(key, value)

    return () => {
      flagsRef.current.delete(key)
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const chord = chordFromEvent(event)

      if (chord === null) {
        // 修飾キーそのもの。まだ打鍵になっていない。
        return
      }

      const context = readWhenContext(flagsRef.current, stateRef.current)
      const commandId = dispatchKeybinding(chord, context, entriesRef.current)

      if (commandId === null) {
        return
      }

      /*
        実行できたときだけ止める（このファイルの冒頭）。所有者が居ない command は
        `execute` が false を返し、ブラウザの既定はそのまま通る。
      */
      if (executeRef.current(commandId)) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const storedRef = useRef(stored)
  storedRef.current = stored

  const saveUserKeybindings = useCallback(
    async (next: readonly StoredKeybindingEntry[]): Promise<boolean> => {
      if (!canSave(storedRef.current.status)) {
        return false
      }

      const result = await fluvix.keybindings.save({ entries: next })

      if (!result.ok) {
        console.warn('[keybindings] キー割り当てを保存できませんでした。', result.error)
        return false
      }

      /*
        表を作り直すのは保存が受け付けられた後。先に差し替えると、Main が形で
        拒んだとき「画面では効いているが、次の起動で消える」割り当てができる。
      */
      setStored({ status: 'loaded', entries: next, skippedCount: 0 })
      return true
    },
    []
  )

  const userKeybindings = useMemo<UserKeybindingsState>(
    () => ({
      status: stored.status,
      entries: stored.entries,
      skippedCount: stored.skippedCount,
      rules: user.rules,
      invalid: user.invalid
    }),
    [stored, user]
  )

  const controller = useMemo<KeybindingController>(
    () => ({ entries, setFlag, userKeybindings, saveUserKeybindings }),
    [entries, setFlag, userKeybindings, saveUserKeybindings]
  )

  return <KeybindingContext.Provider value={controller}>{children}</KeybindingContext.Provider>
}

/**
 * 打鍵が届いた瞬間の状態を集める。
 *
 * DOM を読む3つ（`editorFocused` / `terminalFocused` / `modalOpen`）は、
 * **React が持っていない状態**にあたる。
 *
 *   focus  … 持ち主はブラウザで、React の state には無い
 *   modal  … 出す側が6箇所に散っている（Editor / Files / Git / Terminal / Unsaved）
 *
 * 後者を申告制にすると6箇所を触ることになり、しかもその大半は
 * Session 4-7B の範囲（panel の中）になる。`aria-modal="true"` は
 * それらが**既に**付けている属性で、「操作を遮る面が出ている」ことの
 * 観測できる印にほかならない ── 新しく約束を作らずに済む。
 */
function readWhenContext(
  flags: ReadonlyMap<WhenKey, boolean>,
  state: { readonly workspaceOpen: boolean; readonly editorHasActiveTab: boolean }
): WhenContext {
  const base = emptyWhenContext()

  return {
    ...base,
    workspaceOpen: state.workspaceOpen,
    editorHasActiveTab: state.editorHasActiveTab,
    editorFocused: isFocusInsidePanel('editor'),
    terminalFocused: isFocusInsidePanel('terminal'),
    settingsOpen: flags.get('settingsOpen') ?? base.settingsOpen,
    modalOpen: document.querySelector('[aria-modal="true"]') !== null
  }
}

/**
 * 今 focus があるのがそのパネルの中か。
 *
 * 目印は `workspace/shell/PanelGroup.tsx` が本体の器へ付ける
 * `data-panel-body`。タブ側の `data-panel` と名前を分けてあるのは、
 * `closest()` がタブを拾わないようにするため（タブは本体の外にある）。
 */
function isFocusInsidePanel(panelId: 'editor' | 'terminal'): boolean {
  const active = document.activeElement

  if (active === null) {
    return false
  }

  return active.closest(`[data-panel-body="${panelId}"]`) !== null
}

/** `keybindings.json` から読んだもの（読み替える前）。 */
interface StoredFile {
  readonly status: UserKeybindingsStatus
  readonly entries: readonly StoredKeybindingEntry[]
  readonly skippedCount: number
}

const INITIAL_STORED_FILE: StoredFile = { status: 'loading', entries: [], skippedCount: 0 }

/**
 * `keybindings.json` を読む。**失敗しても投げない。**
 *
 * 割り当てが読めないことは、打鍵そのものを使えない理由にならない ──
 * 既定の割り当てはそのまま効く（設定の useSettingsSection.ts と同じ扱い）。
 */
async function loadStoredFile(): Promise<StoredFile> {
  try {
    const result = await fluvix.keybindings.load()

    if (result.ok) {
      return result.data
    }

    console.warn('[keybindings] キー割り当てを読み込めませんでした。', result.error)
  } catch (cause) {
    // Preload が動いていない環境（fluvix.ts）。既定の割り当てだけで動く。
    console.warn('[keybindings] キー割り当てを読み込めませんでした。', cause)
  }

  return { status: 'failed', entries: [], skippedCount: 0 }
}

/**
 * 保存してよいか。
 *
 * 読み込みが返っていない・IPC が失敗した間は、ファイルに何が書いてあるか分からない。
 * そこへ書くと利用者の割り当てを消しうるので保存しない。壊れたファイル
 * （`unreadable`）は保存してよい ── Main が上書きの前に退避する
 * （main/store/keybindingsStore.ts）。
 */
function canSave(status: UserKeybindingsStatus): boolean {
  return status !== 'loading' && status !== 'failed'
}
