import { describe, expect, it } from 'vitest'
import type { WorkspaceLayoutDocument } from '@shared/workspace'
import { resolveDockZone } from './dnd/dockGuide'
import { resolveDropCandidate } from './dnd/dropTarget'
import type { DockZone, DragAreaRect, DragPoint } from './dnd/types'
import { asDockNodeId } from './layout/nodeId'
import {
  activatePanelInLayout,
  movePanel,
  splitNodeWithPanel,
  type DockTarget
} from './layout/operations'
import { closePanelInLayout, openPanelInLayout } from './layout/panelVisibility'
import { DEFAULT_LAYOUT_PRESET_ID, getLayoutPreset } from './layout/presets'
import { resizeSplitBoundary } from './layout/resize'
import {
  collectGroups,
  collectPanelIds,
  findLayoutProblems,
  findNodePath,
  findPanelLocation,
  isSplitNode
} from './layout/tree'
import type { DockNodeId, WorkspaceLayout } from './layout/types'
import type { PanelId } from './panels/types'
import { isSameLayout, serializeWorkspaceLayout } from './persistence/layoutDocument'
import { restoreWorkspaceLayout } from './persistence/restoreLayout'

/**
 * STEP 2（Dockable Workspace）の統合テスト。
 *
 * 個々の層の単体テストは各ディレクトリの隣にある。ここで確かめるのはその先で、
 * **Dock / Drag & Drop / Resize / 表示管理 / プリセット / 永続化を1本の流れとして通したときに
 * 破綻しないこと**を見る。実際の使い方はこの順に起きるため、層ごとに正しくても
 * 繋いだ瞬間に壊れる種類の不具合（ノード id の衝突、正規形の崩れ、
 * 保存 → 復元で落ちる情報）はここでしか見つからない。
 *
 * 通す流れ:
 *
 *   Default → Resize → Drag & Drop → Split → タブ順 → activePanel
 *          → 閉じる → 再表示 → Resize → 保存 → 再起動 → 復元 → 再操作
 *          → Default へ戻す → 再起動 → Default のまま
 *
 * 対象は React にも DOM にも依存しない部分（layout / dnd の判定 / persistence）。
 * マウスの追跡（dnd/usePanelDrag.ts・resize/useSplitResize.ts）と実際の描画は、
 * 実機での確認に任せる（docs/DEVELOPMENT.md §4）。
 *
 * Main 側は Renderer から参照できないため（層の分離）、ここでの「再起動」は
 * JSON の往復として表す。Main が見るエンベロープの検証は
 * src/main/store/workspaceLayoutDocument.test.ts が持つ。
 */

/* -------------------------------------------------------------------------- */
/* 操作をひとまとめにする道具                                                   */
/* -------------------------------------------------------------------------- */

/** ドロップ先の当たり判定に使う領域。実際の大きさは判定に影響しないため固定でよい。 */
const AREA_RECT: DragAreaRect = { left: 0, top: 0, width: 600, height: 400 }

/** その DockZone に落ちるカーソル位置（帯は短辺 400 の 30% ＝ 120px）。 */
const POINT_IN_ZONE: Readonly<Record<DockZone, DragPoint>> = {
  center: { x: 300, y: 200 },
  left: { x: 10, y: 200 },
  right: { x: 590, y: 200 },
  top: { x: 300, y: 10 },
  bottom: { x: 300, y: 390 }
}

/**
 * パネルを掴んで、ある領域の指定の位置へ落とす。
 *
 * 実際の経路（マウス座標 → DockZone → DockTarget → movePanel）をそのまま通す。
 * ノード id は本物の発番器に任せる ── 復元した木の id と衝突しないことを
 * この流れの中で確かめたいため。
 */
function dropPanel(
  layout: WorkspaceLayout,
  panelId: PanelId,
  groupId: DockNodeId,
  zone: DockZone
): WorkspaceLayout {
  expect(resolveDockZone(AREA_RECT, POINT_IN_ZONE[zone])).toBe(zone)

  const candidate = resolveDropCandidate(layout, panelId, groupId, zone)

  expect(candidate.target).not.toBeNull()

  return movePanel(layout, panelId, candidate.target as DockTarget)
}

interface SplitBoundary {
  readonly splitId: DockNodeId
  readonly index: number
}

/** そのパネルが居る領域と、次の領域との間の境界。 */
function boundaryAfter(layout: WorkspaceLayout, panelId: PanelId): SplitBoundary {
  return boundaryAt(layout, panelId, 0)
}

/** そのパネルが居る領域と、手前の領域との間の境界。 */
function boundaryBefore(layout: WorkspaceLayout, panelId: PanelId): SplitBoundary {
  return boundaryAt(layout, panelId, -1)
}

function boundaryAt(layout: WorkspaceLayout, panelId: PanelId, offset: number): SplitBoundary {
  const location = findPanelLocation(layout.root, panelId)

  expect(location).not.toBeNull()

  const path = findNodePath(layout.root, (location as NonNullable<typeof location>).group.id)
  const parent = path?.[path.length - 2]

  if (parent === undefined || !isSplitNode(parent)) {
    throw new Error(`${panelId} の領域に親の split がありません`)
  }

  const index = parent.children.findIndex(
    (child) => child.id === (location as NonNullable<typeof location>).group.id
  )

  return { splitId: parent.id, index: index + offset }
}

function groupIdOf(layout: WorkspaceLayout, panelId: PanelId): DockNodeId {
  const location = findPanelLocation(layout.root, panelId)

  if (location === null) {
    throw new Error(`${panelId} がレイアウトにありません`)
  }

  return location.group.id
}

function sizeOf(layout: WorkspaceLayout, panelId: PanelId): number | null {
  const location = findPanelLocation(layout.root, panelId)

  return location?.group.size ?? null
}

function tabsOf(layout: WorkspaceLayout, panelId: PanelId): readonly PanelId[] {
  return findPanelLocation(layout.root, panelId)?.group.panelIds ?? []
}

/**
 * 保存してアプリを起動し直す。
 *
 * 実際の経路は Renderer → IPC → Main → ディスク → Main → IPC → Renderer だが、
 * 途中はどこも JSON のまま運ばれる。落ちる情報があるとすればその往復で落ちるため、
 * ここでは JSON の往復として表す。
 */
function restart(
  layout: WorkspaceLayout,
  presetId = DEFAULT_LAYOUT_PRESET_ID
): ReturnType<typeof restoreWorkspaceLayout> {
  const onDisk = JSON.parse(
    JSON.stringify(serializeWorkspaceLayout(layout, presetId))
  ) as WorkspaceLayoutDocument

  return restoreWorkspaceLayout(onDisk)
}

/** どの操作の後でも成り立っていること。1操作ごとにここを通す。 */
function expectHealthy(layout: WorkspaceLayout): void {
  expect(findLayoutProblems(layout)).toEqual([])

  const panelIds = collectPanelIds(layout.root)

  expect(new Set(panelIds).size).toBe(panelIds.length)
}

/* -------------------------------------------------------------------------- */

describe('STEP 2 統合: Dock → Drag → Resize → Close → Restore → Save → Restart', () => {
  it('一連の操作を通しても壊れず、終了時の配置がそのまま復元される', () => {
    const preset = getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()

    // ① Default Layout で起動する
    let layout = preset
    expectHealthy(layout)
    expect(collectPanelIds(layout.root)).toEqual(['files', 'editor', 'git', 'terminal'])
    expect(sizeOf(layout, 'files')).toBe(240)
    expect(sizeOf(layout, 'terminal')).toBe(220)

    // ② Files の幅を変更（掴んだ2つの間で大きさを移すだけ）
    const filesBoundary = boundaryAfter(layout, 'files')
    layout = resizeSplitBoundary(layout, filesBoundary.splitId, filesBoundary.index, [240, 700], 90)
    expectHealthy(layout)
    expect(sizeOf(layout, 'files')).toBe(330)
    expect(sizeOf(layout, 'git')).toBe(280)

    // ③ Terminal の高さを変更
    const terminalBoundary = boundaryBefore(layout, 'terminal')
    layout = resizeSplitBoundary(
      layout,
      terminalBoundary.splitId,
      terminalBoundary.index,
      [500, 220],
      -70
    )
    expectHealthy(layout)
    expect(sizeOf(layout, 'terminal')).toBe(290)
    expect(sizeOf(layout, 'files')).toBe(330)

    // ④ Git を別領域へ Drag & Drop（Terminal の領域へタブとして）
    layout = dropPanel(layout, 'git', groupIdOf(layout, 'terminal'), 'center')
    expectHealthy(layout)
    expect(tabsOf(layout, 'git')).toEqual(['terminal', 'git'])
    expect(collectGroups(layout.root)).toHaveLength(3)

    // ⑤ Files を別領域へ Dock / Split（下の領域の左半分へ）
    layout = dropPanel(layout, 'files', groupIdOf(layout, 'terminal'), 'left')
    expectHealthy(layout)
    expect(collectGroups(layout.root)).toHaveLength(3)
    // 分割は等分から始まり、外側の大きさ（290）は分割した split が引き継ぐ。
    expect(sizeOf(layout, 'files')).toBeNull()
    const carved = findNodePath(layout.root, groupIdOf(layout, 'files'))?.at(-2)
    expect(carved?.size).toBe(290)

    // ⑥ PanelGroup 内のタブ順を変更
    //    ※ タブを掴んで並べ替える UI は未実装（STEP 3）。操作としてはここが入口。
    const merged = groupIdOf(layout, 'git')
    layout = movePanel(layout, 'git', { kind: 'tab', groupId: merged, index: 0 })
    expectHealthy(layout)
    expect(tabsOf(layout, 'git')).toEqual(['git', 'terminal'])

    // ⑦ activePanel を変更
    layout = activatePanelInLayout(layout, merged, 'terminal')
    expectHealthy(layout)
    expect(findPanelLocation(layout.root, 'terminal')?.group.activePanelId).toBe('terminal')

    // ⑧ Terminal を閉じる（領域は残り、残ったタブが手前に出る）
    layout = closePanelInLayout(layout, 'terminal')
    expectHealthy(layout)
    expect(findPanelLocation(layout.root, 'terminal')).toBeNull()
    expect(tabsOf(layout, 'git')).toEqual(['git'])
    expect(findPanelLocation(layout.root, 'git')?.group.activePanelId).toBe('git')

    // ⑨ Terminal を再表示（プリセットを設計図に、今の配置を崩さず戻る）
    layout = openPanelInLayout(layout, 'terminal', preset)
    expectHealthy(layout)
    expect(collectGroups(layout.root)).toHaveLength(4)
    expect(sizeOf(layout, 'terminal')).toBe(220)
    // 戻り先は「横並び全体の下」であり、どれか1つの領域の下ではない。
    expect(findNodePath(layout.root, groupIdOf(layout, 'terminal'))).toHaveLength(2)

    // ⑩ さらに Resize
    const reopenedBoundary = boundaryAfter(layout, 'files')
    layout = resizeSplitBoundary(
      layout,
      reopenedBoundary.splitId,
      reopenedBoundary.index,
      [600, 600],
      60
    )
    expectHealthy(layout)
    expect(sizeOf(layout, 'files')).toBe(660)

    // ⑪⑫ 終了 → 再起動
    const restored = restart(layout)

    // ⑬ 変更したレイアウトが正しく復元される
    expect(restored.ok).toBe(true)

    if (!restored.ok) {
      return
    }

    expectHealthy(restored.layout)
    expect(serializeWorkspaceLayout(restored.layout, restored.presetId)).toEqual(
      serializeWorkspaceLayout(layout, DEFAULT_LAYOUT_PRESET_ID)
    )
    expect(restored.presetId).toBe(DEFAULT_LAYOUT_PRESET_ID)

    // ⑭ 復元後に再度 Drag & Drop / Resize できる
    //    （復元した id が予約されていないと、新しい領域の id が既存とぶつかる）
    let reopened = restored.layout
    const afterRestoreBoundary = boundaryAfter(reopened, 'files')
    reopened = resizeSplitBoundary(
      reopened,
      afterRestoreBoundary.splitId,
      afterRestoreBoundary.index,
      [660, 540],
      -60
    )
    expectHealthy(reopened)
    expect(sizeOf(reopened, 'files')).toBe(600)

    reopened = dropPanel(reopened, 'files', groupIdOf(reopened, 'editor'), 'bottom')
    expectHealthy(reopened)
    reopened = dropPanel(reopened, 'git', groupIdOf(reopened, 'files'), 'right')
    expectHealthy(reopened)
    expect(collectPanelIds(reopened.root)).toHaveLength(4)

    // ⑮ Default Layout へ戻す（プリセットを適用し直すだけ）
    const reset = getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()
    expectHealthy(reset)

    // ⑯⑰ 再起動しても Default のまま
    const afterReset = restart(reset)

    expect(afterReset.ok).toBe(true)

    if (!afterReset.ok) {
      return
    }

    expectHealthy(afterReset.layout)
    // 参照は別でも配置は同じ ＝「変更あり」にならない（useWorkspaceLayout の restore）。
    expect(isSameLayout(afterReset.layout, reset)).toBe(true)
    expect(sizeOf(afterReset.layout, 'files')).toBe(240)
    expect(sizeOf(afterReset.layout, 'terminal')).toBe(220)
  })

  it('操作 → 再起動 → 操作 を繰り返しても、パネルは1枚ずつのまま保たれる', () => {
    let layout = getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()

    for (let round = 0; round < 5; round += 1) {
      // 分割のドロップは、相手の領域に必ず別のパネルが居るため毎回受け入れられる。
      layout = dropPanel(layout, 'files', groupIdOf(layout, 'editor'), 'left')
      layout = dropPanel(layout, 'terminal', groupIdOf(layout, 'git'), 'bottom')
      layout = closePanelInLayout(layout, 'git')
      layout = openPanelInLayout(layout, 'git')
      expectHealthy(layout)

      const restored = restart(layout)

      expect(restored.ok).toBe(true)

      if (!restored.ok) {
        return
      }

      expectHealthy(restored.layout)
      expect([...collectPanelIds(restored.layout.root)].sort()).toEqual([
        'editor',
        'files',
        'git',
        'terminal'
      ])

      layout = restored.layout
    }
  })

  it('全パネルを閉じた状態も保存・復元でき、そこから組み直せる', () => {
    let layout = getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()

    for (const panelId of ['files', 'editor', 'git', 'terminal'] as const) {
      layout = closePanelInLayout(layout, panelId)
      expectHealthy(layout)
    }

    expect(collectPanelIds(layout.root)).toEqual([])

    const restored = restart(layout)

    expect(restored.ok).toBe(true)

    if (!restored.ok) {
      return
    }

    expectHealthy(restored.layout)
    expect(collectPanelIds(restored.layout.root)).toEqual([])

    // 空の状態からでも View メニュー相当の操作で組み直せる。
    let rebuilt = restored.layout

    for (const panelId of ['editor', 'files', 'git', 'terminal'] as const) {
      rebuilt = openPanelInLayout(rebuilt, panelId)
      expectHealthy(rebuilt)
    }

    expect([...collectPanelIds(rebuilt.root)].sort()).toEqual([
      'editor',
      'files',
      'git',
      'terminal'
    ])
  })
})

describe('STEP 2 統合: 想定外の保存データからの復帰', () => {
  /**
   * 保存データが壊れていても、Fluvix Nexus 自体が起動不能にならないこと。
   *
   * 個々の検証（何を失敗とみなすか）は persistence/layoutDocument.test.ts が持つ。
   * ここで見るのはその先 ── **失敗した後も通常の経路がそのまま続くか**。
   */
  it.each([
    ['未対応の schemaVersion', { schemaVersion: 99, layout: { presetId: 'default', root: {} } }],
    ['layout が読めない', { schemaVersion: 1, layout: 'broken' }],
    [
      '知らない PanelId',
      {
        schemaVersion: 1,
        layout: {
          presetId: 'default',
          root: {
            kind: 'group',
            id: 'a',
            size: null,
            panelIds: ['files', 'ghost'],
            activePanelId: 'files'
          }
        }
      }
    ],
    [
      '不正な DockNode',
      {
        schemaVersion: 1,
        layout: {
          presetId: 'default',
          root: { kind: 'split', id: 'a', size: null, direction: 'diagonal', children: [] }
        }
      }
    ]
  ])('%s → Default Layout で起動し、その後の操作と保存が続けられる', (_name, stored) => {
    const restored = restoreWorkspaceLayout(stored as WorkspaceLayoutDocument)

    // 例外は投げず、理由を添えた失敗として返る。
    expect(restored.ok).toBe(false)

    // 呼び出し側は Default Layout のまま進む。
    let layout = getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()
    expectHealthy(layout)

    // フォールバック後も通常の操作ができる。
    layout = dropPanel(layout, 'git', groupIdOf(layout, 'files'), 'bottom')
    expectHealthy(layout)

    // その結果は次の起動でそのまま戻る（＝壊れたファイルが正常な内容に置き換わる）。
    const saved = restart(layout)

    expect(saved.ok).toBe(true)
    expect(saved.ok && findLayoutProblems(saved.layout)).toEqual([])
  })

  it('重複した PanelId は整えて復元する（配置そのものは捨てない）', () => {
    const restored = restoreWorkspaceLayout({
      schemaVersion: 1,
      layout: {
        presetId: 'default',
        root: {
          kind: 'split',
          id: 'dup-root',
          size: null,
          direction: 'row',
          children: [
            {
              kind: 'group',
              id: 'dup-a',
              size: 400,
              panelIds: ['files', 'editor'],
              activePanelId: 'editor'
            },
            {
              kind: 'group',
              id: 'dup-b',
              size: null,
              panelIds: ['files', 'terminal', 'git'],
              activePanelId: 'files'
            }
          ]
        }
      }
    })

    expect(restored.ok).toBe(true)

    if (!restored.ok) {
      return
    }

    expectHealthy(restored.layout)
    expect(collectPanelIds(restored.layout.root)).toEqual(['files', 'editor', 'terminal', 'git'])
    // 先に現れた方が残り、後から出てきた方はその領域から落ちる。
    expect(tabsOf(restored.layout, 'files')).toEqual(['files', 'editor'])
    // 中身がずれていた activePanelId は先頭に寄る。
    expect(findPanelLocation(restored.layout.root, 'terminal')?.group.activePanelId).toBe(
      'terminal'
    )
    // 配置は残る（保存されていた 400px がそのまま）。
    expect(sizeOf(restored.layout, 'files')).toBe(400)
  })

  it('空になった PanelGroup は取り除かれ、子が1つになった split は畳まれる', () => {
    const restored = restoreWorkspaceLayout({
      schemaVersion: 1,
      layout: {
        presetId: 'default',
        root: {
          kind: 'split',
          id: 'empty-root',
          size: null,
          direction: 'row',
          children: [
            { kind: 'group', id: 'gone', size: 200, panelIds: [], activePanelId: null },
            {
              kind: 'group',
              id: 'kept',
              size: null,
              panelIds: ['files', 'editor', 'git', 'terminal'],
              activePanelId: 'editor'
            }
          ]
        }
      }
    })

    expect(restored.ok).toBe(true)

    if (!restored.ok) {
      return
    }

    expectHealthy(restored.layout)
    expect(collectGroups(restored.layout.root)).toHaveLength(1)
    expect(restored.layout.root.id).toBe(asDockNodeId('kept'))
  })

  it('極端に小さい size でも領域は消えず、リサイズで元の広さに戻せる', () => {
    const restored = restoreWorkspaceLayout({
      schemaVersion: 1,
      layout: {
        presetId: 'default',
        root: {
          kind: 'split',
          id: 'tiny-root',
          size: null,
          direction: 'row',
          children: [
            { kind: 'group', id: 'tiny', size: 0.02, panelIds: ['files'], activePanelId: 'files' },
            {
              kind: 'group',
              id: 'rest',
              size: null,
              panelIds: ['editor', 'git', 'terminal'],
              activePanelId: 'editor'
            }
          ]
        }
      }
    })

    expect(restored.ok).toBe(true)

    if (!restored.ok) {
      return
    }

    expectHealthy(restored.layout)
    expect(sizeOf(restored.layout, 'files')).toBe(0.02)

    // 掴み手は領域の大きさに関係なく置かれるため、そこから広げ直せる
    // （「今より狭くしない」だけを効かせているので、押し戻しにもならない）。
    const boundary = boundaryAfter(restored.layout, 'files')
    const widened = resizeSplitBoundary(
      restored.layout,
      boundary.splitId,
      boundary.index,
      [0.02, 900],
      300
    )

    expectHealthy(widened)
    expect(sizeOf(widened, 'files')).toBe(300)
  })

  it('復元したレイアウトの id は、その後に作られる領域と衝突しない', () => {
    // 発番される形（dock-N）の id を含む保存データ。予約が効いていないとぶつかる。
    const restored = restoreWorkspaceLayout({
      schemaVersion: 1,
      layout: {
        presetId: 'default',
        root: {
          kind: 'split',
          id: 'dock-900',
          size: null,
          direction: 'row',
          children: [
            {
              kind: 'group',
              id: 'dock-901',
              size: 240,
              panelIds: ['files'],
              activePanelId: 'files'
            },
            {
              kind: 'group',
              id: 'dock-902',
              size: null,
              panelIds: ['editor', 'git', 'terminal'],
              activePanelId: 'editor'
            }
          ]
        }
      }
    })

    expect(restored.ok).toBe(true)

    if (!restored.ok) {
      return
    }

    let layout = restored.layout

    for (const panelId of ['git', 'terminal', 'editor'] as const) {
      layout = splitNodeWithPanel(layout, groupIdOf(layout, 'files'), 'bottom', panelId)
      // findLayoutProblems は id の重複も見る。
      expectHealthy(layout)
    }

    expect(collectPanelIds(layout.root)).toHaveLength(4)
  })
})
