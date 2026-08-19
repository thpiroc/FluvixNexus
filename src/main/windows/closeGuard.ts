import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { IPC_EVENT_CHANNELS, type WindowCloseDecision } from '@shared/ipc'
import { createLogger } from '../logger'

/**
 * ウィンドウを閉じる前に、Renderer へ未保存の確認を任せる仕組み。
 *
 * ## 責務を崩さずに割り込む
 *
 * 「閉じるか」を決めるのは Main、「未保存があるか」を知っているのは Renderer
 * （ARCHITECTURE.md §1）。どちらかに寄せずに済ませるため、
 * **閉じる操作は Main が握ったまま、判断だけを尋ねる**形にしてある。
 *
 * ```
 * × / Alt+F4 / app.quit()
 *    ↓  'close'
 * ここ            preventDefault して window:close-requested を送る
 *    ↓
 * Renderer        'deciding' を返してから利用者に尋ねる
 *    ↓  window:respond-close（ipc/handlers/window.ts）
 * ここ            'allow' なら「もう尋ねない」印を付けて改めて close()
 * ```
 *
 * 終了（`app.quit()`）も各ウィンドウの 'close' を通るため、
 * **同じ1本の経路でウィンドウの × とアプリ終了の両方を捕まえられる。**
 * close を止めれば終了そのものも取り消される（Electron の作法）ので、
 * 「終了処理と保存確認が別々に走って競合する」状態にならない。
 *
 * ## 閉じられなくならないこと
 *
 * Renderer が応答できない状態（読み込み前・スクリプトが止まっている・
 * クラッシュした）はありうる。**返事が来ないまま閉じられなくなる方が、
 * 未保存を1回取りこぼすより悪い**ため、次の3つで必ず出口を用意する。
 *
 *   1. 受け取ったという返事（`'deciding'`）が来るまでの時間に上限を置く
 *   2. Renderer が死んでいる / 死んだら、確認を挟まずに閉じる
 *   3. 尋ねている最中にもう一度閉じようとされたら、同じ確認を送り直す
 *      （イベントを取りこぼした Renderer が追いつけるように）
 *
 * 上限が「利用者が選ぶ時間」ではないのが要点。選んでいる最中に閉じてしまうと、
 * 確認を出した意味が無い（`'deciding'` を受け取った時点で上限は外す）。
 *
 * ## 保証できない場合
 *
 * OS のシャットダウン / サインアウト、タスクマネージャからの強制終了、
 * Renderer プロセスのクラッシュでは、この経路が走らない（走っても
 * OS が待たない）ことがある。完全な保証は原理的にできないため、
 * Auto Save（editor/autoSave.ts）を選べるようにしてある。
 */

const log = createLogger('close-guard')

/**
 * 受け取ったという返事を待つ上限（ミリ秒）。
 *
 * 利用者がダイアログを読んで選ぶ時間ではなく、**Renderer が確認を受け取るまで**の上限。
 * 受け取ったと言ってきたら（`'deciding'`）解除する。
 */
const ACKNOWLEDGE_TIMEOUT_MS = 4000

interface PendingClose {
  readonly requestId: string
  /** 受け取りを待つタイマー。`'deciding'` を受けたら null になる（＝待ち続ける）。 */
  timer: ReturnType<typeof setTimeout> | null
}

/** ウィンドウごとの「確認中」。独立ウィンドウ化しても1枚ずつ独立して扱える。 */
const pending = new Map<number, PendingClose>()

/** そのウィンドウは確認済みで、次の close をそのまま通してよいか。 */
const confirmed = new Set<number>()

function clearPending(windowId: number): void {
  const entry = pending.get(windowId)

  if (entry === undefined) {
    return
  }

  if (entry.timer !== null) {
    clearTimeout(entry.timer)
  }

  pending.delete(windowId)
}

/** 確認を諦めて閉じる。 */
function closeAnyway(window: BrowserWindow, reason: string): void {
  log.warn(`${reason}; closing without the unsaved-changes confirmation.`)
  clearPending(window.id)
  confirmed.add(window.id)

  if (!window.isDestroyed()) {
    window.close()
  }
}

/** Renderer が今のところ応答できる状態か。 */
function canRespond(window: BrowserWindow): boolean {
  return !window.webContents.isDestroyed() && !window.webContents.isCrashed()
}

/**
 * 閉じる要求に確認を挟む。
 *
 * BrowserWindow を作った直後に1度だけ呼ぶ（windows/mainWindow.ts）。
 */
export function guardWindowClose(window: BrowserWindow): void {
  const windowId = window.id

  window.on('close', (event) => {
    // 確認が済んでいる（＝ Renderer が allow を返した / 諦めた）なら通す。
    if (confirmed.has(windowId)) {
      return
    }

    // 尋ねられない相手には尋ねない。ここで止めると閉じられなくなる。
    if (!canRespond(window)) {
      confirmed.add(windowId)
      return
    }

    event.preventDefault()

    const existing = pending.get(windowId)

    if (existing !== undefined) {
      /*
        既に尋ねている最中。新しい確認を作らず、同じ requestId で送り直す。
        Renderer 側は同じ id の確認を二重に出さない（重複したイベントは無視する）ので、
        「利用者が × を連打したら確認が積み上がる」ことにはならない。
        イベントを取りこぼしていた場合だけ、ここで追いつける。
      */
      window.webContents.send(IPC_EVENT_CHANNELS.WINDOW_CLOSE_REQUESTED, {
        requestId: existing.requestId
      })
      return
    }

    const requestId = randomUUID()

    pending.set(windowId, {
      requestId,
      timer: setTimeout(() => {
        closeAnyway(window, 'the renderer did not acknowledge the close request')
      }, ACKNOWLEDGE_TIMEOUT_MS)
    })

    /*
      全ウィンドウへ配る共通の経路（ipc/events.ts）ではなく、このウィンドウへ送る。
      「閉じてよいか」は**そのウィンドウ宛ての問いかけ**であって、
      Workspace で起きた出来事の通知ではない（§3.3 の使い分け）。
    */
    window.webContents.send(IPC_EVENT_CHANNELS.WINDOW_CLOSE_REQUESTED, { requestId })
  })

  /*
    尋ねている最中に Renderer が死んだ場合の出口。
    これが無いと、返事の来ない確認が残ったままウィンドウが閉じられなくなる。
  */
  window.webContents.on('render-process-gone', () => {
    if (pending.has(windowId)) {
      closeAnyway(window, 'the renderer process is gone')
    }
  })

  window.on('closed', () => {
    clearPending(windowId)
    confirmed.delete(windowId)
  })
}

/**
 * 確認の返事を受け取る。
 *
 * `requestId` が今の確認と一致しない返事は捨てる。前回の確認への遅れた返事で
 * ウィンドウが閉じてしまわないようにするため（shared/ipc/contracts/window.ts）。
 */
export function resolveWindowClose(
  window: BrowserWindow,
  requestId: string,
  decision: WindowCloseDecision
): void {
  const windowId = window.id
  const entry = pending.get(windowId)

  if (entry === undefined || entry.requestId !== requestId) {
    return
  }

  if (decision === 'deciding') {
    // 受け取ったと言ってきた。ここから先は利用者が選ぶ時間なので、上限を外す。
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }

    return
  }

  clearPending(windowId)

  if (decision === 'cancel') {
    // 取り消し。閉じるのをやめた時点で、app.quit() による終了も取り消されている。
    return
  }

  confirmed.add(windowId)

  if (!window.isDestroyed()) {
    window.close()
  }
}
