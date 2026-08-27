import { useCallback, useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react'
import './menu.css'

/**
 * ボタンの真下に開く面（アプリ共通の器）。
 *
 * 持っているのは**開閉と、閉じ方**だけ。中身が何かは知らない。
 *
 * | 使う側                          | 中身                                         |
 * | ------------------------------- | -------------------------------------------- |
 * | ui/DropdownMenu                 | 選ぶと閉じる項目の並び                       |
 * | terminal/TerminalSettingsMenu   | 値を変える欄（Session 3-7-5）                |
 *
 * 元は `ui/DropdownMenu.tsx` の中にあった。Terminal の設定 UI が
 * **項目を並べない2つめの使い手**になった時点で、開閉の部分だけをここへ引き上げている
 * （`WorkspaceMenu` → `ui/DropdownMenu`、`FileContextMenu` の「2つめが出たら引き上げる」
 * と同じ線）。引き上げたのは閉じ方が3つ（項目の選択 / 外側のクリック / Escape）＋
 * ウィンドウが焦点を失ったとき、という**振る舞いの塊**だからで、これを写して
 * 増やすと、次に閉じ方を1つ直すときに直す場所が2つになる。
 *
 * カーソルの位置に開く右クリックメニュー（files/FileContextMenu.tsx）とは別物
 * （開く位置の決まり方が違う）。
 *
 * ## 中身は関数で受け取る
 *
 * `children` に閉じる手段（`close`）を渡す。項目を選んだら閉じる（DropdownMenu）、
 * 値を変えても閉じない（設定 UI）のどちらも、**中身の側が決めること**であって
 * この器が決めることではないため。
 */

interface PopoverProps {
  /** 開くボタンの文言。 */
  readonly label: string
  /** 開くボタンのクラス名（使う場所の文脈に合わせる）。 */
  readonly buttonClassName: string
  /** 開くボタンの読み上げ名。文言が記号だけのときに要る。 */
  readonly buttonLabel?: string
  /**
   * 開いた面の役割。
   *
   *   'menu'   … 選ぶ項目が並ぶ（DropdownMenu）
   *   'dialog' … 値を変える欄が並ぶ（設定 UI）
   *
   * 見た目は変わらないが、支援技術への伝わり方が変わる。
   */
  readonly role: 'menu' | 'dialog'
  /** 開いた面の読み上げ名（`role="dialog"` には名前が要る）。 */
  readonly panelLabel?: string
  /** 面に足すクラス名（幅や余白を変えたいとき）。 */
  readonly panelClassName?: string
  /**
   * 開いた瞬間に呼ばれる。
   *
   * 中身が環境で変わるもの（起動できるシェルの一覧）を、開くたびに
   * 取り直すために要る。閉じるときには呼ばない。
   */
  readonly onOpen?: () => void
  /**
   * `Esc` で閉じるのを、いったん止める（Session 3-8-14）。
   *
   * 面の中でさらに何かが開いているとき（ブランチの行の下に出る確認 / 入力欄。
   * GitBranchMenu.tsx）に立てる。**`Esc` は開いた順に1つずつほどく**のが
   * アプリ共通の形で（履歴の面 → 詳細 → 欄。§14.21）、ここでも
   * 「中の欄を畳む」が先、「面を閉じる」が後になる。
   *
   * 「受け取っても無視する」ではなく**購読そのものを張らない**のは、
   * 同じ `window` に付いた2つの購読が `stopPropagation` を挟んでも
   * どちらも呼ばれるため ── 履歴の面が上に差分が重なっている間に
   * 使っている `suspended` とまったく同じ形になる（GitHistoryOverlay.tsx）。
   *
   * 外側のクリックとウィンドウの焦点喪失では**今までどおり閉じる。**
   * どちらも「この面から離れた」という意思表示で、ほどく順の話ではない。
   */
  readonly escapeSuspended?: boolean
  /** 面の中身。閉じる手段を受け取る。 */
  readonly children: (close: () => void) => ReactNode
}

export function Popover({
  label,
  buttonClassName,
  buttonLabel,
  role,
  panelLabel,
  panelClassName,
  onOpen,
  escapeSuspended = false,
  children
}: PopoverProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const close = useCallback((): void => {
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    // 外側を押したら閉じる。押した先の操作は妨げない（capture もしない）。
    const handlePointerDown = (event: PointerEvent): void => {
      const root = rootRef.current

      if (root !== null && event.target instanceof Node && root.contains(event.target)) {
        return
      }

      close()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)

    // 中で何かが開いている間は、Esc を待つのをやめる（`escapeSuspended`）。
    if (!escapeSuspended) {
      window.addEventListener('keydown', handleKeyDown)
    }

    // パネルのドラッグやウィンドウの切り替えが始まったら、開いたままにしない。
    window.addEventListener('blur', close)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [open, close, escapeSuspended])

  return (
    <div className="fx-menu" ref={rootRef}>
      <button
        type="button"
        className={buttonClassName}
        aria-haspopup={role}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={buttonLabel}
        data-open={open}
        onClick={() => {
          setOpen((current) => {
            if (!current) {
              onOpen?.()
            }

            return !current
          })
        }}
      >
        {label}
      </button>

      {open && (
        <div
          className={
            panelClassName === undefined ? 'fx-menu__list' : `fx-menu__list ${panelClassName}`
          }
          role={role}
          aria-label={panelLabel}
          id={panelId}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}
