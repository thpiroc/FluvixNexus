import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isSameTerminalSize,
  TERMINAL_DEFAULT_SHELL_ID,
  type TerminalShellChoice,
  type TerminalShellId,
  type TerminalSize
} from '@shared/terminal'
import { fluvix } from '../api/fluvix'
import { useTheme } from '../theme/context'
import { readTerminalThemeColors } from '../theme/themeTokens'
import { type TerminalFontSizeCommand } from './terminalDisplay'
import { createTerminalScreenStore, type TerminalScreenStore } from './terminalScreenStore'
import type { TerminalDisplaySettings } from './terminalSettings'
import { useTerminalSettings } from './useTerminalSettings'
import {
  activateTab as activateTabIn,
  canOpenTab,
  closeTab as closeTabIn,
  createTerminalTabsState,
  fillShellNames,
  findTab,
  openTab as openTabIn,
  updateTab,
  type TerminalTab,
  type TerminalTabsState
} from './terminalTabsModel'

/**
 * 開いているターミナル（複数タブ）の状態と IPC（Session 3-7-2）。
 *
 * 持ち主は TerminalProvider（Workspace Shell の**外側**）。
 * パネルを閉じたり動かしたりしてもセッションが切れないのは、
 * この状態も画面（terminalScreenStore.ts）もパネルの中に無いため。
 *
 * ```
 * terminalTabsModel   … 並びの規則（React 非依存）
 * ここ                … セッションの生き死に、出力の受け取り、大きさの通知
 * terminalScreenStore … xterm のインスタンスと、その DOM
 * TerminalSurface     … 器。手前のタブの画面を付ける場所を1つ提供するだけ
 * ```
 *
 * ## Session 3-7-1 から変わったのは「1つ」が「並び」になったところだけ
 *
 * Main 側（`sessions` は最初から Map）もストア側（`terminalId` が鍵）も、
 * 複数を持てる形で書かれていた。増えたのはこのファイルが持つ状態と、
 * どのタブへの操作かを表す引数（`terminalId`）になる。
 *
 * ## セッションの id を state に持たない
 *
 * `sessionId` は**画面へ流す宛先を引くため**だけに要るもので、変わっても
 * 描き直す必要が無い（出力を画面へ渡すのは購読側の仕事で、React を通らない）。
 * state に置くと、シェルを立て直すたびにタブ列ごと描き替わる。
 *
 * そこでタブごとの「今どうなっているか」は2つに分かれる。
 *
 * | 何                                | どこ            | 変わると             |
 * | --------------------------------- | --------------- | -------------------- |
 * | status / 表示名 / 終了コード      | state（描く）   | タブの見た目が変わる |
 * | sessionId / 起動中か / 最後の大きさ | ref（描かない） | 何も描き替わらない   |
 *
 * ## 起動するのは、器が大きさを測れてから
 *
 * `terminal:create` には最初の大きさが要る（shared/ipc/contracts/terminal.ts）。
 * 桁数を知らないままシェルを立てると、起動直後の1画面だけが違う幅で
 * 折り返されたまま残る ── ConPTY は描き終わった行を折り返し直さない。
 *
 * したがって順番は「タブを開く → 器が現れる → 画面を作る → 測る → 立てる」で、
 * **Terminal パネルを一度も開いていなければシェルは動かない。**
 * これは意図した振る舞いにあたる（開いていないパネルのために OS のプロセスを
 * 立てておく理由が無い）。同じ理由で、**手前に出ていないタブは器を持たない**
 * ── 開いただけで立たず、切り替えて初めて立つ。
 *
 * ## Workspace が変わっても、動いているものは終わらせない（Session 3-7-3）
 *
 * Session 3-7-1 / 3-7-2 では、切り替えのたびに Main も Renderer も
 * すべて片付けていた。Session 3-7-3 でその扱いを改めてある。
 *
 * ```
 * 既に動いているタブ … そのまま。cwd は起動時のフォルダのまま変わらない
 * これから開くタブ   … 今開いている Workspace で起動する（決めるのは Main）
 * ```
 *
 * シェルの作業ディレクトリを後から動かす手段が無いのは以前と同じで、
 * 変えたのは**そこから何を導くか**になる。動いているプロセス
 * （ビルド・dev server・Claude Code）は、フォルダを見に行く操作1つで
 * 消えてよいものではない ── Editor のタブと違い、**捨てたものは戻せない。**
 *
 * 食い違い（今のフォルダと、そのターミナルのフォルダ）は隠さずタブに出す
 * （terminalTabsModel.ts の workspaceId / TerminalTabs.tsx）。
 */

export interface TerminalTabsController {
  readonly tabs: readonly TerminalTab[]
  /** 手前のタブ（＝器に画面が付いているもの）。 */
  readonly activeTabId: string | null
  /**
   * 今開いている Workspace（未選択なら null）。
   *
   * タブが持つ workspaceId と突き合わせて「別のフォルダで動いているターミナル」を
   * 見分けるために配る（Session 3-7-3）。
   */
  readonly workspaceId: string | null
  /** 起動できるシェルの選択肢（Main が調べたもの）。 */
  readonly shells: readonly TerminalShellChoice[]
  /** これ以上タブを開けるか（terminalTabsModel.ts）。 */
  readonly canOpen: boolean
  readonly screens: TerminalScreenStore
  /**
   * 端末の見え方（文字の大きさ・さかのぼれる行数）。全部のタブで同じ
   * （terminalScreenStore.ts）で、ディスクにも残る（Session 3-7-5）。
   */
  readonly display: TerminalDisplaySettings
  /** 打鍵（Ctrl + `+` / `-` / `0`）で文字の大きさを変える。 */
  readonly changeFontSize: (command: TerminalFontSizeCommand) => void
  /** 設定 UI から文字の大きさを指定する（TerminalSettingsMenu.tsx）。 */
  readonly setFontSize: (fontSize: number) => void
  /** 設定 UI からさかのぼれる行数を指定する。 */
  readonly setScrollback: (scrollback: number) => void
  /** 選択肢を取り直す（メニューを開いたとき）。 */
  readonly refreshShells: () => void
  /** タブを1枚開いて手前に出す。 */
  readonly openTab: (shellId: TerminalShellId) => void
  /**
   * 今なにかを実行しているタブ（Session 3-7-4）。
   *
   * 判断するのは Main で、ここはセッションの id をタブに引き直すだけ
   * （main/terminal/childProcesses.ts）。**聞けなかった場合は、
   * 動いているタブを全部返す** ── 分からないことを「何も動いていない」として
   * 返すと、確認なしで殺すことになる。
   */
  readonly listBusyTabs: () => Promise<readonly TerminalTab[]>
  /**
   * タブを閉じる（シェルも終わらせ、画面も捨てる）。
   *
   * **確認は挟まない。** 実行中かどうかを見て尋ねるのは useTerminalCloseGuard.ts で、
   * ここはその判断が済んだ後に呼ばれる（Editor の close と useTabCloseGuard の
   * 分け方と同じ）。
   */
  readonly closeTab: (terminalId: string) => void
  readonly activateTab: (terminalId: string) => void
  /** まだ立っていなければ立てる。器が大きさを測れた時点で呼ぶ。 */
  readonly ensureStarted: (terminalId: string, size: TerminalSize) => void
  /** 大きさが変わったことを伝える。同じ大きさなら何も送らない。 */
  readonly resize: (terminalId: string, size: TerminalSize) => void
  /** 打鍵をシェルへ流す。立っていなければ捨てる。 */
  readonly sendInput: (terminalId: string, data: string) => void
  /** 終わったセッションを立て直す（画面はそのまま）。 */
  readonly restart: (terminalId: string, size: TerminalSize) => void
}

/** 描き替えに関係しない、タブごとの現状（このファイルの冒頭）。 */
interface TabRuntime {
  /** 今立っているセッション。立っていなければ null。 */
  sessionId: string | null
  /** 起動を頼んでいる最中か。二重に立てないための歯止め。 */
  starting: boolean
  /** 最後に Main へ伝えた大きさ。同じ値を送り返さないため。 */
  lastSize: TerminalSize | null
}

/**
 * そのタブの現状を得る（無ければ作る）。
 *
 * コンポーネントの外に置いてあるのは、中のコールバックがこれを依存に
 * 持たずに済むようにするため（コールバックの同一性を変えない）。
 */
function runtimeOf(runtimes: Map<string, TabRuntime>, terminalId: string): TabRuntime {
  const existing = runtimes.get(terminalId)

  if (existing !== undefined) {
    return existing
  }

  const created: TabRuntime = { sessionId: null, starting: false, lastSize: null }
  runtimes.set(terminalId, created)

  return created
}

export function useTerminalTabs(workspaceId: string | null): TerminalTabsController {
  const screens = useMemo(() => createTerminalScreenStore(), [])

  const [state, setState] = useState<TerminalTabsState>(createTerminalTabsState)
  const [shells, setShells] = useState<readonly TerminalShellChoice[]>([])

  /*
    見え方は起動時にディスクから読み、変えたら書き戻す（Session 3-7-5）。
    その読み書きをここに書かないのは、いつ書くかと、シェルの生き死には
    別の話だから（useTerminalSettings.ts）。
  */
  const { settings: display, changeFontSize, setFontSize, setScrollback } = useTerminalSettings()

  /*
    Theme。値そのものは持たず（正本は theme/useAppearance.ts）、
    **変わったことを知るためだけ**に読む（Session 4-4）。
  */
  const { settings: appearance } = useTheme()

  /**
   * 今の state。`ensureStarted` などから読む。
   *
   * 状態を依存に入れず ref で読むのは、**コールバックの同一性を変えないため。**
   * これは器（TerminalSurface.tsx）が effect の依存に持つので、状態が変わるたびに
   * 別物になると、`idle → starting → running` の1回の起動で器の effect が
   * 3回張り直される（ResizeObserver を外して付け直し、画面の要素を入れ直す）。
   */
  const stateRef = useRef(state)
  const runtimeRef = useRef(new Map<string, TabRuntime>())

  stateRef.current = state

  /* ------------------------------------------------------------- 選択肢 */

  const refreshShells = useCallback((): void => {
    void fluvix.terminal.listShells().then((result) => {
      if (!result.ok) {
        /*
          一覧が取れなくても既定のシェルは開ける（Main は shellId だけで
          起動できる）。ここで空にすると、失敗した瞬間に `+` の隣のメニューから
          選択肢が消えるため、前の内容をそのまま残す。
        */
        return
      }

      const { shells: listed } = result.data

      setShells(listed)
      // まだ名前が分かっていないタブに入れる（terminalTabsModel.ts）。
      setState((current) =>
        fillShellNames(
          current,
          (shellId) => listed.find((shell) => shell.id === shellId)?.name ?? null
        )
      )
    })
  }, [])

  /* ------------------------------------------------------- 出力と終了の受け取り */

  /*
    **購読は Provider の寿命ぶん1度だけ**張る。セッションが立つたびに
    張り直す形にすると、立てた瞬間から購読が始まるまでの間に出力が流れる。
    宛先の判断はストアが持っている（sessionId → 画面）ので、
    ここは届いたものを渡すだけでよい。
  */
  useEffect(() => {
    const unsubscribeData = fluvix.terminal.onData(({ sessionId, data }) => {
      screens.write(sessionId, data)
    })

    const unsubscribeExit = fluvix.terminal.onExit(({ sessionId, exitCode }) => {
      screens.unbind(sessionId)

      /*
        どのタブのセッションだったかを引く。sessionId → terminalId の対応を
        state に持たないので（このファイルの冒頭）、ref の表から探す。
        高々 TERMINAL_MAX_SESSIONS 件で、シェルが終わるたびに1度しか通らない。
      */
      const entry = [...runtimeRef.current.entries()].find(
        ([, runtime]) => runtime.sessionId === sessionId
      )

      if (entry === undefined) {
        // 切り替えの前後で行き違ったもの（既に閉じたタブのセッション）。
        return
      }

      const [terminalId, runtime] = entry

      runtime.sessionId = null
      runtime.lastSize = null

      setState((current) => updateTab(current, terminalId, { status: 'exited', exitCode }))
    })

    return () => {
      unsubscribeData()
      unsubscribeExit()
    }
  }, [screens])

  /* ------------------------------------------------------------- 見え方 */

  /*
    変わったら全部の画面へ揃える（terminalScreenStore.ts）。ここで測り直さないのは、
    測れるのは器を持っている側だけだから ── 手前に出ていないタブの画面は
    DOM に入っておらず、文字の幅を測れない。手前のタブの測り直しと
    ConPTY への通知は TerminalSurface.tsx が受け持つ。

    起動直後にも1度通る（保存された設定が届いた時点）。既に開いている画面にも
    当たるので、**読み込みが間に合わなかったタブだけ 13px のまま**にはならない。
  */
  useEffect(() => {
    screens.applyDisplaySettings(display)
  }, [screens, display])

  /*
    Theme が変わったら、**開いている全部の画面**へ当て直す（Session 4-4）。
    手前に出ていないタブも含む ── 切り替えてから別のタブへ移ったときに、
    そのタブだけ前の色のまま、とはならない（terminalScreenStore.ts）。

    色は `<html>` から読む。ここへ着く時点で `data-fx-theme` は既に新しい値で
    （theme/ThemeProvider.tsx が描画の中で当てる）、この effect はその後に走る。

    これから作られる画面の分は覚えない ── 作る側が同じように `<html>` から
    読むので、覚えると同じ値の置き場所が2つできる。
  */
  useEffect(() => {
    screens.applyTheme(readTerminalThemeColors())
  }, [screens, appearance.theme])

  /* ----------------------------------------------------- Workspace への追従 */

  /*
    **Workspace が変わっても、動いているタブには手を出さない**（Session 3-7-3）。

    以前はここで画面もタブも捨てて1枚から始め直していた。改めた理由は
    このファイルの冒頭 ── 動いているプロセスは、フォルダを見に行く操作1つで
    消えてよいものではない。Main 側も切り替えでは片付けなくなっている
    （main/terminal/terminalSessions.ts）。

    ここに残るのは、**Workspace が開かれたときにタブが1枚も無ければ1枚置く**
    ことだけになる。切り替えのたびに足さないのは、開いた覚えのないターミナルが
    増えていくのを避けるため ── 新しいフォルダで1本要るなら `＋` で開く
    （そのとき起動するのは、今開いているフォルダにほかならない）。

    片付けるのは Provider が消えるとき（＝ウィンドウが閉じるとき）だけ。
    Main 側のセッションはそれでも残るが、アプリの終了で必ず片付く
    （app/lifecycle.ts の will-quit）。
  */
  useEffect(() => {
    if (workspaceId === null) {
      return
    }

    setState((current) =>
      current.tabs.length === 0 ? openTabIn(current, TERMINAL_DEFAULT_SHELL_ID, null) : current
    )

    /*
      選択肢を取り直す。環境はアプリを開いたまま変わりうるうえ、ここで置いた
      1枚はまだ名前を知らない（起動して Main が返すまでは一覧から引く）。
    */
    refreshShells()
  }, [workspaceId, refreshShells])

  /* 画面を捨てるのは Provider が消えるときだけ（上記）。 */
  useEffect(() => {
    return () => {
      screens.releaseAll()
      runtimeRef.current.clear()
    }
  }, [screens])

  /* ------------------------------------------------------------- 起動と入力 */

  const start = useCallback(
    (terminalId: string, size: TerminalSize): void => {
      const tab = findTab(stateRef.current, terminalId)
      const runtime = runtimeOf(runtimeRef.current, terminalId)

      if (tab === null || runtime.starting || runtime.sessionId !== null) {
        return
      }

      runtime.starting = true
      runtime.lastSize = size

      setState((current) =>
        updateTab(current, terminalId, { status: 'starting', error: null, exitCode: null })
      )

      void fluvix.terminal.create({ shellId: tab.shellId, size }).then((result) => {
        runtime.starting = false

        /*
          応答が返るまでに閉じられていることがある。そのときセッションだけが
          Main に残るため、ここで片付ける（画面はもう無いので流し込む先も無い）。
        */
        if (findTab(stateRef.current, terminalId) === null) {
          if (result.ok) {
            void fluvix.terminal.dispose({ sessionId: result.data.session.id })
          }

          return
        }

        if (!result.ok) {
          runtime.lastSize = null
          setState((current) =>
            updateTab(current, terminalId, {
              status: 'failed',
              // 文言ではなく失敗そのものを持つ（言い表すのは描くとき。TerminalView.tsx）。
              error: result.error
            })
          )

          return
        }

        const { session } = result.data

        runtime.sessionId = session.id
        /*
          画面と結び付ける。応答を待っている間に届いていた出力は、
          ここでまとめて流れ込む（terminalScreenStore.ts）。
        */
        screens.bind(terminalId, session.id)

        setState((current) =>
          updateTab(current, terminalId, {
            status: 'running',
            shellName: session.shellName,
            /*
              どのフォルダで立ったかを Main の答えから受け取る（推測しない）。
              要求を出してから立つまでの間に切り替えられていることがあり、
              そのとき正しいのは Main が実際に使った方になる。
            */
            workspaceId: session.workspaceId
          })
        )
      })
    },
    [screens]
  )

  const ensureStarted = useCallback(
    (terminalId: string, size: TerminalSize): void => {
      const tab = findTab(stateRef.current, terminalId)
      const runtime = runtimeOf(runtimeRef.current, terminalId)

      /*
        器が現れるたびに呼ばれる（パネルを開き直した・別の場所へ動かした・
        タブを切り替えた）。既に立っていれば何もしない ── ここで立て直すと、
        タブを切り替えただけでシェルが変わる。
      */
      if (tab === null || runtime.sessionId !== null || runtime.starting) {
        return
      }

      // 終わった / 失敗した後は、利用者が選ぶまで自動では立て直さない。
      if (tab.status === 'exited' || tab.status === 'failed') {
        return
      }

      start(terminalId, size)
    },
    [start]
  )

  const resize = useCallback((terminalId: string, size: TerminalSize): void => {
    const runtime = runtimeOf(runtimeRef.current, terminalId)

    if (runtime.sessionId === null) {
      return
    }

    /*
      同じ大きさなら送らない。ResizeObserver は器が1px 変わるたびに鳴るが、
      文字数に直すと変わらないことがほとんどで、そのたびに ConPTY を
      作り直させるのは無駄でしかない。
    */
    if (runtime.lastSize !== null && isSameTerminalSize(runtime.lastSize, size)) {
      return
    }

    runtime.lastSize = size
    void fluvix.terminal.resize({ sessionId: runtime.sessionId, size })
  }, [])

  const sendInput = useCallback((terminalId: string, data: string): void => {
    const sessionId = runtimeOf(runtimeRef.current, terminalId).sessionId

    /*
      終わったセッションへの打鍵は黙って捨てる。失敗として見せると、
      終了した画面をクリックしただけで理由の分からない案内が出る。
    */
    if (sessionId === null) {
      return
    }

    void fluvix.terminal.write({ sessionId, data })
  }, [])

  const restart = useCallback(
    (terminalId: string, size: TerminalSize): void => {
      const runtime = runtimeOf(runtimeRef.current, terminalId)

      if (runtime.sessionId !== null || runtime.starting) {
        return
      }

      /*
        画面は捨てない。それまでの出力を読み返したまま次を始められる方が、
        白紙から始まるより追いやすい（`clear` はシェル側の仕事）。
      */
      start(terminalId, size)
    },
    [start]
  )

  /* --------------------------------------------------------------- タブの操作 */

  const openTab = useCallback((shellId: TerminalShellId): void => {
    setState((current) => openTabIn(current, shellId, null))
  }, [])

  const closeTab = useCallback(
    (terminalId: string): void => {
      const runtime = runtimeRef.current.get(terminalId)

      /*
        タブを閉じることは、そのシェルを終わらせること。パネルを閉じた /
        動かしただけでは呼ばれない（セッションの寿命はパネルの表示より長い。
        shared/api.ts の dispose）。

        実行中のコマンドがある場合に尋ねるのは useTerminalCloseGuard.ts で、
        ここへ来た時点でその判断は済んでいる。
      */
      if (runtime?.sessionId != null) {
        void fluvix.terminal.dispose({ sessionId: runtime.sessionId })
      }

      runtimeRef.current.delete(terminalId)
      // 画面はここで捨てる。閉じたタブのスクロールバックを持ち続ける理由が無い。
      screens.release(terminalId)

      setState((current) => closeTabIn(current, terminalId))
    },
    [screens]
  )

  const activateTab = useCallback((terminalId: string): void => {
    setState((current) => activateTabIn(current, terminalId))
  }, [])

  /* ------------------------------------------------------------- 実行中かどうか */

  /*
    立っているセッションを持つタブだけを Main へ突き合わせる（Session 3-7-4）。

    問い合わせは**セッション単位ではなく1回**にしてある ── Main は自分の表を
    まとめて調べるので（main/terminal/childProcesses.ts）、8本開いていても
    OS へ聞くのは1度で済む。どのセッションについて聞くかを言わないのも
    そのためで、要求には欄そのものが無い（shared/ipc/contracts/terminal.ts）。
  */
  const listBusyTabs = useCallback(async (): Promise<readonly TerminalTab[]> => {
    const live = stateRef.current.tabs
      .map((tab) => ({ tab, sessionId: runtimeRef.current.get(tab.id)?.sessionId ?? null }))
      .filter((entry): entry is { tab: TerminalTab; sessionId: string } => entry.sessionId !== null)

    // 立っているものが1つも無い。聞くまでもなく、失われるものは無い。
    if (live.length === 0) {
      return []
    }

    const result = await fluvix.terminal.listBusy()

    if (!result.ok) {
      /*
        聞けなかった。**動いているタブを全部返す**（尋ねる側に倒す）。
        Main 側も分からなかった場合は同じ側へ倒れており、ここはその外側で
        起きた失敗（IPC そのものが通らなかった）にあたる。
      */
      console.warn('[terminal] 実行中かどうかを確かめられませんでした。', result.error)

      return live.map((entry) => entry.tab)
    }

    const busy = new Set(result.data.busySessionIds)

    return live.filter((entry) => busy.has(entry.sessionId)).map((entry) => entry.tab)
  }, [])

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    workspaceId,
    shells,
    canOpen: canOpenTab(state),
    screens,
    display,
    changeFontSize,
    setFontSize,
    setScrollback,
    refreshShells,
    openTab,
    listBusyTabs,
    closeTab,
    activateTab,
    ensureStarted,
    resize,
    sendInput,
    restart
  }
}
