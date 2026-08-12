import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_LAYOUT } from './defaultLayout'
import {
  DEFAULT_LAYOUT_PRESET_ID,
  getLayoutPreset,
  listLayoutPresets,
  type LayoutPreset
} from './presets'
import { collectNodes, collectPanelIds, findLayoutProblems } from './tree'

/**
 * レイアウトプリセットの検証。
 *
 * プリセットは「配置の定義」であって状態ではないため、確かめるのは形の正しさだけ。
 * ここを通しておくと、プリセットを増やしたときの定義ミス（id の重複・空の領域・
 * 同じパネルの2重配置）が、画面を開く前に落ちる。
 */

describe('レイアウトプリセット', () => {
  it('既定のプリセットは初期レイアウトを返す', () => {
    expect(getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()).toBe(DEFAULT_WORKSPACE_LAYOUT)
  })

  it('一覧には登録されているプリセットがすべて出る', () => {
    const presets = listLayoutPresets()

    expect(presets.map((preset) => preset.id)).toContain(DEFAULT_LAYOUT_PRESET_ID)
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(presets.length)
  })

  it.each(listLayoutPresets().map((preset): [string, LayoutPreset] => [preset.id, preset]))(
    '%s は正規形のレイアウトを、何度呼んでも同じ形で返す',
    (_id, preset) => {
      const layout = preset.createLayout()

      expect(findLayoutProblems(layout)).toEqual([])
      expect(preset.createLayout()).toEqual(layout)

      // ノード id とパネルの重複は findLayoutProblems も見るが、
      // プリセットを手書きする以上いちばん起きやすいので明示的に確かめる。
      const nodeIds = collectNodes(layout.root).map((node) => node.id)
      const panelIds = collectPanelIds(layout.root)

      expect(new Set(nodeIds).size).toBe(nodeIds.length)
      expect(new Set(panelIds).size).toBe(panelIds.length)
    }
  )
})
