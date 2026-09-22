/**
 * settings ドメインの Main → Renderer イベント（feature/settings-scope）。
 *
 * Workspace が切り替わると、効くワークスペース設定も切り替わる。Renderer の設定の器
 * （renderer/src/settings/SettingsScopeProvider.tsx）は Workspace を開く UI より
 * 外側に居るため、**Main の正本が切り替わったこと**をここで受け取り、読み直す。
 *
 * payload に設定の中身を載せないのは、読み直しの経路を `settings:load` 1本に
 * 保つため（届いた中身と読み込んだ中身の2通りを持たない）。
 */
export interface SettingsWorkspaceChangedEvent {
  /** 新しく開いた Workspace の識別子。閉じた場合は null。 */
  readonly workspaceId: string | null
}

export interface SettingsIpcEventContract {
  'settings:workspace-changed': SettingsWorkspaceChangedEvent
}
