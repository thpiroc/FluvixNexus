import { createContext, useContext } from 'react'
import type { WorkspaceSettingsSnapshot } from '@shared/ipc'
import type { SettingsSectionId, SettingsSections } from '@shared/settings'
import type { SettingsWriteTarget } from './settingsScopeState'

/**
 * ユーザー設定 / ワークスペース設定の器（settings/SettingsScopeProvider.tsx）が配るもの。
 *
 * 各機能はここを直接読まない ── 読むのは settings/useSettingsSection.ts を通した
 * 「実際に効く値」だけで、scope を意識するのは Settings 画面だけになる。
 */
export interface SettingsScopeController {
  /** 読み込みが終わったか（終わるまで書かない）。 */
  readonly ready: boolean
  /** ユーザー設定（読み込み前は空）。 */
  readonly user: SettingsSections
  /** 今開いている Workspace のワークスペース設定（開いていなければ null）。 */
  readonly workspace: WorkspaceSettingsSnapshot | null
  /** 実際に効く設定（`ワークスペース > ユーザー`。読み込み前は null）。 */
  readonly effective: SettingsSections | null
  /**
   * 値が `before` から `after` へ変わったことを書く（`toStored` を通した section の形）。
   * 変わった key だけが、`target` の決める scope へ書かれる（settingsScopeState.ts）。
   */
  readonly writeSection: (
    section: SettingsSectionId,
    before: object,
    after: object,
    target: SettingsWriteTarget
  ) => void
  /** ワークスペース設定の上書きを外し、ユーザー設定へ戻す。 */
  readonly resetWorkspaceKeys: (section: SettingsSectionId, keys: readonly string[]) => void
}

export const SettingsScopeContext = createContext<SettingsScopeController | null>(null)

/**
 * 器を読む。
 *
 * 器が無い場所で呼ばれたら落とす。黙って既定値を返すと、「選んだのに次の描画で戻る」
 * という形で表に出ることになり、原因が追いにくい（FilesViewProvider と同じ扱い）。
 */
export function useSettingsScope(): SettingsScopeController {
  const value = useContext(SettingsScopeContext)

  if (value === null) {
    throw new Error('useSettingsScope は SettingsScopeProvider の中でのみ使える')
  }

  return value
}
