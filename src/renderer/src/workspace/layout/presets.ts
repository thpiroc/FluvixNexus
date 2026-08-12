import { DEFAULT_WORKSPACE_LAYOUT } from './defaultLayout'
import type { WorkspaceLayout } from './types'

/**
 * レイアウトプリセット（DESIGN.md §3）。
 *
 * 「あらかじめ用意された配置」に名前を付けて選べるようにする層。
 * プリセットが持つのはレイアウトそのものではなく**レイアウトを作る関数**で、
 * 適用は常に `WorkspaceLayout` の差し替えとして起きる。
 * Dock / Split / ドラッグ&ドロップ / リサイズと同じく、状態の正本は
 * WorkspaceLayout ひとつのままになる。
 *
 * Session 2-5 では Default だけを実装する。
 * DESIGN.md が挙げている Coding / Debug / Git / Minimal は、この表に足すだけで増やせる
 * （画面側は listLayoutPresets() を並べるだけで、プリセットごとの分岐を持たない）。
 *
 * プリセットを足すときの約束:
 *   1. LayoutPresetId に識別子を足す（Record<LayoutPresetId, …> のため、表への登録漏れは型エラー）
 *   2. createLayout() は正規形のレイアウトを返す（layout/tree.ts の findLayoutProblems が空）
 *   3. ノード id はそのプリセットの中で一意にする。手書きの固定 id を使う場合は
 *      発番される id（`dock-N`）と衝突しない名前にする（layout/nodeId.ts）
 *   4. すべてのパネルを並べる必要は無い。プリセットに含めなかったパネルは
 *      「閉じている」状態になり、View メニューから開ける（layout/panelVisibility.ts）
 *
 * 利用者が自分の配置を保存できるようにする話（DESIGN.md §3）は、ここに
 * 「保存されたプリセット」を足す形になる。その際は保存先が要るため、レイアウトの
 * 永続化（ARCHITECTURE.md §4）と一緒に扱う。
 */

/**
 * プリセットの識別子。
 *
 * 保存したレイアウトと一緒に永続化される想定のため、一度決めた値は変更しない。
 * 予定しているもの: coding / debug / git / minimal（DESIGN.md §3）。
 */
export type LayoutPresetId = 'default'

export interface LayoutPreset {
  readonly id: LayoutPresetId
  /** メニューに出す表示名。 */
  readonly title: string
  /** 何のための配置かを1行で。メニューの補足に出す。 */
  readonly description: string
  /**
   * そのプリセットのレイアウトを作る。
   *
   * 呼ぶたびに同じ形を返すこと（プリセットは「状態」ではなく「配置の定義」）。
   * 適用のたびに新しい値を作る必要は無く、不変の定数を返してよい。
   */
  readonly createLayout: () => WorkspaceLayout
}

const LAYOUT_PRESETS: Readonly<Record<LayoutPresetId, LayoutPreset>> = {
  default: {
    id: 'default',
    title: 'Default',
    description: 'Files / Editor / Git を横に並べ、下に Terminal を置く',
    createLayout: () => DEFAULT_WORKSPACE_LAYOUT
  }
}

/** 起動時に適用するプリセット。 */
export const DEFAULT_LAYOUT_PRESET_ID: LayoutPresetId = 'default'

/** 識別子から定義を引く。未登録の id は型の時点で存在しないため、失敗しない。 */
export function getLayoutPreset(id: LayoutPresetId): LayoutPreset {
  return LAYOUT_PRESETS[id]
}

/**
 * 素の文字列が登録済みのプリセット id かどうか。
 *
 * 保存されたレイアウトの読み込みで使う（workspace/persistence/layoutDocument.ts）。
 * 保存ファイルには文字列として入っており、アプリの更新でプリセットが
 * 増減している可能性があるため、そのまま LayoutPresetId として扱わない。
 */
export function isLayoutPresetId(value: string): value is LayoutPresetId {
  return Object.hasOwn(LAYOUT_PRESETS, value)
}

/** 選択肢として並べるための一覧。表の並び順がそのままメニューの並び順になる。 */
export function listLayoutPresets(): readonly LayoutPreset[] {
  return Object.values(LAYOUT_PRESETS)
}
