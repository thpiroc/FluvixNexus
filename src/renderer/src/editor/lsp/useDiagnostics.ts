import { useEffect, useRef } from 'react'
import { fluvix } from '../../api/fluvix'
import type { EditorDocumentStore } from '../monaco/documentStore'
import { toEditorDiagnosticMarkers } from './diagnosticMarkers'
import { EditorDiagnosticStore } from './diagnosticStore'

/**
 * 届いた指摘を Monaco の marker にする（Session 5-3）。
 *
 * ```
 * main/lsp/diagnostics.ts
 *    ↓  lsp:diagnostics / lsp:diagnostics-cleared（相対位置 + 版 + 指摘）
 * window.fluvix.lsp        Preload の薄いラッパ
 *    ↓
 * ここ                      控えへ入れ、変わった位置だけ Model へ流す
 *    ↓
 * monaco/markers.ts        owner 'fluvix.lsp' として置く
 * ```
 *
 * 判断のうち**純粋なもの**は分けてある（このフックは噛み合わせだけを持つ）。
 *
 * ```
 * diagnosticMarkers.ts  0 起点 → 1 起点。範囲を整える
 * diagnosticStore.ts    今の状態・古い指摘の捨て方・描き直す位置
 * ```
 *
 * ## Monaco を静的に import しない
 *
 * このフックは **Editor パネルが開かれる前から生きている**（購読はアプリの起動と
 * 同時に張る）。`monaco/markers.ts` を素直に import すると、その時点で Monaco が
 * 読み込まれ、MonacoEditor.tsx を遅延させている意味が無くなる。
 *
 * そこで**使うときに読み込む**（動的 import）。指摘が届くのは文書を開いた後
 * ── そのとき Monaco は既に読み込まれているので、実際には待ちが発生しない。
 *
 * ## 届くたびに描かない
 *
 * プロジェクトを開いた直後、診断は何十通も連続して届く。1通ごとに
 * `setModelMarkers` を呼ぶと描画が詰まるため、**控えを先に更新して、
 * まとめて流す**（`queueMicrotask`）。流すときに読むのは控えの今の状態なので、
 * 間に何通届いても結果は変わらない ── 順序の心配が要らない形になる。
 *
 * ## 文書を閉じたら控えも外す
 *
 * Model を捨てた時点で marker も消えるが、**控えは残る**。残したままだと
 * 「その言語はサーバが見ている」と数え続け、Monaco 内蔵の指摘が止まったままになる。
 * documentStore の出来事（Session 5-2）をここでも聞いて外す。
 *
 * ## サーバが居ない / 落ちたら、内蔵の指摘へ戻す
 *
 * 控えが1つも無くなった言語は、内蔵の検査を戻す
 * （renderer/src/editor/monaco/monacoSetup.ts）。Language Server が入っていない
 * PC では控えが1つも作られないので、**何も起きない ＝ STEP 4 までと同じ**になる。
 */

/** 内蔵の検査と重なりうる言語（Monaco が構文を読むのはこの2つ）。 */
const BUILT_IN_LANGUAGE_IDS = ['typescript', 'javascript'] as const

export function useDiagnostics(documents: EditorDocumentStore, workspaceId: string | null): void {
  /*
    描画には出さない（画面に出る情報を1つも持たない）ので state ではなく ref。
    書き換わるのは IPC のイベントと Monaco のコールバックからで、
    どちらも React の描画とは別の時間軸で走る。
  */
  const storeRef = useRef<EditorDiagnosticStore | null>(null)

  if (storeRef.current === null) {
    storeRef.current = new EditorDiagnosticStore()
  }

  const store = storeRef.current

  useEffect(() => {
    if (workspaceId === null) {
      return
    }

    let disposed = false
    let flushScheduled = false

    /** Monaco へ触る層。使うときに初めて読み込む（上記）。 */
    let markersModule: Promise<typeof import('../monaco/markers')> | null = null

    function loadMarkers(): Promise<typeof import('../monaco/markers')> {
      markersModule ??= import('../monaco/markers')

      return markersModule
    }

    function scheduleFlush(): void {
      if (flushScheduled) {
        return
      }

      flushScheduled = true

      queueMicrotask(() => {
        flushScheduled = false
        void flush()
      })
    }

    async function flush(): Promise<void> {
      const paths = store.takeDirty()

      if (paths.length === 0) {
        return
      }

      const { applyLspMarkers, clearLspMarkers } = await loadMarkers()

      // 読み込んでいる間に Workspace が変わった。前の Workspace の Model は既に無い。
      if (disposed) {
        return
      }

      for (const relativePath of paths) {
        const model = documents.getModel(relativePath)

        /*
          Model が無いことはある（控えが届く前に閉じた・開き直しの途中）。
          marker の置き場所が無いだけで、控えはそのまま残してよい。
        */
        if (model === null) {
          continue
        }

        const markers = store.get(relativePath)

        if (markers === null) {
          clearLspMarkers(model)
        } else {
          applyLspMarkers(model, markers)
        }
      }

      await applyBuiltInValidation()
    }

    /**
     * 内蔵の検査を、控えの有無に合わせる。
     *
     * TypeScript と JavaScript は Monaco の中で**同じサービス**が見ているため、
     * どちらか一方でもサーバが答えていれば両方を止める
     * （monacoSetup.ts は2つをまとめて切り替える）。
     */
    async function applyBuiltInValidation(): Promise<void> {
      const served = BUILT_IN_LANGUAGE_IDS.some((languageId) => store.isServedByLsp(languageId))
      const { setBuiltInValidationSuppressed } = await import('../monaco/monacoSetup')

      if (!disposed) {
        setBuiltInValidationSuppressed(served)
      }
    }

    const unsubscribeDiagnostics = fluvix.lsp.onDiagnostics((event) => {
      // 切り替えと行き違った通知。前の Workspace の位置に marker を置かない。
      if (event.workspaceId !== workspaceId) {
        return
      }

      if (
        store.set(event.relativePath, event.version, toEditorDiagnosticMarkers(event.diagnostics))
      ) {
        scheduleFlush()
      }
    })

    const unsubscribeCleared = fluvix.lsp.onDiagnosticsCleared((event) => {
      if (event.workspaceId !== workspaceId) {
        return
      }

      // 空なら「今持っているものすべて」（shared/ipc/events/lsp.ts）。
      if (event.relativePaths.length === 0) {
        store.clearAll()
        scheduleFlush()

        return
      }

      let changed = false

      for (const relativePath of event.relativePaths) {
        changed = store.clear(relativePath) || changed
      }

      if (changed) {
        scheduleFlush()
      }
    })

    /*
      文書を閉じたら控えも外す（上記）。開き直し（改名）は closed → opened で
      届くので、古い位置の控えはここで外れ、新しい位置は次の指摘で作られる。
    */
    const unsubscribeStore = documents.onDocumentSync((syncEvent) => {
      if (syncEvent.kind === 'closed' && store.clear(syncEvent.relativePath)) {
        scheduleFlush()
      }
    })

    return () => {
      disposed = true

      unsubscribeDiagnostics()
      unsubscribeCleared()
      unsubscribeStore()

      /*
        控えを空にし、内蔵の検査を戻す。**marker は外さない** ── この後始末が
        走るのは Workspace が変わったときで、Model はもう捨てられている
        （renderer/src/editor/useEditorSession.ts）。
      */
      store.clearAll()
      store.takeDirty()

      void import('../monaco/monacoSetup').then(({ setBuiltInValidationSuppressed }) => {
        setBuiltInValidationSuppressed(false)
      })
    }
  }, [documents, store, workspaceId])
}
