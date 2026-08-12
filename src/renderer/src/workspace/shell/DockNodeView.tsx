import { Fragment, type CSSProperties, type JSX } from 'react'
import type { PanelDragController } from '../dnd/usePanelDrag'
import { isGroupNode } from '../layout/tree'
import type { DockNode, DockNodeId, SplitDirection } from '../layout/types'
import type { PanelId } from '../panels/types'
import type { SplitResizeController } from '../resize/useSplitResize'
import { DockArea } from './DockArea'
import { DockResizeHandle } from './DockResizeHandle'

/**
 * レイアウトの木を描く。
 *
 * WorkspaceShell が領域を直接並べるのではなく、木をそのまま辿って描くのがこの層の役目。
 * 「どこに何があるか」はレイアウトデータだけが決め、JSX の構造は毎回その写しになる。
 * 分割が何段深くなっても、コンポーネントの構造を書き換える必要は無い。
 *
 * 領域の大きさは親が子に渡す。子は自分の size（px か null）を持つが、
 * それを幅として使うか高さとして使うかは親の並び方向で決まるため。
 *
 * ドラッグ&ドロップとリサイズに関しては、木を辿るこの層は何も判断せず、
 * それぞれの窓口（PanelDragController / SplitResizeController）を渡すだけ。
 *
 * 掴み手は子と子の間に「もう1つの flex アイテム」として挟む。
 * 境界の上に重ねるのではなく並びの一員にしているのは、
 * リサイズが両隣の領域だけの話であることを DOM の並びでも保つため
 * （resize/ は掴み手の前後の要素を測るだけで、木を辿り直さずに済む）。
 * どの段の split でも同じ形で挟まるので、入れ子の分割もそのままリサイズできる。
 */

/** 木の根に渡す並び方。上下のバーを除いた領域をすべて使う。 */
export const ROOT_NODE_STYLE: CSSProperties = { flex: '1 1 0' }

interface DockNodeViewProps {
  readonly node: DockNode
  readonly style: CSSProperties
  readonly onActivatePanel: (groupId: DockNodeId, panelId: PanelId) => void
  readonly onClosePanel: (panelId: PanelId) => void
  readonly drag: PanelDragController
  readonly resize: SplitResizeController
}

export function DockNodeView({
  node,
  style,
  onActivatePanel,
  onClosePanel,
  drag,
  resize
}: DockNodeViewProps): JSX.Element {
  if (isGroupNode(node)) {
    return (
      <DockArea
        group={node}
        style={style}
        onActivatePanel={onActivatePanel}
        onClosePanel={onClosePanel}
        drag={drag}
      />
    )
  }

  return (
    <div className="fx-dock-split" data-direction={node.direction} style={style}>
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 && (
            <DockResizeHandle
              splitId={node.id}
              index={index - 1}
              direction={node.direction}
              resize={resize}
            />
          )}

          <DockNodeView
            node={child}
            style={childStyle(node.direction, child.size)}
            onActivatePanel={onActivatePanel}
            onClosePanel={onClosePanel}
            drag={drag}
            resize={resize}
          />
        </Fragment>
      ))}
    </div>
  )
}

/**
 * 子の並び方を決める。
 *
 *   size が数値 … 並び方向のサイズを固定する（サイドバーのように幅を保つ領域）
 *   size が null … 残りを埋める。同じ親に複数あれば等分される（分割直後の状態）
 *
 * flex-basis ではなく width / height を使うのは、box-sizing: border-box と合わせて
 * 「レイアウトが持つ値＝枠線を含む実際の占有幅」を保つため（global.css）。
 *
 * 固定サイズの子に flex-shrink を許してあるのは、ウィンドウが極端に狭くなったときの逃げ道。
 * 入りきる限り指定どおりの大きさになり、入らなくなって初めて縮む
 * （縮まないと領域がウィンドウからはみ出し、外側の領域が操作できなくなる）。
 */
function childStyle(direction: SplitDirection, size: number | null): CSSProperties {
  if (size === null) {
    return { flex: '1 1 0' }
  }

  return direction === 'row'
    ? { flex: '0 1 auto', width: size }
    : { flex: '0 1 auto', height: size }
}
