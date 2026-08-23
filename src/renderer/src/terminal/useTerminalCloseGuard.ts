import { useCallback, useRef, useState } from 'react'
import type { TerminalTab } from './terminalTabsModel'
import type { TerminalTabsController } from './useTerminalTabs'

/**
 * 実行中のタブを閉じるときの確認（Session 3-7-4）。
 *
 * ## アプリを終了するときの確認とは別にする
 *
 * どちらも「失われる前に尋ねる」だが、**利用者が答える単位が違う**
 * （editor/useTabCloseGuard.ts と unsaved/ の関係と同じ）。
 *
 *   タブ1枚 … このターミナルを終わらせるか
 *   終了     … 動いているものをまとめてどうするか（unsaved/）
 *
 * 1枚のときに一覧を出すのは大げさで、複数のときに1枚ずつ尋ねると押し続けることになる。
 * 選択肢の意味（続ける / やめる）と見た目は揃えてある（`unsaved.css` を共有）。
 *
 * ## 尋ねるのは「実行中のとき」だけ
 *
 * プロンプトで待っているだけのシェルを閉じても失われるものが無い。
 * そこは Main に聞いて決める（main/terminal/childProcesses.ts）ため、
 * × を押してから閉じるまでに**一往復ぶんの間が空く**（実測 0.4 秒ほど）。
 * その間は次の要求を受け付けない ── 連打すると同じタブへ確認が2回並ぶ。
 *
 * 聞けなかった場合は「動いているかもしれない」として尋ねる側に倒れる
 * （useTerminalTabs.ts の listBusyTabs）。
 *
 * ## 立っていないタブは、聞かずに閉じる
 *
 * 終わった（`exited`）・失敗した（`failed`）・まだ立てていない（`idle`）タブは
 * OS のプロセスを持たない。持っていないものについて OS に聞くと、
 * **閉じるのが遅くなるだけで何も守れない。**
 */

export interface TerminalCloseGuard {
  /** 今出ている確認の対象。無ければ null。 */
  readonly target: TerminalTab | null
  /**
   * 実行中かどうかを Main に聞いている最中のタブ。無ければ null。
   *
   * 押しても何も起きない時間（一往復ぶん）ができるので、その間は
   * そのタブの × を押せない見た目にする（TerminalTabs.tsx）。
   */
  readonly checkingTabId: string | null
  /** 閉じる操作の入口。実行中なら確認を出し、そうでなければそのまま閉じる。 */
  readonly requestClose: (terminalId: string) => void
  /** 実行中でも構わず閉じる。 */
  readonly confirm: () => void
  /** 閉じるのをやめる。 */
  readonly cancel: () => void
}

export function useTerminalCloseGuard(controller: TerminalTabsController): TerminalCloseGuard {
  const [target, setTarget] = useState<TerminalTab | null>(null)
  const [checkingTabId, setCheckingTabId] = useState<string | null>(null)

  /*
    問い合わせの結果は React の描画とは別の時間軸で届く。そこから読むのは
    state ではなく ref にあたる（editor/useTabCloseGuard.ts と同じ理由）。
    controller も同じで、聞いている間にタブが増減しうる。
  */
  const controllerRef = useRef(controller)
  controllerRef.current = controller

  /** 確認を出している / 聞いている最中か。連打で二重に進めないための歯止め。 */
  const pendingRef = useRef(false)

  const finish = useCallback((): void => {
    pendingRef.current = false
    setTarget(null)
    setCheckingTabId(null)
  }, [])

  const requestClose = useCallback(
    (terminalId: string): void => {
      if (pendingRef.current) {
        return
      }

      const { tabs, closeTab, listBusyTabs } = controllerRef.current
      const tab = tabs.find((candidate) => candidate.id === terminalId)

      if (tab === undefined) {
        return
      }

      // 立っていないタブは OS のプロセスを持たない（このファイルの冒頭）。
      if (tab.status !== 'running' && tab.status !== 'starting') {
        closeTab(terminalId)
        return
      }

      pendingRef.current = true
      setCheckingTabId(terminalId)

      void listBusyTabs()
        .then((busy) => {
          setCheckingTabId(null)

          // 聞いている間に閉じられた / 終わった。もう尋ねる相手が居ない。
          const current = controllerRef.current.tabs.find(
            (candidate) => candidate.id === terminalId
          )

          if (current === undefined) {
            pendingRef.current = false
            return
          }

          if (!busy.some((candidate) => candidate.id === terminalId)) {
            // 何も実行していない。失われるものが無いので尋ねない。
            pendingRef.current = false
            controllerRef.current.closeTab(terminalId)
            return
          }

          setTarget(current)
        })
        .catch((cause: unknown) => {
          /*
            確かめられなかった。**閉じない側へ倒す** ── 「分からない」を
            「閉じてよい」に倒すと、この経路が守ろうとしているものを失う
            （unsaved/useWindowCloseRequest.ts と同じ判断）。
          */
          console.error('[terminal] 実行中かどうかを確かめられませんでした。', cause)
          finish()
        })
    },
    [finish]
  )

  const confirm = useCallback((): void => {
    const tab = target

    finish()

    if (tab !== null) {
      controllerRef.current.closeTab(tab.id)
    }
  }, [target, finish])

  return { target, checkingTabId, requestClose, confirm, cancel: finish }
}
