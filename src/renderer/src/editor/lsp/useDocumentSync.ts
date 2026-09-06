import { useEffect, useRef } from 'react'
import { fluvix } from '../../api/fluvix'
import type {
  EditorDocumentSnapshot,
  EditorDocumentStore,
  EditorDocumentSyncEvent
} from '../monaco/documentStore'

/**
 * Monaco の Model の生き死にを、Main へ運ぶ（Session 5-2）。
 *
 * ```
 * documentStore.onDocumentSync   opened / changed / saved / closed
 *    ↓
 * ここ                            送るかどうかを決め、IPC を呼ぶ
 *    ↓  relativePath + 版 + 中身 / 差分
 * window.fluvix.lsp              Preload の薄いラッパ
 *    ↓  IPC（lsp:did-open ほか）
 * main/ipc/handlers/lsp.ts       境界を確かめる
 *    ↓
 * main/lsp/documentSync.ts       行き先を決め、サーバを立て、電文にする
 * ```
 *
 * 渡すのは相対位置と中身だけで、絶対パスも URI も、どのサーバへ送るかも出てこない
 * （保存の経路と同じ線。ARCHITECTURE.md §9.3）。
 *
 * ## 状態を3つに分ける
 *
 * ```
 * pending   … didOpen を送ったが、まだ返事が来ていない
 * tracked   … Language Server が見ている
 * untracked … 見ていない（`.md` / `.txt`、あるいはサーバが入っていない）
 * ```
 *
 * `changed` / `saved` を送るのは **`untracked` でないとき**で、`pending` も送る。
 *
 * 返事を待ってから送る形にすると、**返事が来るまでの打鍵が落ちる**
 * ── 落ちた差分は二度と埋まらない（差分は1回きりで、順番に意味がある）。
 * 送ってしまってよいのは、IPC の到着順が保たれ、Main 側のハンドラが同期で
 * 書き出すため ── `didOpen` の後に出した `didChange` が先に処理されることはない
 * （main/ipc/handlers/lsp.ts）。
 *
 * `untracked` だけを止めるのは往復を減らすためで、境界のためではない。
 * 知らない文書への通知は Main が捨てる（main/lsp/documentSync.ts）。
 *
 * ## 開き直しを頼まれることがある
 *
 * サーバが立ち上がった / 落ちて立ち直った直後、Main は開いている文書の一覧を
 * 持っているが**中身を持たない**。頼まれたら、今開いている文書を送り直す
 * （shared/ipc/events/lsp.ts）。既に届いている文書は Main 側が捨てるので、
 * こちらは全部送ってよい。
 *
 * ## Workspace が変わったら、控えも捨てる
 *
 * 相対位置は Workspace の中でしか意味を持たない。控えを残すと、
 * **新しい Workspace の中の別のファイル**を同じ位置として扱うことになる
 * （documentStore.disposeAll と同じ理由）。Main 側の控えも切り替えで空になる。
 */

type DocumentSyncState = 'pending' | 'tracked' | 'untracked'

export function useDocumentSync(documents: EditorDocumentStore, workspaceId: string | null): void {
  /*
    描画には出さない（画面に出る情報を1つも持たない）ので state ではなく ref。
    書き換わるのは Monaco のコールバックと IPC の応答からで、
    どちらも React の描画とは別の時間軸で走る。
  */
  const statesRef = useRef(new Map<string, DocumentSyncState>())

  useEffect(() => {
    const states = statesRef.current

    if (workspaceId === null) {
      states.clear()
      return
    }

    function open(document: EditorDocumentSnapshot): void {
      states.set(document.relativePath, 'pending')

      void fluvix.lsp.didOpen(document).then((result) => {
        /*
          返事が来る前に閉じられている / 開き直されていることがある。
          **控えが消えていたら書き戻さない** ── 書き戻すと、閉じた文書が
          開いているものとして残る。
        */
        if (states.get(document.relativePath) !== 'pending') {
          return
        }

        states.set(
          document.relativePath,
          result.ok && result.data.tracked ? 'tracked' : 'untracked'
        )
      })
    }

    const unsubscribeStore = documents.onDocumentSync((event: EditorDocumentSyncEvent) => {
      switch (event.kind) {
        case 'opened':
          open(event)
          return

        case 'changed':
          if (states.get(event.relativePath) === 'untracked') {
            return
          }

          void fluvix.lsp.didChange({
            relativePath: event.relativePath,
            version: event.version,
            changes: event.changes
          })

          return

        case 'saved':
          if (states.get(event.relativePath) === 'untracked') {
            return
          }

          void fluvix.lsp.didSave({ relativePath: event.relativePath })

          return

        case 'closed': {
          const state = states.get(event.relativePath)

          states.delete(event.relativePath)

          /*
            開いていないことが分かっている文書は、閉じたことも伝えない。
            知らせても Main が捨てるだけで、往復だけが増える。
          */
          if (state === 'untracked') {
            return
          }

          void fluvix.lsp.didClose({ relativePath: event.relativePath })

          return
        }
      }
    })

    const unsubscribeResync = fluvix.lsp.onSyncRequested((payload) => {
      // 切り替えと行き違った依頼。前の Workspace の位置を送り直さない。
      if (payload.workspaceId !== workspaceId) {
        return
      }

      for (const document of documents.listOpenDocuments()) {
        open(document)
      }
    })

    return () => {
      unsubscribeStore()
      unsubscribeResync()

      /*
        控えだけを捨てる。**閉じたことは伝えない** ── この後始末が走るのは
        Workspace が変わったとき（あるいは Provider ごと消えるとき）で、
        Main 側の控えも同じ出来事で空になる（main/lsp/documentSync.ts）。
        ここから didClose を送っても、前の Workspace の相対位置は
        もう誰も持っていない。
      */
      states.clear()
    }
  }, [documents, workspaceId])
}
