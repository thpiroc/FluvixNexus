import {
  isAtOrUnder,
  rebaseRelativePath,
  splitRelativePath,
  type FileEncoding,
  type FileLineEnding,
  type FileRevision,
  type WorkspaceFileChange
} from '@shared/files'
import { hasUnsavedChanges, type EditorTabState } from './editorTabState'

/**
 * Editor が開いているタブを「データ」として扱う層（React にも DOM にも依存しない）。
 *
 * Workspace Shell で layout/ が果たしている役どころと同じ。
 * React 側（useEditorTabs.ts / EditorTabs.tsx）は、ここが決めた結果を描くだけになる。
 *
 * ## 何を状態として持ち、何を導くか
 *
 * ```
 * 持つ    tabs（開いた順の並び） / activeTabId / 次の id
 * 導く    active（activeTabId との一致） / 同じファイルが既に開いているか（relativePath の一致）
 * ```
 *
 * **`active` をタブごとの真偽値として持たない。** 持つと「2枚が active」「1枚も active でない」
 * という状態が表現できてしまい、切り替えのたびに全タブを書き換える必要も出る。
 * Workspace Shell がパネルの可視状態をレイアウトから導出している（ARCHITECTURE.md §7.7）
 * のと同じ考え方。
 *
 * ## id は relativePath ではない
 *
 * 重複を防ぐ鍵は relativePath だが、**タブの同一性は id で持つ**。リネームで
 * relativePath が変わってもタブは同じタブであり続ける（開き直しにならない）ため。
 * relativePath を id にすると、リネームのたびに React から見て別のタブになり、
 * スクロール位置や将来の編集状態が失われる。
 *
 * ## state はここが持ち、判断はここでしない
 *
 * 「ディスクの内容と食い違っているか」「ディスク側も変わったか」を決めるのは
 * Monaco の Model を持つ層（monaco/documentStore.ts）で、ここはその結果を
 * **タブの属性として持つ**だけ。分けてある理由はそちらの冒頭にある
 * （同一性の基準が id と位置で違う）。
 *
 * ここに置いておくことで、「閉じてよいか」「印を出すか」という判断の入口が
 * タブの側に揃う（Session 3-3 の時点で項目だけ用意してあった理由）。
 * 状態の種類と導き方は editorTabState.ts。
 */

/** 開いたファイルの中身。読み込み中と、テキストとして出せない場合も状態として持つ。 */
export type EditorDocument =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly content: string
      readonly byteLength: number
      /** 読み込んだ時点の改行。保存の際に形を保つために持つ。 */
      readonly lineEnding: FileLineEnding
      /**
       * 読み込んだ時点の文字コード（shared/files/content.ts）。
       *
       * 保存の要求にそのまま返すために持つ。今のところ違いは BOM の有無だけ。
       */
      readonly encoding: FileEncoding
      /**
       * 読み込んだ時点の版（shared/files/content.ts）。
       *
       * 保存の要求にそのまま添える。Main 側が「読んだときのまま保存しようとしているか」を
       * 確かめるのに使う。届かなかった場合は null（確かめずに上書きする側へ倒れる）。
       */
      readonly revision: FileRevision | null
    }
  /** テキストとして出せない（shared/files/content.ts）。 */
  | { readonly status: 'binary'; readonly byteLength: number }
  | { readonly status: 'too-large'; readonly byteLength: number }
  | { readonly status: 'error'; readonly reason: EditorDocumentErrorReason }

/**
 * 開けなかった理由。
 *
 * ファイルツリー（files/fileTreeModel.ts の FileTreeErrorReason）と同じ3分類にしてある。
 * 表示側が知りたいのは「消えたのか / 権限が無いのか / それ以外か」だけで、
 * 対応付けは files/filesError.ts が持つ。
 */
export type EditorDocumentErrorReason = 'not-found' | 'permission-denied' | 'unavailable'

/** 開いているファイル1枚。 */
export interface EditorTab {
  /** タブの同一性。リネームされても変わらない。 */
  readonly id: string
  /** Workspace root からの相対位置。同じ位置のタブは2枚作らない。 */
  readonly relativePath: string
  /** タブに出す名前（ファイル名）。 */
  readonly name: string
  /** 中身。開いた直後は 'loading'。 */
  readonly document: EditorDocument
  /**
   * 未保存かどうかと、ディスク側との食い違い（タブに印を出す判断）。
   *
   * 決めるのは monaco/documentStore.ts で、ここはその結果を持つだけ
   * （editorTabState.ts）。
   */
  readonly state: EditorTabState
}

export interface EditorTabsState {
  readonly tabs: readonly EditorTab[]
  /** 手前に出ているタブ。1枚も無ければ null。 */
  readonly activeTabId: string | null
  /** 次に発番する id の種。状態に持つのは、同じ状態からは同じ結果が出るようにするため。 */
  readonly nextTabNumber: number
}

export const EMPTY_EDITOR_TABS: EditorTabsState = {
  tabs: [],
  activeTabId: null,
  nextTabNumber: 1
}

/* ------------------------------------------------------------------ 導出 */

/** そのタブが手前に出ているか。 */
export function isTabActive(state: EditorTabsState, tabId: string): boolean {
  return state.activeTabId === tabId
}

/** 手前に出ているタブ。 */
export function findActiveTab(state: EditorTabsState): EditorTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
}

/** その位置のファイルを開いているタブ。 */
export function findTabByPath(state: EditorTabsState, relativePath: string): EditorTab | null {
  return state.tabs.find((tab) => tab.relativePath === relativePath) ?? null
}

/**
 * 閉じると内容が失われるタブ。
 *
 * Workspace を切り替える / 閉じる / アプリを終了する前の確認で、
 * 「何が失われるか」を並べるのに使う（renderer/src/unsaved/）。
 * 判断は状態から導くだけで、ここに別の印を持たない。
 */
export function listUnsavedTabs(state: EditorTabsState): readonly EditorTab[] {
  return state.tabs.filter((tab) => hasUnsavedChanges(tab.state))
}

/* ------------------------------------------------------------------ 操作 */

/**
 * ファイルを開く。
 *
 * **同じ relativePath のタブは2枚作らない。** 既にあればそれを手前に出すだけで、
 * 中身も読み直さない（読み直すと、開いていたファイルをもう一度選んだだけで
 * 表示中の内容が置き換わる）。
 *
 * **「読み込みが要るか」をここでは返さない。** 新しいタブは中身が 'loading' で始まり、
 * 既存のタブはそうならない。読み込みの要否は状態から導ける（useEditorTabs.ts）ので、
 * 戻り値で伝えると同じことを2通りで表すことになる。
 */
export function openTab(
  state: EditorTabsState,
  input: { readonly relativePath: string; readonly name: string }
): EditorTabsState {
  const existing = findTabByPath(state, input.relativePath)

  if (existing !== null) {
    return activateTab(state, existing.id)
  }

  const tabId = `tab-${state.nextTabNumber}`

  const tab: EditorTab = {
    id: tabId,
    relativePath: input.relativePath,
    name: input.name,
    document: { status: 'loading' },
    state: 'clean'
  }

  return {
    tabs: [...state.tabs, tab],
    activeTabId: tabId,
    nextTabNumber: state.nextTabNumber + 1
  }
}

/** タブを手前に出す。無い id なら何もしない（元のオブジェクトをそのまま返す）。 */
export function activateTab(state: EditorTabsState, tabId: string): EditorTabsState {
  if (state.activeTabId === tabId || !state.tabs.some((tab) => tab.id === tabId)) {
    return state
  }

  return { ...state, activeTabId: tabId }
}

/**
 * タブを閉じる。
 *
 * 手前のタブを閉じたときは**隣を手前に出す**（右、無ければ左）。
 * 先頭に戻す形にすると、続けて閉じるたびに見ている場所が飛ぶ。
 */
export function closeTab(state: EditorTabsState, tabId: string): EditorTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId)

  if (index < 0) {
    return state
  }

  const tabs = state.tabs.filter((tab) => tab.id !== tabId)

  if (state.activeTabId !== tabId) {
    return { ...state, tabs }
  }

  const next = tabs[index] ?? tabs[index - 1] ?? null

  return { ...state, tabs, activeTabId: next?.id ?? null }
}

/** 中身が届いた（あるいは読めなかった）ことを反映する。 */
export function setTabDocument(
  state: EditorTabsState,
  tabId: string,
  document: EditorDocument
): EditorTabsState {
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    // 読み込み中に閉じられたタブ。届いた中身は捨てる。
    return state
  }

  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, document } : tab))
  }
}

/**
 * タブの状態（未保存・Conflict・削除済み）を差し替える。
 *
 * **鍵がタブ id ではなく relativePath なのは、伝えてくる側が Monaco の Model を持つ層
 * （monaco/documentStore.ts）だから。**あちらはファイルの位置しか知らず、
 * タブ id は知らない ── 2つの層がそれぞれの同一性の基準で動けるように、
 * 変換をこの1箇所に閉じてある。
 *
 * 変化が無ければ元のオブジェクトをそのまま返す（layout/ の操作関数と同じ約束）。
 * 状態は文字を打つたびに伝わるため、ここで止めないと打鍵ごとに全タブが再描画される。
 */
export function setTabStateByPath(
  state: EditorTabsState,
  relativePath: string,
  tabState: EditorTabState
): EditorTabsState {
  const target = findTabByPath(state, relativePath)

  if (target === null || target.state === tabState) {
    return state
  }

  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === target.id ? { ...tab, state: tabState } : tab))
  }
}

/**
 * タブを別の位置へ移す（別名で保存。Session 4-2）。
 *
 * 改名の追従（`applyFileChanges` の `renamed`）と**同じことをする**が、入口を分けてある。
 * あちらはディスク側で起きたことを写す受け身の経路で、こちらは利用者の操作から
 * 直に呼ばれる ── 混ぜると、`files:changed` を受け取っていないのに
 * 変化の追従の関数を呼ぶ形になり、どちらが正本かが読めなくなる。
 *
 * ## タブを増やさず、捨てもしない
 *
 * 保存先が**別のタブに既に開かれている**場合は、何もせずに元の状態を返す。
 *
 * 移してしまうと `relativePath` が同じタブが2枚並ぶ（`openTab` が守っている
 * 一意性が、別の入口から崩れる）。かといって相手のタブを閉じるのは、
 * そこに未保存の変更があれば**利用者が一度も選んでいないのに失う**ことになる。
 * 書き込み自体は既に済んでいるので、移さないことで失われるものは無い
 * ── 断ったことを利用者に伝えるのは呼び出し側（useEditorSession.ts）。
 *
 * **自分自身の位置へ移すのは移動ではない**（別名で保存で同じ場所を選んだ場合）。
 * 一意性は崩れないため、名前だけを揃えてそのまま返す。
 */
export function moveTabToPath(
  state: EditorTabsState,
  tabId: string,
  input: { readonly relativePath: string; readonly name: string }
): EditorTabsState {
  const target = state.tabs.find((tab) => tab.id === tabId)

  if (target === undefined) {
    return state
  }

  const occupant = findTabByPath(state, input.relativePath)

  if (occupant !== null && occupant.id !== tabId) {
    return state
  }

  if (target.relativePath === input.relativePath && target.name === input.name) {
    return state
  }

  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, relativePath: input.relativePath, name: input.name } : tab
    )
  }
}

/** その位置が、指定したタブ以外に開かれているか（移す前に確かめる）。 */
export function isPathOpenInOtherTab(
  state: EditorTabsState,
  tabId: string,
  relativePath: string
): boolean {
  const occupant = findTabByPath(state, relativePath)

  return occupant !== null && occupant.id !== tabId
}

/* -------------------------------------------- ディスク側の変化への追従 */

/**
 * Workspace のファイルが変わったことをタブへ反映する。
 *
 * `files:changed`（Main → Renderer のイベント）を受けて呼ぶ。**Files パネルの操作と
 * 直接つながない。**変化の理由（利用者の操作 / 将来のファイル監視）が増えても、
 * 追従の仕方をここ1箇所で決められるようにするため。
 *
 * | 変化                       | タブの扱い                                     |
 * | -------------------------- | ---------------------------------------------- |
 * | 開いているファイルの改名   | 位置と名前を差し替える（開き直しにしない）     |
 * | 開いているフォルダの改名   | 配下のタブの位置を読み替える                   |
 * | 開いているファイルの削除   | 未保存でなければ閉じる。未保存なら残す         |
 * | 開いているフォルダの削除   | 配下のタブに同じ判断をする                     |
 * | 作成                       | 何もしない                                     |
 * | 中身の変更（modified）     | 何もしない（追従するのは Model を持つ層）      |
 *
 * ## 未保存のタブは消えても閉じない
 *
 * 保存されていない内容は**このタブの中にしか無い**。ファイルが消えたからといって
 * 閉じてしまうと、利用者が一度も選んでいないのに編集が失われる。
 * そのため未保存のタブは残し、`deleted` として「ディスク上から消えた」ことを
 * 表示する（editorTabState.ts）。閉じるかどうかは利用者が選ぶ。
 *
 * 未保存でないタブは従来どおり閉じる。残しても中身はディスクにあったものと同じで、
 * 「開いているのに何も無い」タブが増えるだけになるため。
 *
 * `modified` を無視するのは、中身を持っているのがタブではなく Monaco の Model
 * （monaco/documentStore.ts）だから。ここで扱うと同じ判断が2箇所に分かれる。
 */
export function applyFileChanges(
  state: EditorTabsState,
  changes: readonly WorkspaceFileChange[]
): EditorTabsState {
  let next = state

  for (const change of changes) {
    if (change.kind === 'created' || change.kind === 'modified') {
      continue
    }

    if (change.kind === 'deleted') {
      for (const tab of next.tabs) {
        if (!isAtOrUnder(change.relativePath, tab.relativePath)) {
          continue
        }

        next = hasUnsavedChanges(tab.state)
          ? setTabStateByPath(next, tab.relativePath, 'deleted')
          : closeTab(next, tab.id)
      }

      continue
    }

    let moved = false

    const tabs = next.tabs.map((tab) => {
      const rebased = rebaseRelativePath(
        tab.relativePath,
        change.fromRelativePath,
        change.toRelativePath
      )

      if (rebased === null) {
        return tab
      }

      moved = true

      return {
        ...tab,
        relativePath: rebased,
        // 名前が変わるのは改名された当人だけ。配下のタブは位置だけ動く。
        name: splitRelativePath(rebased)?.name ?? tab.name
      }
    })

    // 関係するタブが1枚も無ければ、元のオブジェクトをそのまま返す
    // （layout/ の操作関数と同じ約束。無駄な再描画を作らない）。
    if (moved) {
      next = { ...next, tabs }
    }
  }

  return next
}
