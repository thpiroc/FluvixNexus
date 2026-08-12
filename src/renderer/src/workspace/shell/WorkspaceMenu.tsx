import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react'

/**
 * 上部バーのドロップダウンメニュー。
 *
 * View（パネルの表示切り替え）とレイアウトプリセットの切り替えで使う共通の器。
 * 何を並べるかは呼び出し側が決め、このコンポーネントは開閉と選択の受け渡しだけを持つ。
 *
 * ネイティブのアプリケーションメニュー（main/app/menu.ts）ではなくアプリ内 UI にしている理由:
 *   - 操作面はアプリ内 UI に置く方針（ARCHITECTURE.md §2 のメニューの扱い）であり、
 *     配布ビルドではネイティブメニューを持たない
 *   - 表示状態（どのパネルが今出ているか）は Renderer のレイアウトが持つ。
 *     ネイティブメニューに出すには Main → Renderer のイベント経路が要るが、これは未実装
 *     （ARCHITECTURE.md §3.3）。レイアウトの正本を Renderer 側に置いたまま扱えるのはこちら
 *
 * 閉じ方は3つ（項目の選択 / 外側のクリック / Escape）。どれも「メニューを閉じる」だけで、
 * レイアウトには触れない。
 */

export interface WorkspaceMenuItem {
  readonly key: string
  readonly label: string
  /**
   * チェックの状態。
   *
   *   'checked' / 'unchecked' … 入 / 切を切り替える項目（View のパネル表示）
   *   'selected' / 'unselected' … 複数から1つを選ぶ項目（レイアウトプリセット）
   *   undefined … ただの項目
   *
   * 見た目の印だけでなく、支援技術に渡す role もここから決める。
   */
  readonly state?: 'checked' | 'unchecked' | 'selected' | 'unselected'
  /** 項目の補足。プリセットの説明など。 */
  readonly hint?: string
  readonly onSelect: () => void
}

interface WorkspaceMenuProps {
  /** 開くボタンの文言。 */
  readonly label: string
  readonly items: readonly WorkspaceMenuItem[]
}

export function WorkspaceMenu({ label, items }: WorkspaceMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

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
    window.addEventListener('keydown', handleKeyDown)
    // パネルのドラッグやウィンドウの切り替えが始まったら、開いたままにしない。
    window.addEventListener('blur', close)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [open, close])

  return (
    <div className="fx-menu" ref={rootRef}>
      <button
        type="button"
        className="fx-topbar__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-open={open}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>

      {open && (
        <div className="fx-menu__list" role="menu" id={menuId}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="fx-menu__item"
              role={roleOf(item.state)}
              aria-checked={item.state === undefined ? undefined : isOn(item.state)}
              data-state={item.state}
              onClick={() => {
                item.onSelect()
                close()
              }}
            >
              {/* 印の場所は常に取っておく。選択のたびに文字の位置がずれないようにするため。 */}
              <span className="fx-menu__mark" aria-hidden="true">
                {isOn(item.state) ? '✓' : ''}
              </span>
              <span className="fx-menu__label">{item.label}</span>
              {item.hint !== undefined && <span className="fx-menu__hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function roleOf(
  state: WorkspaceMenuItem['state']
): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
  if (state === undefined) {
    return 'menuitem'
  }

  return state === 'checked' || state === 'unchecked' ? 'menuitemcheckbox' : 'menuitemradio'
}

function isOn(state: WorkspaceMenuItem['state']): boolean {
  return state === 'checked' || state === 'selected'
}
