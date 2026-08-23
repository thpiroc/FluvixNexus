import { TERMINAL_MAX_SESSIONS, type TerminalShellId } from '@shared/terminal'

/**
 * Terminal が開いているタブを「データ」として扱う層（React にも DOM にも依存しない）。
 *
 * Editor の editorTabsModel.ts と同じ役どころで、React 側
 * （useTerminalTabs.ts / TerminalTabs.tsx）は、ここが決めた結果を描くだけになる。
 *
 * ## 持つものと導くもの
 *
 * ```
 * 持つ    tabs（開いた順の並び） / activeTabId / 次の id
 * 導く    active（activeTabId との一致） / これ以上開けるか（上限との比較）
 * ```
 *
 * `active` をタブごとの真偽値として持たないのは Editor と同じ理由
 * ── 持つと「2枚が active」「1枚も active でない」が表現できてしまう。
 *
 * ## id は画面の鍵であって、セッションではない
 *
 * タブの id は `terminalId`（Renderer が発番し、画面 = xterm を指す）。
 * 動いているシェルの `sessionId` はここに持たない。**寿命が違う**ためで、
 * `exit` と打って立て直せば sessionId は変わるが、タブも画面も同じもので
 * あり続ける（terminalScreenStore.ts）。
 *
 * セッションの id は React の再描画に関係しない（画面へ流すのは購読側の仕事で、
 * 描き替える必要が無い）ので、状態ではなく ref として useTerminalTabs.ts が持つ。
 *
 * ## 上限はタブの枚数で見る
 *
 * `TERMINAL_MAX_SESSIONS` は本来「同時に動くプロセスの数」の歯止めで、
 * 終わったタブ（`exited`）はプロセスを持たない。それでもここでタブの枚数を
 * 数えているのは、**タブ列そのものも無限には伸びてほしくない**ため。
 * 数え方が Main と違うぶんこちら側が厳しくなるが、断るのは常に Main
 * （UI は迂回されうる。main/terminal/terminalSessions.ts）なので、
 * 緩い側に倒れることはない。
 */

/** 画面の状態。利用者に見せる文言はこの分類で決まる（TerminalTabs.tsx）。 */
export type TerminalStatus =
  /** まだ立てていない（開いた直後・器が大きさを測る前）。 */
  | 'idle'
  /** 起動を頼んで応答を待っている。 */
  | 'starting'
  /** 動いている。 */
  | 'running'
  /** シェルが終わった（`exit` と打たれた・落ちた）。 */
  | 'exited'
  /** 起動できなかった。 */
  | 'failed'

export interface TerminalTab {
  /** 画面の鍵（terminalScreenStore.ts）。セッションより長く生きる。 */
  readonly id: string
  /** どの行のシェルとして開いたか。立て直しでも変わらない。 */
  readonly shellId: TerminalShellId
  /**
   * タブに出す名前。
   *
   * 起動できてからは Main が返した表示名（`PowerShell`）。それより前は
   * 選択肢の一覧から引いた名前で、一覧がまだ届いていなければ null になる。
   * **null を「名前が無い」ではなく「まだ分からない」として持つ**のは、
   * OS ごとの既定のシェル名を Renderer 側に書かないため（shared/terminal/shell.ts）。
   */
  readonly shellName: string | null
  readonly status: TerminalStatus
  /** 終了コード（status が 'exited' のときだけ）。 */
  readonly exitCode: number | null
  /** 失敗の理由（status が 'failed' のときだけ）。 */
  readonly error: string | null
  /**
   * どの Workspace で**起動したか**（Session 3-7-3）。まだ立てていなければ null。
   *
   * シェルの作業ディレクトリは起動時に決まり、後から動かす手段が無い。
   * Workspace を切り替えても動いているターミナルはそのまま残る（cwd も変わらない）
   * ので、**今開いているフォルダと食い違っているタブ**が生まれる。
   * その食い違いを利用者へ出すためだけに持つ（TerminalTabs.tsx）。
   *
   * 持っているのは id だけで、パスも表示名も入っていない
   * （shared/terminal/session.ts ── Renderer へ OS の場所を渡さない）。
   * 立て直せば今の Workspace の id に変わる ── 新しいセッションは
   * 今開いているフォルダで起動するため。
   */
  readonly workspaceId: string | null
}

export interface TerminalTabsState {
  readonly tabs: readonly TerminalTab[]
  readonly activeTabId: string | null
  /** 次に発番する番号（layout/nodeId.ts と同じ形）。 */
  readonly nextId: number
}

export function createTerminalTabsState(): TerminalTabsState {
  return { tabs: [], activeTabId: null, nextId: 1 }
}

export function findTab(state: TerminalTabsState, tabId: string): TerminalTab | null {
  return state.tabs.find((tab) => tab.id === tabId) ?? null
}

export function findActiveTab(state: TerminalTabsState): TerminalTab | null {
  return state.activeTabId === null ? null : findTab(state, state.activeTabId)
}

/** これ以上開けるか（このファイルの冒頭）。 */
export function canOpenTab(state: TerminalTabsState): boolean {
  return state.tabs.length < TERMINAL_MAX_SESSIONS
}

/**
 * タブを1枚開く（開いた時点では立てない）。
 *
 * 立てるのは器が大きさを測れてから ── `terminal:create` には最初の大きさが要り、
 * 桁数を知らないまま立てると起動直後の1画面だけが違う幅で折り返される
 * （useTerminalTabs.ts）。
 *
 * 上限に達していれば**何も起きない**（同じ state を返す）。押せないボタンを
 * 押せてしまう状態は UI 側で作らないが、ここでも通さない。
 */
export function openTab(
  state: TerminalTabsState,
  shellId: TerminalShellId,
  shellName: string | null
): TerminalTabsState {
  if (!canOpenTab(state)) {
    return state
  }

  const id = `terminal-${state.nextId}`

  const tab: TerminalTab = {
    id,
    shellId,
    shellName,
    status: 'idle',
    exitCode: null,
    error: null,
    // どの Workspace で立つかは、実際に立ってから Main が返す（useTerminalTabs.ts）。
    workspaceId: null
  }

  return {
    tabs: [...state.tabs, tab],
    // 開いたら手前に出す。開いてから自分で選び直させる理由が無い。
    activeTabId: id,
    nextId: state.nextId + 1
  }
}

export function activateTab(state: TerminalTabsState, tabId: string): TerminalTabsState {
  if (state.activeTabId === tabId || findTab(state, tabId) === null) {
    return state
  }

  return { ...state, activeTabId: tabId }
}

/**
 * タブを閉じる。
 *
 * 手前のタブを閉じたときに次に出すのは**右隣、無ければ左隣**。Editor と同じで、
 * 「閉じた場所に近いもの」が次に来る方が、並びのどこに居るかを見失わない。
 *
 * シェルを終わらせるのと画面を捨てるのは呼び出し側（useTerminalTabs.ts）。
 * ここは並びだけを扱う。
 */
export function closeTab(state: TerminalTabsState, tabId: string): TerminalTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId)

  if (index === -1) {
    return state
  }

  const tabs = state.tabs.filter((tab) => tab.id !== tabId)

  if (state.activeTabId !== tabId) {
    return { ...state, tabs }
  }

  const next = tabs[index] ?? tabs[index - 1] ?? null

  return { ...state, tabs, activeTabId: next?.id ?? null }
}

/**
 * タブ1枚の状態を差し替える。
 *
 * 知らない id なら何も起きない ── 応答が返る前に閉じられたタブがこれにあたる
 * （非同期の結末が、もう無いものを指して届く）。
 */
export function updateTab(
  state: TerminalTabsState,
  tabId: string,
  patch: Partial<Omit<TerminalTab, 'id' | 'shellId'>>
): TerminalTabsState {
  if (findTab(state, tabId) === null) {
    return state
  }

  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab))
  }
}

/**
 * まだ名前が分からないタブに、選択肢の一覧から引いた名前を入れる。
 *
 * 一覧は非同期に届く（`terminal:list-shells`）ため、最初のタブは名前を持たずに
 * 現れる。**既に名前を持つタブには触らない** ── そちらは Main が返した
 * 「実際に起動したもの」の名前で、一覧より確かなものにあたる。
 */
export function fillShellNames(
  state: TerminalTabsState,
  nameOf: (shellId: TerminalShellId) => string | null
): TerminalTabsState {
  let changed = false

  const tabs = state.tabs.map((tab) => {
    if (tab.shellName !== null) {
      return tab
    }

    const name = nameOf(tab.shellId)

    if (name === null) {
      return tab
    }

    changed = true

    return { ...tab, shellName: name }
  })

  return changed ? { ...state, tabs } : state
}
