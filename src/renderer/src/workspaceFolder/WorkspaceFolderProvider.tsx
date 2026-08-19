import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { WorkspaceFolder } from '@shared/workspace'
import { fluvix } from '../api/fluvix'
import { describeIpcError } from '../api/result'
import { useUnsavedChanges } from '../unsaved/context'
import { WorkspaceFolderContext, type WorkspaceFolderController } from './context'

/**
 * 開いている Workspace の写しを保持し、切り替えの操作を提供する。
 *
 * Renderer 側で IPC（workspace-folder ドメイン）を呼ぶ唯一の場所。
 * レイアウトの永続化で persistence/useLayoutPersistence.ts が果たしているのと同じ役で、
 * 「いつ Main に問い合わせるか」だけをここに集める。
 *
 *   起動時   … 現在の Workspace を1度だけ取得する（前回の復元は Main 側で済んでいる）
 *   開く     … ダイアログを Main に出してもらい、返ってきた Workspace を写す
 *   閉じる   … 未選択にする
 *
 * 守っていること:
 *
 * - **失敗しても操作は続く。** 開けなかった場合は文言を出すだけで、
 *   今開いている Workspace はそのまま。画面が使えなくなる理由にしない。
 * - **取り消しは何も変えない。** 取り消しは失敗ではないため、エラー表示もしない。
 * - **同時に走らせない。** ダイアログが開いている間に再度押されても2枚目を開かない。
 * - **未保存の内容を黙って捨てない。** 閉じる / 切り替えるの両方で、先に確認を通す。
 *
 * ## 未保存の確認をここに書かない
 *
 * 何が未保存かを知っているのは Editor で、この層は知らない（知る必要も無い）。
 * 尋ねるのは共通の器（unsaved/UnsavedChangesProvider.tsx）で、ここは
 * **「続けてよいか」を聞いてから進む**だけ。この形にしてあるので、
 * 後で Terminal に「実行中のプロセスがある」確認が要るようになっても、
 * このファイルは変わらない。
 *
 * 閉じる入口は上部バーと Files の root 行の2つあるが、どちらも
 * `closeWorkspace` を呼ぶため、確認はこの1箇所で足りる（§10.4 と同じ形）。
 */

interface WorkspaceFolderState {
  readonly status: 'loading' | 'ready'
  readonly workspace: WorkspaceFolder | null
  readonly unavailableRootPath: string | null
}

const INITIAL_STATE: WorkspaceFolderState = {
  status: 'loading',
  workspace: null,
  unavailableRootPath: null
}

export function WorkspaceFolderProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<WorkspaceFolderState>(INITIAL_STATE)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { confirmDiscard } = useUnsavedChanges()

  /** 今 Workspace を開いているか。確認を出すかどうかの判断に使う。 */
  const hasWorkspaceRef = useRef(false)
  hasWorkspaceRef.current = state.workspace !== null

  /**
   * 実行中かどうかの控え。
   * state ではなく ref で持つのは、ハンドラが作られた時点の値を見てしまわないようにするため。
   */
  const runningRef = useRef(false)

  // 起動時の取得。Main は保存内容からの復元（と、消えたフォルダの判定）を済ませている。
  useEffect(() => {
    let cancelled = false

    void fluvix.workspaceFolder.getCurrent().then((result) => {
      if (cancelled) {
        return
      }

      if (!result.ok) {
        // Workspace が分からないだけで画面は動く。未選択として続ける。
        console.warn('[workspace-folder] 現在の Workspace を取得できませんでした。', result.error)
        setState({ status: 'ready', workspace: null, unavailableRootPath: null })
        return
      }

      setState({
        status: 'ready',
        workspace: result.data.workspace,
        unavailableRootPath: result.data.unavailableRootPath
      })
    })

    return () => {
      cancelled = true
    }
  }, [])

  /** 操作の共通部分（二重実行の抑止と、実行中の表示）。 */
  const run = useCallback((action: () => Promise<void>): void => {
    if (runningRef.current) {
      return
    }

    runningRef.current = true
    setBusy(true)
    setError(null)

    void action().finally(() => {
      runningRef.current = false
      setBusy(false)
    })
  }, [])

  const openFolder = useCallback((): void => {
    run(async () => {
      /*
        切り替えると、今の Workspace のタブと Model は捨てられる（§10.3）。
        **ダイアログを出す前に尋ねる。** フォルダを選んでから「やめますか」と
        聞かれるより、選ぶ前に決められる方が素直で、取り消したときに
        Workspace が変わっていないことも明らかになる。

        まだ何も開いていなければ失われるものが無い（確認も出ない）。
      */
      if (hasWorkspaceRef.current && !(await confirmDiscard('switch-workspace'))) {
        return
      }

      const result = await fluvix.workspaceFolder.open()

      if (!result.ok) {
        console.warn('[workspace-folder] フォルダを開けませんでした。', result.error)
        setError(describeIpcError(result.error))
        return
      }

      // 取り消しは通常の結末。今の状態のまま何も変えない。
      if (result.data.status === 'cancelled') {
        return
      }

      setState({
        status: 'ready',
        workspace: result.data.workspace,
        unavailableRootPath: null
      })
    })
  }, [run, confirmDiscard])

  const closeWorkspace = useCallback((): void => {
    run(async () => {
      if (!(await confirmDiscard('close-workspace'))) {
        return
      }

      const result = await fluvix.workspaceFolder.close()

      if (!result.ok) {
        console.warn('[workspace-folder] Workspace を閉じられませんでした。', result.error)
        setError(describeIpcError(result.error))
        return
      }

      setState({ status: 'ready', workspace: null, unavailableRootPath: null })
    })
  }, [run, confirmDiscard])

  const controller = useMemo<WorkspaceFolderController>(
    () => ({
      status: state.status,
      workspace: state.workspace,
      unavailableRootPath: state.unavailableRootPath,
      error,
      busy,
      openFolder,
      closeWorkspace
    }),
    [state, error, busy, openFolder, closeWorkspace]
  )

  return (
    <WorkspaceFolderContext.Provider value={controller}>{children}</WorkspaceFolderContext.Provider>
  )
}
