import { useCallback, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { UnsavedChangesContext, type UnsavedChangesController } from './context'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import type { UnsavedActionKind, UnsavedChoice, UnsavedItem, UnsavedSource } from './types'
import { useWindowCloseRequest } from './useWindowCloseRequest'

/**
 * 未保存の内容を失う操作に、確認を1本で挟む器。
 *
 * 経緯と分担は types.ts の冒頭。ここが持つのは
 *   - 未保存を持っている側の申告（registerSource）
 *   - 確認を出して結果を返すこと（confirmDiscard）
 *   - ウィンドウを閉じる要求の受け口（useWindowCloseRequest）
 * の3つだけで、**何が未保存かは知らない**（申告された側に聞く）。
 *
 * ## 一度に1つだけ
 *
 * 確認が出ている間は次の確認を受け付けず、その場で「続けない」を返す。
 * 確認が積み上がると、利用者が1回選んだつもりで2回進むことになる。
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }): JSX.Element {
  const sourcesRef = useRef(new Set<UnsavedSource>())

  const [prompt, setPrompt] = useState<{
    readonly kind: UnsavedActionKind
    readonly items: readonly UnsavedItem[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 今出ている確認の答えを待っている相手。 */
  const resolveRef = useRef<((proceed: boolean) => void) | null>(null)

  const registerSource = useCallback((source: UnsavedSource): (() => void) => {
    sourcesRef.current.add(source)

    return () => {
      sourcesRef.current.delete(source)
    }
  }, [])

  const listUnsaved = useCallback((): readonly UnsavedItem[] => {
    return [...sourcesRef.current].flatMap((source) => source.listUnsaved())
  }, [])

  const confirmDiscard = useCallback(
    (kind: UnsavedActionKind): Promise<boolean> => {
      // 既に尋ねている最中。二重に進めない。
      if (resolveRef.current !== null) {
        return Promise.resolve(false)
      }

      const items = listUnsaved()

      // 失われるものが無ければ尋ねない。
      if (items.length === 0) {
        return Promise.resolve(true)
      }

      setError(null)
      setBusy(false)
      setPrompt({ kind, items })

      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve
      })
    },
    [listUnsaved]
  )

  const finish = useCallback((proceed: boolean): void => {
    const resolve = resolveRef.current

    resolveRef.current = null
    setPrompt(null)
    setBusy(false)
    setError(null)

    resolve?.(proceed)
  }, [])

  const onChoose = useCallback(
    (choice: UnsavedChoice): void => {
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
        setPrompt((previous) =>
          previous === null ? previous : { ...previous, items: listUnsaved() }
        )
      })()
    },
    [finish, listUnsaved]
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
          kind={prompt.kind}
          items={prompt.items}
          busy={busy}
          error={error}
          onChoose={onChoose}
        />
      )}
    </UnsavedChangesContext.Provider>
  )
}
