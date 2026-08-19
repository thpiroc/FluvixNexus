import { useCallback, useRef, useState } from 'react'
import type { FileEntry, FileEntryType } from '@shared/files'
import { fluvix } from '../api/fluvix'
import { describeFileActionError } from './filesError'

/**
 * ファイルの作成 / 改名 / 移動 / コピー / 削除を Main へ依頼する。
 *
 * useFileTree.ts が読み込みを持つのに対し、こちらは書き換えを持つ。分けてあるのは、
 * **書き換えた結果をツリーへ反映するのがこの hook の仕事ではない**ため。
 * 反映は Main からのイベント（`files:changed`）を useFileTree.ts が受けて行う。
 * この分担により、変化の理由（利用者の操作 / 将来のファイル監視）が増えても
 * ツリーの更新経路は1本のまま保てる。
 *
 * ## 渡すのは relativePath と名前だけ
 *
 * 絶対パスを組み立てることも、どこに作るかを Main へ教えることもしない。
 * 作成先は「Workspace の中のこのフォルダ」までしか言えず、
 * それが実際にどこを指すかは Main が持つ現在の Workspace が決める
 * （ARCHITECTURE.md §9.3）。
 *
 * ## 名前の検査は往復させない
 *
 * 入力中の妥当性は shared/files/fileName.ts で判断する（IPC を往復させない）。
 * ただし **Main は Renderer の判断を信じない**。同じ規則で必ず検査し直す。
 * ここで送る前に落としているのは体感のためであって、防御のためではない。
 */

export interface FileActionsController {
  /** 直前の操作が失敗したときの利用者向けの文言。次の操作を始めると消える。 */
  readonly error: string | null
  /** 実行中（二重実行を防ぐ）。 */
  readonly busy: boolean
  readonly dismissError: () => void
  /**
   * 新しいファイル / フォルダを作る。作られたものを返す（失敗なら null）。
   * 呼び出し側はこれを選択状態にする。
   */
  readonly create: (input: {
    parentRelativePath: string
    name: string
    type: FileEntryType
  }) => Promise<FileEntry | null>
  /** 名前を変える。変更後のものを返す（失敗なら null）。 */
  readonly rename: (input: { relativePath: string; name: string }) => Promise<FileEntry | null>
  /**
   * 別のフォルダへ動かす（名前は変えない）。移動後のものを返す（失敗なら null）。
   *
   * 渡すのは相対位置が2つだけ。移動先を絶対パスで指すことも、
   * 「どこへ動かしたか」を Main へ教えることもしない（create と同じ）。
   */
  readonly move: (input: {
    relativePath: string
    toParentRelativePath: string
  }) => Promise<FileEntry | null>
  /**
   * 別のフォルダへ複製する（元はそのまま残る）。できたものを返す（失敗なら null）。
   *
   * **名前を渡さない。** コピー先に同名のものがあった場合に衝突しない名前を作るのは
   * Main の仕事で、Renderer が候補を選ぶ形にすると「選んでから作るまでの隙間」で
   * 上書きが起きうる（shared/files/copyName.ts）。
   * 実際に付いた名前は戻り値の entry から分かる。
   */
  readonly copy: (input: {
    relativePath: string
    toParentRelativePath: string
  }) => Promise<CopyResult | null>
  /** ごみ箱へ送る。成功したかを返す。 */
  readonly remove: (input: { relativePath: string }) => Promise<boolean>
}

/** コピーの結果。とばした件数を伝えるため、entry だけでは足りない。 */
export interface CopyResult {
  readonly entry: FileEntry
  /**
   * 複製せずにとばした件数（リンクなど）。
   *
   * 0 でなければ**成功していても知らせる。** 複製したつもりで中身が欠けている方が、
   * 断られるより悪い（shared/ipc/contracts/files.ts）。
   */
  readonly skippedCount: number
}

export function useFileActions(): FileActionsController {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * 実行中かどうかの控え。
   * state ではなくこちらを見るのは、ハンドラが作られた時点の値を見てしまわないため
   * （WorkspaceFolderProvider と同じ形）。
   */
  const runningRef = useRef(false)

  /** 操作の共通部分（二重実行の抑止・実行中の表示・失敗の文言）。 */
  const run = useCallback(async <T>(action: () => Promise<T>, fallback: T): Promise<T> => {
    if (runningRef.current) {
      return fallback
    }

    runningRef.current = true
    setBusy(true)
    setError(null)

    try {
      return await action()
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }, [])

  const create = useCallback<FileActionsController['create']>(
    (input) =>
      run(async () => {
        const result = await fluvix.files.create(input)

        if (!result.ok) {
          setError(describeFileActionError('create', result.error))
          return null
        }

        return result.data.entry
      }, null),
    [run]
  )

  const rename = useCallback<FileActionsController['rename']>(
    (input) =>
      run(async () => {
        const result = await fluvix.files.rename(input)

        if (!result.ok) {
          setError(describeFileActionError('rename', result.error))
          return null
        }

        return result.data.entry
      }, null),
    [run]
  )

  const move = useCallback<FileActionsController['move']>(
    (input) =>
      run(async () => {
        const result = await fluvix.files.move(input)

        if (!result.ok) {
          setError(describeFileActionError('move', result.error))
          return null
        }

        return result.data.entry
      }, null),
    [run]
  )

  const copy = useCallback<FileActionsController['copy']>(
    (input) =>
      run(async () => {
        const result = await fluvix.files.copy(input)

        if (!result.ok) {
          setError(describeFileActionError('copy', result.error))
          return null
        }

        return { entry: result.data.entry, skippedCount: result.data.skippedCount }
      }, null),
    [run]
  )

  const remove = useCallback<FileActionsController['remove']>(
    (input) =>
      run(async () => {
        const result = await fluvix.files.remove(input)

        if (!result.ok) {
          setError(describeFileActionError('delete', result.error))
          return false
        }

        return true
      }, false),
    [run]
  )

  const dismissError = useCallback((): void => {
    setError(null)
  }, [])

  return { error, busy, dismissError, create, rename, move, copy, remove }
}
