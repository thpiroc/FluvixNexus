import { useEffect, useRef } from 'react'
import { fluvix } from '../api/fluvix'

/**
 * 「ウィンドウを閉じてよいか」の問い合わせに答える。
 *
 * Main 側の仕掛けと分担は main/windows/closeGuard.ts と
 * shared/ipc/contracts/window.ts。Renderer 側で守ることは3つ。
 *
 * - **必ず返事をする。** Main は close を止めた状態で待っている。
 *   返さなければ上限を過ぎたところで閉じられ、確認の意味が無くなる。
 * - **先に「受け取った」と返す。** 上限は「利用者が選ぶ時間」ではなく
 *   「Renderer が受け取るまで」の時間なので、尋ねる前に `'deciding'` を返して外す。
 * - **同じ確認を二重に出さない。** 利用者が × を連打すると同じ requestId の
 *   イベントが繰り返し届く（取りこぼした Renderer が追いつけるようにしてある）。
 *   処理中の id と同じなら黙って捨てる。
 *
 * ここが決めるのは「返事の仕方」だけで、**閉じてよいかの判断はしない**
 * （渡された `decide` に任せる）。ダイアログを出すのは
 * UnsavedChangesProvider の仕事で、この hook はその入口を IPC につなぐだけ。
 */
export function useWindowCloseRequest(decide: () => Promise<boolean>): void {
  const decideRef = useRef(decide)
  decideRef.current = decide

  useEffect(() => {
    /** 今答えている最中の確認。同じものが再度届いても二重に出さないため。 */
    let handling: string | null = null

    return fluvix.window.onCloseRequested(({ requestId }) => {
      if (handling === requestId) {
        return
      }

      handling = requestId

      void (async () => {
        // 受け取った。ここから先は利用者が選ぶ時間なので、Main 側の上限を外してもらう。
        await fluvix.window.respondClose({ requestId, decision: 'deciding' })

        let allow = true

        try {
          allow = await decideRef.current()
        } catch (cause) {
          /*
            確認の途中で落ちた場合は閉じない。
            「閉じてよいか分からない」を「閉じてよい」に倒すと、
            この経路が守ろうとしているものを失う（Main 側には上限があるので、
            ここで止め続けても閉じられなくなることはない）。
          */
          console.error('[window] 未保存の確認に失敗しました。', cause)
          allow = false
        }

        handling = null

        await fluvix.window.respondClose({
          requestId,
          decision: allow ? 'allow' : 'cancel'
        })
      })()
    })
  }, [])
}
