import { describe, expect, it } from 'vitest'
import { DOCK_SIZE_CONSTRAINTS, minNodeSize } from './constraints'
import type { DockSizeConstraints } from './constraints'
import { DEFAULT_WORKSPACE_LAYOUT } from './defaultLayout'
import { asDockNodeId } from './nodeId'
import { movePanel } from './operations'
import { resizeNode, resizeSplitBoundary } from './resize'
import { findLayoutProblems, findNode, isSplitNode } from './tree'
import type { DockNode, DockNodeId, WorkspaceLayout } from './types'

/**
 * サイズ操作の検証。
 *
 * 確かめたいことは4つ。
 *   1. 掴んだ2つの領域の合計が変わらないこと（他の領域を巻き込まない）
 *   2. 下限を下回らないこと。入れ子の split では中の領域から下限が決まること
 *   3. 可変領域（size: null）が全部 px に変わってしまわないこと
 *   4. どの操作をしても結果が正規形であること
 */

const ROOT = asDockNodeId('root')
const MAIN_ROW = asDockNodeId('main-row')
const LEFT = asDockNodeId('left')
const CENTER = asDockNodeId('center')
const RIGHT = asDockNodeId('right')
const BOTTOM = asDockNodeId('bottom')

/** 下限の値そのものに結果が左右されないよう、テストでは丸い数字の制約を使う。 */
const TEST_CONSTRAINTS: DockSizeConstraints = {
  minGroupSize: { width: 100, height: 50 },
  minGroupSizeByPanel: { editor: { width: 200 } },
  handleThickness: 10
}

function nodeOf(layout: WorkspaceLayout, nodeId: DockNodeId): DockNode {
  const node = findNode(layout.root, nodeId)

  if (node === null) {
    throw new Error(`ノードがありません: ${nodeId}`)
  }

  return node
}

function sizeOf(layout: WorkspaceLayout, nodeId: DockNodeId): number | null {
  return nodeOf(layout, nodeId).size
}

function childrenOf(layout: WorkspaceLayout, nodeId: DockNodeId): readonly DockNode[] {
  const node = nodeOf(layout, nodeId)

  return isSplitNode(node) ? node.children : []
}

/** サイズを変えても正規形から外れないことを、確認のたびに一緒に見る。 */
function expectNormal(layout: WorkspaceLayout): void {
  expect(findLayoutProblems(layout)).toEqual([])
}

describe('minNodeSize', () => {
  it('領域の下限は、そこに置かれているパネルのうち最も大きいものに合わせる', () => {
    expect(minNodeSize(nodeOf(DEFAULT_WORKSPACE_LAYOUT, LEFT), 'row', TEST_CONSTRAINTS)).toBe(100)
    // editor だけ幅の下限が大きい。
    expect(minNodeSize(nodeOf(DEFAULT_WORKSPACE_LAYOUT, CENTER), 'row', TEST_CONSTRAINTS)).toBe(200)
    // 高さには上書きが無いため共通の下限。
    expect(minNodeSize(nodeOf(DEFAULT_WORKSPACE_LAYOUT, CENTER), 'column', TEST_CONSTRAINTS)).toBe(
      50
    )
  })

  it('タブで同居する領域は、その中で最も大きい下限になる', () => {
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'editor', { kind: 'tab', groupId: LEFT })

    expect(minNodeSize(nodeOf(layout, LEFT), 'row', TEST_CONSTRAINTS)).toBe(200)
  })

  it('向きが同じ split は子の合計（＋掴み手）、違う向きなら子の最大になる', () => {
    const mainRow = nodeOf(DEFAULT_WORKSPACE_LAYOUT, MAIN_ROW)

    // row 方向: 100（files）+ 200（editor）+ 100（git）+ 掴み手 2本
    expect(minNodeSize(mainRow, 'row', TEST_CONSTRAINTS)).toBe(420)
    // column 方向: 横に並んでいるので、最も譲れない子の高さがそのまま限界になる
    expect(minNodeSize(mainRow, 'column', TEST_CONSTRAINTS)).toBe(50)
  })

  it('制約を省略すると既定の設定を使う', () => {
    expect(minNodeSize(nodeOf(DEFAULT_WORKSPACE_LAYOUT, LEFT), 'row')).toBe(
      DOCK_SIZE_CONSTRAINTS.minGroupSize.width
    )
    expect(minNodeSize(nodeOf(DEFAULT_WORKSPACE_LAYOUT, CENTER), 'row')).toBe(
      DOCK_SIZE_CONSTRAINTS.minGroupSizeByPanel.editor?.width
    )
  })
})

describe('resizeNode', () => {
  it('指定したノードの基準サイズだけを差し替える', () => {
    const next = resizeNode(DEFAULT_WORKSPACE_LAYOUT, LEFT, 300)

    expect(sizeOf(next, LEFT)).toBe(300)
    expect(sizeOf(next, CENTER)).toBeNull()
    expect(sizeOf(next, RIGHT)).toBe(280)
    expectNormal(next)
  })

  it('null にすると可変領域に戻る', () => {
    expect(sizeOf(resizeNode(DEFAULT_WORKSPACE_LAYOUT, RIGHT, null), RIGHT)).toBeNull()
  })

  it('同じ値・無いノード・0 以下では元のレイアウトを返す', () => {
    expect(resizeNode(DEFAULT_WORKSPACE_LAYOUT, LEFT, 240)).toBe(DEFAULT_WORKSPACE_LAYOUT)
    expect(resizeNode(DEFAULT_WORKSPACE_LAYOUT, asDockNodeId('none'), 300)).toBe(
      DEFAULT_WORKSPACE_LAYOUT
    )
    expect(resizeNode(DEFAULT_WORKSPACE_LAYOUT, LEFT, 0)).toBe(DEFAULT_WORKSPACE_LAYOUT)
    expect(resizeNode(DEFAULT_WORKSPACE_LAYOUT, LEFT, -10)).toBe(DEFAULT_WORKSPACE_LAYOUT)
  })
})

describe('resizeSplitBoundary（px と可変領域の組み合わせ）', () => {
  it('前が px・後ろが可変なら、px 側だけを書き換えて可変側に追従させる', () => {
    // Files(240px) | Editor(可変)
    const next = resizeSplitBoundary(
      DEFAULT_WORKSPACE_LAYOUT,
      MAIN_ROW,
      0,
      [240, 600],
      60,
      TEST_CONSTRAINTS
    )

    expect(sizeOf(next, LEFT)).toBe(300)
    // Editor は可変のまま。残りを埋めるので、結果として 60px 縮む。
    expect(sizeOf(next, CENTER)).toBeNull()
    expect(sizeOf(next, RIGHT)).toBe(280)
    expectNormal(next)
  })

  it('前が可変・後ろが px なら、px 側だけを書き換える', () => {
    // Editor(可変) | Git(280px)。境界を左へ動かすと Git が広がる。
    const next = resizeSplitBoundary(
      DEFAULT_WORKSPACE_LAYOUT,
      MAIN_ROW,
      1,
      [600, 280],
      -80,
      TEST_CONSTRAINTS
    )

    expect(sizeOf(next, CENTER)).toBeNull()
    expect(sizeOf(next, RIGHT)).toBe(360)
    expect(sizeOf(next, LEFT)).toBe(240)
    expectNormal(next)
  })

  it('両側とも可変なら、前だけを px にして後ろを可変のまま残す', () => {
    // Editor を右に分割すると、可変の領域が2つ並ぶ。
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'terminal', {
      kind: 'split',
      groupId: CENTER,
      side: 'right'
    })
    const [, editor, moved] = childrenOf(layout, MAIN_ROW)

    const next = resizeSplitBoundary(layout, MAIN_ROW, 1, [400, 400], 50, TEST_CONSTRAINTS)

    expect(sizeOf(next, editor.id)).toBe(450)
    expect(sizeOf(next, moved.id)).toBeNull()
    expectNormal(next)
  })

  it('掴んだ2つ以外にも可変領域がある場合は、両側とも px に固定する', () => {
    // Files を可変にすると、main-row の子は 可変 / 可変 / 280px の3つになる。
    const layout = resizeNode(DEFAULT_WORKSPACE_LAYOUT, LEFT, null)

    const next = resizeSplitBoundary(layout, MAIN_ROW, 1, [400, 280], 40, TEST_CONSTRAINTS)

    // Editor 側だけを書き換えると、残りを分け合う Files まで動いてしまう。
    expect(sizeOf(next, CENTER)).toBe(440)
    expect(sizeOf(next, RIGHT)).toBe(240)
    expect(sizeOf(next, LEFT)).toBeNull()
    expectNormal(next)
  })

  it('どの組み合わせでも、元々あった可変領域が全部 px に変わることはない', () => {
    // [Files の size, Editor の size] → [結果の Files, 結果の Editor]
    // 合計 840 は常に保たれ、null の側は残りを埋めて追従する。
    const cases: readonly [number | null, number | null, number | null, number | null][] = [
      [240, null, 317, null],
      [null, 280, null, 523],
      [240, 280, 317, 523],
      [null, null, 317, null]
    ]

    for (const [leadingSize, trailingSize, expectedLeading, expectedTrailing] of cases) {
      const layout = resizeNode(
        resizeNode(DEFAULT_WORKSPACE_LAYOUT, LEFT, leadingSize),
        CENTER,
        trailingSize
      )

      const next = resizeSplitBoundary(layout, MAIN_ROW, 0, [240, 600], 77, TEST_CONSTRAINTS)

      expect(sizeOf(next, LEFT)).toBe(expectedLeading)
      expect(sizeOf(next, CENTER)).toBe(expectedTrailing)
      expectNormal(next)

      // ウィンドウサイズの変化を引き受ける領域が残っていること
      // （3つめの組み合わせだけは、元から可変領域が無い＝残しようが無い）。
      const hadFlexible = childrenOf(layout, MAIN_ROW).some((child) => child.size === null)
      const hasFlexible = childrenOf(next, MAIN_ROW).some((child) => child.size === null)
      expect(hasFlexible).toBe(hadFlexible)
    }
  })
})

describe('resizeSplitBoundary（下限）', () => {
  it('前の領域は自分の下限より小さくならない', () => {
    // Files の下限は 100。左いっぱいまで引いても 100 で止まる。
    const next = resizeSplitBoundary(
      DEFAULT_WORKSPACE_LAYOUT,
      MAIN_ROW,
      0,
      [240, 600],
      -9999,
      TEST_CONSTRAINTS
    )

    expect(sizeOf(next, LEFT)).toBe(100)
    expectNormal(next)
  })

  it('後ろの領域（Editor）の下限も守る', () => {
    // Editor の下限は 200。合計 840 なので Files は 640 までしか広がらない。
    const next = resizeSplitBoundary(
      DEFAULT_WORKSPACE_LAYOUT,
      MAIN_ROW,
      0,
      [240, 600],
      9999,
      TEST_CONSTRAINTS
    )

    expect(sizeOf(next, LEFT)).toBe(640)
    expectNormal(next)
  })

  it('入れ子の split では、中の領域から下限が決まる', () => {
    // Terminal を Git の右へ分割し、右側を「Git | Terminal」の入れ子にする。
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'terminal', {
      kind: 'split',
      groupId: RIGHT,
      side: 'right'
    })
    const nested = childrenOf(layout, MAIN_ROW)[2]

    // 入れ子の下限は 100 + 100 + 掴み手 10 = 210。
    expect(minNodeSize(nested, 'row', TEST_CONSTRAINTS)).toBe(210)

    const next = resizeSplitBoundary(layout, MAIN_ROW, 1, [600, 280], 9999, TEST_CONSTRAINTS)

    expect(sizeOf(next, nested.id)).toBe(210)
    expectNormal(next)
  })

  it('既に下限を割っている領域は、それ以上狭くしない（押し戻しもしない）', () => {
    // ウィンドウが狭く、Editor が下限（200）に満たない 150 しか無い状態。
    // 境界を右へ動かす＝ Editor をさらに狭くする操作なので、何も起きない。
    expect(
      resizeSplitBoundary(DEFAULT_WORKSPACE_LAYOUT, MAIN_ROW, 0, [200, 150], 40, TEST_CONSTRAINTS)
    ).toBe(DEFAULT_WORKSPACE_LAYOUT)

    // 逆向き（Editor を広げる方向）には、下限に関係なく動かせる。
    const widened = resizeSplitBoundary(
      DEFAULT_WORKSPACE_LAYOUT,
      MAIN_ROW,
      0,
      [200, 150],
      -40,
      TEST_CONSTRAINTS
    )

    expect(sizeOf(widened, LEFT)).toBe(160)
    expectNormal(widened)
  })

  it('両側とも下限を割っている場合も、表示中の大きさを書き込まない', () => {
    // Files(下限 100) + Editor(下限 200) に対し、合計 200 しか無い。
    // 動かせないだけでなく、レイアウトが持つ 240px を実サイズで上書きもしない。
    expect(
      resizeSplitBoundary(DEFAULT_WORKSPACE_LAYOUT, MAIN_ROW, 0, [100, 100], 30, TEST_CONSTRAINTS)
    ).toBe(DEFAULT_WORKSPACE_LAYOUT)
  })
})

describe('resizeSplitBoundary（受け付けない入力）', () => {
  it('動かしていない状態では元のレイアウトを返す', () => {
    const layout = resizeNode(DEFAULT_WORKSPACE_LAYOUT, CENTER, 600)

    expect(resizeSplitBoundary(layout, MAIN_ROW, 0, [240, 600], 0, TEST_CONSTRAINTS)).toBe(layout)
  })

  it('split でないノード・範囲外の境界・無いノードでは元のレイアウトを返す', () => {
    const cases: readonly [DockNodeId, number][] = [
      [LEFT, 0],
      [asDockNodeId('none'), 0],
      [MAIN_ROW, -1],
      [MAIN_ROW, 2],
      [MAIN_ROW, 0.5]
    ]

    for (const [nodeId, index] of cases) {
      expect(
        resizeSplitBoundary(
          DEFAULT_WORKSPACE_LAYOUT,
          nodeId,
          index,
          [240, 600],
          40,
          TEST_CONSTRAINTS
        )
      ).toBe(DEFAULT_WORKSPACE_LAYOUT)
    }
  })

  it('数値でない実サイズ・移動量では元のレイアウトを返す', () => {
    expect(
      resizeSplitBoundary(
        DEFAULT_WORKSPACE_LAYOUT,
        MAIN_ROW,
        0,
        [Number.NaN, 600],
        40,
        TEST_CONSTRAINTS
      )
    ).toBe(DEFAULT_WORKSPACE_LAYOUT)

    expect(
      resizeSplitBoundary(
        DEFAULT_WORKSPACE_LAYOUT,
        MAIN_ROW,
        0,
        [240, 600],
        Number.NaN,
        TEST_CONSTRAINTS
      )
    ).toBe(DEFAULT_WORKSPACE_LAYOUT)
  })
})

describe('リサイズと Dock 操作の共存', () => {
  it('リサイズした後もパネルを移動でき、木は正規形のまま保たれる', () => {
    // 上（Files / Editor / Git の行）と Terminal の境界を上へ動かす。
    const resized = resizeSplitBoundary(
      DEFAULT_WORKSPACE_LAYOUT,
      ROOT,
      0,
      [700, 220],
      -100,
      TEST_CONSTRAINTS
    )

    expect(sizeOf(resized, BOTTOM)).toBe(320)

    const moved = movePanel(resized, 'git', { kind: 'tab', groupId: BOTTOM })

    expectNormal(moved)
    // 領域が消えても、残った領域のサイズはそのまま保たれる。
    expect(sizeOf(moved, BOTTOM)).toBe(320)
    expect(sizeOf(moved, LEFT)).toBe(240)
  })

  it('移動で生まれた領域も、その場でリサイズできる', () => {
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', {
      kind: 'split',
      groupId: BOTTOM,
      side: 'right'
    })
    // bottom(220px) が新しい row の split に包まれ、中は等分になっている。
    const wrapper = childrenOf(layout, ROOT)[1]
    const [terminal, git] = childrenOf(layout, wrapper.id)

    const next = resizeSplitBoundary(layout, wrapper.id, 0, [500, 500], 120, TEST_CONSTRAINTS)

    expect(sizeOf(next, terminal.id)).toBe(620)
    expect(sizeOf(next, git.id)).toBeNull()
    // 外から見た大きさ（220px）は変わらない。
    expect(sizeOf(next, wrapper.id)).toBe(220)
    expectNormal(next)
  })
})
