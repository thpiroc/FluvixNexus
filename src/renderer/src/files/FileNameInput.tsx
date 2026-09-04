import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { findFileNameProblem, normalizeFileName } from '@shared/files'
import { useI18n } from '../i18n/context'
import { describeFileNameProblem } from './filesError'
import {
  acceptsCancel,
  acceptsCommit,
  beginCommit,
  cancelEdit,
  endCommit,
  INITIAL_NAME_EDIT_STATUS,
  type NameEditStatus
} from './nameEditState'

/**
 * ツリーの中で名前を打つ入力欄（作成とリネームで共通）。
 *
 * **別のダイアログを開かない。** どのフォルダに対する操作なのかが画面から消えると、
 * 深い階層ほど「今どこに作ろうとしているのか」が分からなくなる。
 * ツリーの中に入力欄が現れる形なら、位置が操作そのものの一部として見える。
 *
 * ## 決めていること
 *
 * - **Enter で確定、Escape で取り消し。** どちらもツリー上での編集の慣習で、
 *   ボタンを置くと1行に収まらない（パネルは細くできる）
 * - **入力欄から focus が外れたら取り消す。** 確定にしない。押し間違いで確定すると
 *   意図しないファイルが増える一方、取り消しは打ち直せば済む
 * - **使えない名前は Enter を受け付けず、その場で理由を出す。** IPC を往復させないのは、
 *   1文字ごとに Main を呼ぶ意味が無いため。ただし **Main は同じ検査をやり直す**
 *   （shared/files/fileName.ts）ので、ここを通ったことが許可を意味するわけではない
 * - **リネームは拡張子より前を選択して開く。** `index.ts` の `index` だけを打ち替える
 *   のが多数で、毎回カーソルを動かさずに済む
 * - **確定に失敗したら、そのまま打ち直せる。** 同名衝突のように「名前を変えれば通る」
 *   失敗が主なので、入力欄を閉じてしまうと最初から入れ直すことになる（下記）
 *
 * ## 確定は往復する ── その途中と、失敗した後を分ける
 *
 * Enter を押しても、その名前が通るかどうかは Main の応答を待たないと分からない。
 * 受け付ける操作の判断は nameEditState.ts に切り出してある（そちらに理由も書いてある）。
 * ここが持つのは、その判断に従って入力欄を描くことと、
 * **応答が返ったら必ず状態を進める**ことだけ。
 *
 * 失敗のときに理由を出すのはこの入力欄ではなく、Files パネル上部のエラー行
 * （`FileTree.tsx` / `useFileActions.ts`）。入力欄の下に出しているのは
 * 打っている最中の名前の問題だけで、この2つは出どころが違う
 * ── 前者は Main が答えた結末、後者は IPC を往復させずに分かること。
 */

interface FileNameInputProps {
  /** 入力欄の初期値。作成では空、リネームでは今の名前。 */
  readonly initialName: string
  /**
   * 確定（Enter）。正規化した名前が渡る。
   *
   * **確定できたかを返すこと。** false（や解決しない Promise の失敗）なら
   * 入力欄は開いたまま、打ち直せる状態へ戻る。
   */
  readonly onCommit: (name: string) => boolean | Promise<boolean>
  /** 取り消し（Escape / focus が外れた）。 */
  readonly onCancel: () => void
  readonly ariaLabel: string
}

/** 拡張子の直前まで（`index.ts` なら 5）。拡張子が無ければ全体。 */
function selectionEnd(name: string): number {
  const dot = name.lastIndexOf('.')

  return dot > 0 ? dot : name.length
}

export function FileNameInput({
  initialName,
  onCommit,
  onCancel,
  ariaLabel
}: FileNameInputProps): JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState(initialName)
  const [status, setStatus] = useState<NameEditStatus>(INITIAL_NAME_EDIT_STATUS)
  const inputRef = useRef<HTMLInputElement | null>(null)

  /**
   * 今の状態の控え。
   *
   * state ではなくこちらを見て判断するのは、ハンドラが作られた時点の値を見てしまわないため
   * （useFileActions.ts の runningRef と同じ形）。確定の応答は再描画をまたいで返る。
   */
  const statusRef = useRef<NameEditStatus>(INITIAL_NAME_EDIT_STATUS)

  /** 応答が返る前に入力欄が消えていることがある（Workspace を閉じた・親フォルダが消えた）。 */
  const mountedRef = useRef(true)

  const moveTo = (next: NameEditStatus): void => {
    statusRef.current = next
    setStatus(next)
  }

  useEffect(() => {
    const input = inputRef.current

    if (input === null) {
      return
    }

    input.focus()
    input.setSelectionRange(0, selectionEnd(initialName))
  }, [initialName])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const name = normalizeFileName(value)
  const problem = findFileNameProblem(name)

  const commit = (): void => {
    if (!acceptsCommit(statusRef.current, problem)) {
      return
    }

    moveTo(beginCommit())

    /*
      失敗しても必ず editing へ戻す（＝ finally に相当する経路を両方に用意する）。
      戻し忘れると、二重送信の抑止がそのまま「何も受け付けない入力欄」になる。
    */
    const settle = (committed: boolean): void => {
      if (!mountedRef.current) {
        return
      }

      moveTo(endCommit(committed))

      if (!committed) {
        // その場で打ち直せるように focus を戻す（選択範囲は動かさない）。
        inputRef.current?.focus()
      }
    }

    Promise.resolve(onCommit(name)).then(
      (committed) => settle(committed),
      () => settle(false)
    )
  }

  const cancel = (): void => {
    if (!acceptsCancel(statusRef.current)) {
      return
    }

    moveTo(cancelEdit())
    onCancel()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // ツリー側のキーボード操作（上下移動・F2・Delete）へ伝えない。
    event.stopPropagation()

    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  return (
    <div className="fx-file-name">
      {/*
        応答を待つあいだも disabled にしない。disabled にすると focus が外れ、
        失敗して戻ってきたときに入力欄の外にカーソルがある。
        受け付けないことは commit / cancel の側で判断する。
      */}
      <input
        ref={inputRef}
        type="text"
        className="fx-file-name__input"
        aria-label={ariaLabel}
        aria-invalid={problem !== null}
        aria-busy={status === 'submitting'}
        data-invalid={problem !== null}
        data-status={status}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={cancel}
        // 行のクリック（選択・開閉）に伝えない。
        onClick={(event) => event.stopPropagation()}
      />

      {/*
        空欄のうちは理由を出さない。打ち始める前から赤い文字が出ていると、
        入力を促す表示なのか失敗の表示なのかが読み取れない。
      */}
      {problem !== null && name.length > 0 && (
        <span className="fx-file-name__problem" role="alert">
          {describeFileNameProblem(problem, t)}
        </span>
      )}
    </div>
  )
}
