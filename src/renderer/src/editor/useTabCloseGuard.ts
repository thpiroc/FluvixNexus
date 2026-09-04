import { useCallback, useRef, useState } from 'react'
import type { EditorController } from './useEditorSession'
import { hasUnsavedChanges } from './editorTabState'
import type { EditorTab } from './editorTabsModel'

/**
 * 未保存のタブを閉じるときの確認。
 *
 * ## Workspace / アプリを閉じるときの確認とは別にする
 *
 * どちらも「未保存を失う前に尋ねる」だが、**利用者が答える単位が違う**。
 *
 *   タブ1枚      … このファイルを保存するか
 *   Workspace / 終了 … 複数のファイルをまとめてどうするか（unsaved/）
 *
 * 1枚のときに一覧を出すと大げさで、複数のときに1枚ずつ尋ねると押し続けることになる。
 * 選択肢の意味（Save / Don't Save / Cancel）は同じなので、
 * 文言と器だけを分け、判断（保存できたときだけ閉じる）は同じ形にしてある。
 *
 * ## 保存できなければ閉じない
 *
 * Save を選んだのに Conflict や書き込みの失敗で保存されなかった場合、
 * **閉じない**。閉じてしまうと「保存を選んだのに失われた」になる。
 * Conflict のときはタブに Reload / Compare / Overwrite が出ているので、
 * 確認を閉じてそちらへ戻れば選び直せる。
 */

/** 確認が出ている対象。 */
/**
 * 保存を選んだのに閉じられなかった理由。
 *
 * `conflict` は「どちらを採るか決まっていない」だけで、利用者が
 * Reload / Compare / 上書き を選べる場所へ戻せる。`failed` はそれ以外。
 */
export type TabCloseFailure = 'conflict' | 'failed'

export interface TabCloseRequest {
  readonly tab: EditorTab
  /** 保存できる見込みが無いか（ディスクから消えている）。 */
  readonly unsavable: boolean
}

export interface TabCloseGuard {
  /** 今出ている確認。無ければ null。 */
  readonly request: TabCloseRequest | null
  /** 保存中か（ボタンを押せなくする）。 */
  readonly busy: boolean
  /** 保存できなかった理由。 */
  /**
   * 保存できずに閉じられなかったときの結末（翻訳前）。
   *
   * 文言ではなく**どちらの結末か**を持つ。文言にすると、確認を出したまま
   * 言語を切り替えたときに前の言語のまま取り残される（TabCloseConfirm.tsx）。
   */
  readonly error: TabCloseFailure | null
  /** 閉じる操作の入口。未保存なら確認を出し、そうでなければそのまま閉じる。 */
  readonly requestClose: (tabId: string) => void
  /** 保存してから閉じる。 */
  readonly save: () => void
  /** 保存せずに閉じる。 */
  readonly discard: () => void
  /** 閉じるのをやめる。 */
  readonly cancel: () => void
}

export function useTabCloseGuard(controller: EditorController): TabCloseGuard {
  const [request, setRequest] = useState<TabCloseRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TabCloseFailure | null>(null)

  const { tabs, close, saveFile } = controller

  /*
    確認中の対象を ref にも控える。保存の完了は React の描画とは別の時間軸で
    届くため、そこから読むのは state ではなく ref
    （useEditorSession.ts が tabs を控えているのと同じ理由）。
  */
  const requestRef = useRef<TabCloseRequest | null>(null)
  requestRef.current = request

  const requestClose = useCallback(
    (tabId: string): void => {
      const tab = tabs.find((candidate) => candidate.id === tabId)

      if (tab === undefined) {
        return
      }

      // 失われるものが無ければ尋ねない（確認を出すこと自体が目的ではない）。
      if (!hasUnsavedChanges(tab.state)) {
        close(tabId)
        return
      }

      setError(null)
      setBusy(false)
      setRequest({ tab, unsavable: tab.state === 'deleted' })
    },
    [tabs, close]
  )

  const finish = useCallback((): void => {
    setRequest(null)
    setBusy(false)
    setError(null)
  }, [])

  const discard = useCallback((): void => {
    const target = requestRef.current

    if (target !== null) {
      close(target.tab.id)
    }

    finish()
  }, [close, finish])

  const save = useCallback((): void => {
    const target = requestRef.current

    if (target === null) {
      return
    }

    setBusy(true)
    setError(null)

    void saveFile(target.tab.relativePath).then((outcome) => {
      if (outcome === 'saved') {
        close(target.tab.id)
        finish()
        return
      }

      /*
        保存できなかった。閉じずに理由を出す。
        Conflict は「どちらを採るか決まっていない」だけなので、
        利用者が Reload / Compare / Overwrite を選べる場所へ戻せるようにする。
      */
      setBusy(false)
      setError(outcome === 'conflict' ? 'conflict' : 'failed')
    })
  }, [close, finish, saveFile])

  return { request, busy, error, requestClose, save, discard, cancel: finish }
}
