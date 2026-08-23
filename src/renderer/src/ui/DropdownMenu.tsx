import type { JSX } from 'react'
import { Popover } from './Popover'
import './menu.css'

/**
 * ボタンの真下に開くドロップダウンメニュー。
 *
 * 何を並べるかは呼び出し側が決め、このコンポーネントは**項目の描き方と、
 * 選んだら閉じること**を持つ。開閉そのもの（閉じ方が3つ）は ui/Popover.tsx。
 *
 * | 使う側                        | 何を並べるか                        |
 * | ----------------------------- | ----------------------------------- |
 * | workspace/shell/WorkspaceTopBar | Workspace 操作 / View / レイアウト  |
 * | terminal/TerminalTabs           | 開くシェルの選択（Session 3-7-2）   |
 *
 * 元は `workspace/shell/WorkspaceMenu.tsx` として上部バーの隣に置いてあった。
 * Terminal が2つめの使い手になった時点で、使う場所の隣から `ui/` へ引き上げている
 * （FileContextMenu.tsx が「2つめが出たら引き上げる」と書いているのと同じ線）。
 * ボタンの見た目だけは使う側の文脈で変わるため、クラス名を受け取る形にしてある。
 *
 * Session 3-7-5 でもう一段ぶん切り出した ── Terminal の設定 UI が
 * **項目を並べない面**として同じ開閉を要ったため、開閉は Popover へ移り、
 * ここには「メニューとしての見た目と役割」だけが残っている。
 *
 * カーソルの位置に開く右クリックメニュー（files/FileContextMenu.tsx）とは別物。
 * 開く位置の決まり方が違うためで、閉じ方と役割の付け方は揃えてある。
 *
 * ネイティブのアプリケーションメニュー（main/app/menu.ts）ではなくアプリ内 UI に
 * している理由:
 *   - 操作面はアプリ内 UI に置く方針（ARCHITECTURE.md §2 のメニューの扱い）であり、
 *     配布ビルドではネイティブメニューを持たない
 *   - 表示状態（どのパネルが今出ているか）は Renderer のレイアウトが持つ。ネイティブメニューに
 *     出すには Renderer → Main → メニュー という往復が要る（イベント経路そのものは
 *     ARCHITECTURE.md §3.3 にあるが、向きが逆）。レイアウトの正本を Renderer 側に
 *     置いたまま扱えるのはこちら
 */

export interface DropdownMenuItem {
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

interface DropdownMenuProps {
  /** 開くボタンの文言。 */
  readonly label: string
  /** 開くボタンのクラス名（使う場所の文脈に合わせる）。 */
  readonly buttonClassName: string
  /** 開くボタンの読み上げ名。文言が記号だけのときに要る。 */
  readonly buttonLabel?: string
  readonly items: readonly DropdownMenuItem[]
  /**
   * 開いた瞬間に呼ばれる。
   *
   * 中身が環境で変わるもの（起動できるシェルの一覧）を、開くたびに
   * 取り直すために要る。閉じるときには呼ばない。
   */
  readonly onOpen?: () => void
}

export function DropdownMenu({
  label,
  buttonClassName,
  buttonLabel,
  items,
  onOpen
}: DropdownMenuProps): JSX.Element {
  return (
    <Popover
      label={label}
      buttonClassName={buttonClassName}
      buttonLabel={buttonLabel}
      role="menu"
      onOpen={onOpen}
    >
      {(close) =>
        items.map((item) => (
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
        ))
      }
    </Popover>
  )
}

function roleOf(
  state: DropdownMenuItem['state']
): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
  if (state === undefined) {
    return 'menuitem'
  }

  return state === 'checked' || state === 'unchecked' ? 'menuitemcheckbox' : 'menuitemradio'
}

function isOn(state: DropdownMenuItem['state']): boolean {
  return state === 'checked' || state === 'selected'
}
