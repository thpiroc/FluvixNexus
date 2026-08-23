import { useCallback, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { UnsavedChangesContext, type UnsavedChangesController } from './context'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import type { LossAction, LossChoice, LossItem, LossSource } from './types'
import { useWindowCloseRequest } from './useWindowCloseRequest'

/**
 * 失われるものがある操作に、確認を1本で挟む器。
 *
 * 経緯と分担は types.ts の冒頭。ここが持つのは
 *   - 失われるものを持っている側の申告（registerSource）
 *   - 確認を出して結果を返すこと（confirmDiscard）
 *   - ウィンドウを閉じる要求の受け口（useWindowCloseRequest）
 * の3つだけで、**何が失われるかは知らない**（申告された側に聞く）。
 *
 * ## 一度に1つだけ
 *
 * 確認が出ている間は次の確認を受け付けず、その場で「続けない」を返す。
 * 確認が積み上がると、利用者が1回選んだつもりで2回進むことになる。
 *
 * 「出ている間」には**尋ねる相手に聞いている間**も含まれる（Session 3-7-4）。
 * Terminal への問い合わせは OS を経由するため即座には返らず、その隙に
 * 2つ目の確認が始まると、ダイアログが1枚しか出ないまま2つの操作が進む。
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }): JSX.Element {
  const sourcesRef = useRef(new Set<LossSource>())

  const [prompt, setPrompt] = useState<{
    readonly action: LossAction
    readonly items: readonly LossItem[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 今出ている確認の答えを待っている相手。 */
  const resolveRef = useRef<((proceed: boolean) => void) | null>(null)
  /** 確認の最中か（申告を集めている間も含む。このファイルの冒頭）。 */
  const askingRef = useRef(false)

  const registerSource = useCallback((source: LossSource): (() => void) => {
    sourcesRef.current.add(source)

    return () => {
      sourcesRef.current.delete(source)
    }
  }, [])

  /*
    申告を集める。**その操作で失われるものだけ**が返るように、何をしようと
    しているかを渡す（Terminal は Workspace の切り替えでは何も失わない）。
    非同期なのは、OS に聞かないと分からない申告があるため（types.ts）。
  */
  const listLosses = useCallback(async (action: LossAction): Promise<readonly LossItem[]> => {
    const lists = await Promise.all(
      [...sourcesRef.current].map((source) => source.listLosses(action))
    )

    return lists.flat()
  }, [])

  const confirmDiscard = useCallback(
    async (action: LossAction): Promise<boolean> => {
      // 既に尋ねている最中。二重に進めない。
      if (askingRef.current) {
        return false
      }

      askingRef.current = true

      let items: readonly LossItem[]

      try {
        items = await listLosses(action)
      } catch (cause) {
        /*
          申告を集められなかった。**失われるものが無いとは言えない**ので、
          続けない側へ倒す（呼び出し側は操作を取りやめる）。
        */
        console.error('[unsaved] 失われるものを確かめられませんでした。', cause)
        askingRef.current = false

        return false
      }

      // 失われるものが無ければ尋ねない。
      if (items.length === 0) {
        askingRef.current = false

        return true
      }

      setError(null)
      setBusy(false)
      setPrompt({ action, items })

      return await new Promise<boolean>((resolve) => {
        resolveRef.current = resolve
      })
    },
    [listLosses]
  )

  const finish = useCallback((proceed: boolean): void => {
    const resolve = resolveRef.current

    resolveRef.current = null
    askingRef.current = false
    setPrompt(null)
    setBusy(false)
    setError(null)

    resolve?.(proceed)
  }, [])

  /*
    今出ている確認の控え。保存の完了は React の描画とは別の時間軸で届くため、
    そこから読むのは state ではなく ref にあたる
    （editor/useTabCloseGuard.ts が確認中の対象を控えているのと同じ理由）。
  */
  const promptRef = useRef(prompt)
  promptRef.current = prompt

  const onChoose = useCallback(
    (choice: LossChoice): void => {
      if (choice === 'cancel') {
        finish(false)
        return
      }

      if (choice === 'discard') {
        finish(true)
        return
      }

      // 保存。**保存できたときだけ**続ける。
      setBusy(true)
      setError(null)

      void (async () => {
        const results = await Promise.all([...sourcesRef.current].map((source) => source.saveAll()))

        if (results.every(Boolean)) {
          finish(true)
          return
        }

        /*
          保存できなかった。確認は閉じずに理由を出す。
          ここで閉じてしまうと、「保存を選んだのに保存されていない」まま
          利用者が次の操作へ進める状態になる。
        */
        setBusy(false)
        setError(
          '保存できなかったファイルがあります。Editor で内容を確認してから、もう一度お試しください。'
        )

        // 一覧を取り直す（保存できたものは消え、残ったものだけが並ぶ）。
        const asking = promptRef.current

        if (asking === null) {
          return
        }

        const remaining = await listLosses(asking.action)

        setPrompt((previous) => (previous === null ? previous : { ...previous, items: remaining }))
      })()
    },
    [finish, listLosses]
  )

  /*
    ウィンドウを閉じる / アプリを終了する要求（Main → Renderer のイベント）。

    Main が close を止めた状態で待っているため、**必ず返事をする**
    （返さないと Main 側の上限で閉じられる。main/windows/closeGuard.ts）。
  */
  useWindowCloseRequest(
    useCallback(async (): Promise<boolean> => {
      return await confirmDiscard('close-window')
    }, [confirmDiscard])
  )

  const controller = useMemo<UnsavedChangesController>(
    () => ({ registerSource, confirmDiscard }),
    [registerSource, confirmDiscard]
  )

  return (
    <UnsavedChangesContext.Provider value={controller}>
      {children}

      {prompt !== null && (
        <UnsavedChangesDialog
          action={prompt.action}
          items={prompt.items}
          busy={busy}
          error={error}
          onChoose={onChoose}
        />
      )}
    </UnsavedChangesContext.Provider>
  )
}
