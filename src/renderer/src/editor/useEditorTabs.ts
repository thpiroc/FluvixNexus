import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReadWorkspaceFileResponse } from '@shared/ipc'
import { fluvix } from '../api/fluvix'
import { toFileTreeErrorReason } from '../files/filesError'
import type { EditorRevealRequest } from './editorReveal'
import type { EditorTabState } from './editorTabState'
import {
  activateTab,
  applyFileChanges,
  closeTab,
  findActiveTab,
  isPathOpenInOtherTab,
  listUnsavedTabs,
  moveTabToPath,
  openTab,
  setTabStateByPath,
  setTabDocument,
  EMPTY_EDITOR_TABS,
  type EditorDocument,
  type EditorTab,
  type EditorTabsState
} from './editorTabsModel'

/**
 * Editor のタブ状態を持ち、開かれたファイルの中身を Main へ取りに行く。
 *
 * 判断そのものは editorTabsModel.ts の純粋関数が持ち、ここが決めるのは
 * **いつ読むか**と**届いた応答を受け入れてよいか**だけ（files/useFileTree.ts と同じ分担）。
 *
 * ## Workspace が変わったら捨てる
 *
 * Files パネルは `key` にワークスペース id を渡してツリーごと React に破棄させている
 * （ARCHITECTURE.md §9.6）が、Editor では同じ手が使えない。タブの持ち主が
 * Workspace Shell の外側（Provider）にあり、`key` を付け替えると **Shell ごと
 * 作り直され、レイアウトの状態まで消える**ため。
 *
 * そこで、描画中に「前回見た Workspace」と食い違っていたら state を初期化する
 * （React の "前回の props と比べて state を調整する" 形）。effect で消すと、
 * 1フレームだけ前の Workspace のタブが見えてから消える。
 *
 * ## 行き違った応答は捨てる
 *
 * 応答には workspaceId が入っている。要求を出した後・届く前に Workspace が
 * 切り替わると中身は新しい Workspace のものになるため、突き合わせて違えば捨てる。
 * 加えてタブ単位の要求番号も持つ（同じタブを閉じて開き直した場合に、
 * 古い応答が新しいタブへ入らないようにするため）。
 */

export interface EditorTabsController {
  readonly tabs: readonly EditorTab[]
  readonly activeTabId: string | null
  readonly activeTab: EditorTab | null
  /** 閉じると内容が失われるタブ（未保存 / Conflict / 削除済み）。 */
  readonly unsavedTabs: readonly EditorTab[]
  /** ファイルを開く。既に開いていればそのタブを手前に出すだけ。 */
  readonly openFile: (input: { relativePath: string; name: string }) => void
  /**
   * ファイルを開き、その位置を見せる（全文検索の結果を押したとき。Session 3-6-5）。
   *
   * **`openFile` と別の入口にしていない。** 中で呼んでいるのは同じ `openTab` で、
   * 足しているのは「開いた後にここを見せてほしい」という依頼だけになる
   * （editorReveal.ts）。開く経路を分けると、タブの重複の扱い・未保存の確認が
   * 経路ごとに分かれる ── 検索結果から開いたときだけタブが2枚になる、が起きる。
   */
  readonly openFileAt: (input: {
    relativePath: string
    name: string
    line: number
    column: number
    length?: number
  }) => void
  /** まだ見せていない位置の依頼（無ければ null）。 */
  readonly pendingReveal: EditorRevealRequest | null
  /** 位置を見せ終えたことを伝える（依頼は1回きり）。 */
  readonly consumeReveal: () => void
  readonly activate: (tabId: string) => void
  readonly close: (tabId: string) => void
  /** 開けなかったタブの読み直し。 */
  readonly reload: (tabId: string) => void
  /**
   * タブの状態（未保存 / Conflict / 削除済み）を差し替える。
   *
   * 呼ぶのは Monaco の Model を持つ層（monaco/documentStore.ts）で、
   * 鍵がタブ id ではなく relativePath なのはそのため（editorTabsModel.ts）。
   */
  readonly setTabState: (relativePath: string, state: EditorTabState) => void
  /**
   * 開いているファイルの位置を差し替える（別名で保存。Session 4-2）。
   *
   * 開き直しにはしない（同じタブが、別のファイルを指すようになる）。
   * 保存先が別のタブに開かれている場合は何もしない（editorTabsModel.moveTabToPath）。
   */
  readonly moveTab: (tabId: string, input: { relativePath: string; name: string }) => void
  /** その位置が、指定したタブ以外に開かれているか（移す前の確認）。 */
  readonly isPathOpenElsewhere: (tabId: string, relativePath: string) => boolean
  /** 中身の差し替え（別名で保存の後、そのタブが指す中身を保存したものへ揃える）。 */
  readonly setDocument: (tabId: string, document: EditorDocument) => void
}

/** 応答の status を、タブが持つ中身の状態へ落とす。 */
function toDocument(data: ReadWorkspaceFileResponse): EditorDocument {
  switch (data.status) {
    case 'ok':
      return {
        status: 'ready',
        // 契約上 'ok' なら必ず入るが、境界を越えてきた値として素直に信じない。
        content: data.content ?? '',
        byteLength: data.byteLength,
        lineEnding: data.lineEnding ?? 'lf',
        // 分からなければ BOM 無し（＝足さない）側へ倒れる。
        encoding: data.encoding ?? 'utf8',
        // 版が無ければ「確かめずに上書きする」側へ倒れる（従来と同じ振る舞い）。
        revision: data.revision ?? null
      }

    case 'binary':
      return { status: 'binary', byteLength: data.byteLength }

    case 'too-large':
      return { status: 'too-large', byteLength: data.byteLength }
  }
}

export function useEditorTabs(workspaceId: string | null): EditorTabsController {
  const [state, setState] = useState<EditorTabsState>(EMPTY_EDITOR_TABS)
  const [seenWorkspaceId, setSeenWorkspaceId] = useState<string | null>(workspaceId)
  /** 「開いた後にここを見せてほしい」という依頼（editorReveal.ts）。 */
  const [pendingReveal, setPendingReveal] = useState<EditorRevealRequest | null>(null)
  /** 依頼ごとの通し番号。同じ位置を続けて押しても別の依頼として扱うために持つ。 */
  const revealSeqRef = useRef(0)
  /** 応答が届いた時点で依頼が生きているかを見るための控え（描画とは別の時間軸）。 */
  const pendingRevealRef = useRef<EditorRevealRequest | null>(null)

  pendingRevealRef.current = pendingReveal

  /** タブごとの「今有効な要求」。閉じて開き直した場合に古い応答を弾く。 */
  const requestSeqRef = useRef(0)
  const activeRequestsRef = useRef(new Map<string, number>())
  const mountedRef = useRef(true)

  // Workspace が切り替わったら、前の Workspace のタブは残さない（上のコメント）。
  if (seenWorkspaceId !== workspaceId) {
    setSeenWorkspaceId(workspaceId)
    setState(EMPTY_EDITOR_TABS)

    /*
      要求の控えも一緒に捨てる。

      タブ id は Workspace ごとに 1 から振り直される（state を初期状態へ戻すため）。
      控えを残すと、新しい Workspace で作られた `tab-1` が
      **前の Workspace の `tab-1` の要求が飛んでいる**と判断され、
      下の effect が読み込みを始めない ── タブは出るが中身が永遠に
      「読み込み中」のまま止まる。
    */
    activeRequestsRef.current.clear()

    // 前の Workspace のファイルに対する依頼も一緒に捨てる。
    setPendingReveal(null)
  }

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * 見せられない中身だった場合、位置の依頼を捨てる。
   *
   * バイナリ・大きすぎる・読めなかったファイルは Monaco に載らない
   * （EditorDocumentView.tsx）ため、依頼を受け取る相手が現れない。
   * 残しておくと、後でパネルが作り直された拍子に飛ぶ ── 一度きりの依頼が
   * 一度きりでなくなる。
   */
  const dropRevealFor = useCallback((relativePath: string): void => {
    if (pendingRevealRef.current?.relativePath === relativePath) {
      setPendingReveal(null)
    }
  }, [])

  const load = useCallback(
    async (tabId: string, relativePath: string): Promise<void> => {
      requestSeqRef.current += 1
      const request = requestSeqRef.current
      activeRequestsRef.current.set(tabId, request)

      const result = await fluvix.files.readFile({ relativePath })

      if (!mountedRef.current || activeRequestsRef.current.get(tabId) !== request) {
        return
      }

      if (!result.ok) {
        dropRevealFor(relativePath)
        setState((previous) =>
          setTabDocument(previous, tabId, {
            status: 'error',
            reason: toFileTreeErrorReason(result.error.code)
          })
        )
        return
      }

      // 要求と応答の間に Workspace が切り替わっていたら、今のタブへ混ぜない。
      if (result.data.workspaceId !== workspaceId) {
        return
      }

      const document = toDocument(result.data)

      if (document.status !== 'ready') {
        dropRevealFor(relativePath)
      }

      setState((previous) => setTabDocument(previous, tabId, document))
    },
    [workspaceId, dropRevealFor]
  )

  /*
    読み込み中のまま、まだ要求を出していないタブを読む。

    「開く」操作と読み込みを直接つながず、状態から導いている
    （files/useFileTree.ts の「展開されているのに中身を知らないフォルダを読む」と同じ形）。
    この形にすると、
      - 開く入口が増えても読み込みの経路は1本のまま
      - 読み直しは「読み込み中に戻す」だけで済む
      - 状態の更新関数の中で IPC を始めずに済む（更新関数は純粋に保つ）
    となる。
  */
  useEffect(() => {
    for (const tab of state.tabs) {
      if (tab.document.status === 'loading' && !activeRequestsRef.current.has(tab.id)) {
        void load(tab.id, tab.relativePath)
      }
    }
  }, [state.tabs, load])

  const openFile = useCallback((input: { relativePath: string; name: string }): void => {
    setState((previous) => openTab(previous, input))
  }, [])

  /*
    開く経路は `openFile` と同じ（`openTab` は同じ位置のタブを2枚作らない）。
    ここが足しているのは、開いた後に見せる位置の依頼だけになる。
  */
  const openFileAt = useCallback(
    (input: {
      relativePath: string
      name: string
      line: number
      column: number
      length?: number
    }): void => {
      setState((previous) =>
        openTab(previous, { relativePath: input.relativePath, name: input.name })
      )

      revealSeqRef.current += 1

      setPendingReveal({
        relativePath: input.relativePath,
        line: input.line,
        column: input.column,
        length: input.length ?? 0,
        token: revealSeqRef.current
      })
    },
    []
  )

  const consumeReveal = useCallback((): void => {
    setPendingReveal(null)
  }, [])

  const activate = useCallback((tabId: string): void => {
    setState((previous) => activateTab(previous, tabId))
  }, [])

  const close = useCallback((tabId: string): void => {
    // 飛んでいる途中の応答が、閉じた後に届いても入らないようにする。
    activeRequestsRef.current.delete(tabId)
    setState((previous) => closeTab(previous, tabId))
  }, [])

  const reload = useCallback((tabId: string): void => {
    // 要求の控えを消してから読み込み中に戻すと、上の effect が読み直す。
    activeRequestsRef.current.delete(tabId)
    setState((previous) => setTabDocument(previous, tabId, { status: 'loading' }))
  }, [])

  const setTabState = useCallback((relativePath: string, tabState: EditorTabState): void => {
    setState((previous) => setTabStateByPath(previous, relativePath, tabState))
  }, [])

  const moveTab = useCallback(
    (tabId: string, input: { relativePath: string; name: string }): void => {
      setState((previous) => moveTabToPath(previous, tabId, input))
    },
    []
  )

  /*
    移す前の確認は state ではなく ref から読む。呼ぶのは IPC の応答が届いた後
    （＝描画とは別の時間軸）で、そこから見た「今」が要るため。
  */
  const stateRef = useRef(state)
  stateRef.current = state

  const isPathOpenElsewhere = useCallback((tabId: string, relativePath: string): boolean => {
    return isPathOpenInOtherTab(stateRef.current, tabId, relativePath)
  }, [])

  const setDocument = useCallback((tabId: string, document: EditorDocument): void => {
    setState((previous) => setTabDocument(previous, tabId, document))
  }, [])

  /*
    ディスク側の変化への追従（Main → Renderer のイベント）。

    Files パネルの操作と直接つないでいないのが要点。Files が Editor を知る必要が無く、
    後続のファイル変更監視も同じ経路に乗る（shared/files/change.ts）。
  */
  useEffect(() => {
    if (workspaceId === null) {
      return
    }

    return fluvix.files.onChanged((event) => {
      if (event.workspaceId !== workspaceId) {
        return
      }

      setState((previous) => applyFileChanges(previous, event.changes))
    })
  }, [workspaceId])

  /*
    導出だが、**参照が毎回変わらないようにする**。

    この配列は EditorController に載って Context で配られる（editor/context.ts）。
    描画のたびに新しい配列を作ると Context の値が毎回変わり、
    タブを1文字も触っていないのに全パネルが再描画される。
    state が変わらない限り同じ配列を返す形にしておけば、それが起きない。
  */
  const unsavedTabs = useMemo(() => listUnsavedTabs(state), [state])

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab: findActiveTab(state),
    unsavedTabs,
    openFile,
    openFileAt,
    pendingReveal,
    consumeReveal,
    activate,
    close,
    reload,
    setTabState,
    moveTab,
    isPathOpenElsewhere,
    setDocument
  }
}
