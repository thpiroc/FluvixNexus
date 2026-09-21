/**
 * 設定の保存形式の公開窓口。
 *
 * shared 層のルールどおり、ここは型と定数だけを持つ。検証は保存先を持つ側
 * （main/store/settingsDocument.ts）と、意味を知っている側
 * （renderer/src/editor/autoSave.ts など）が分担する。
 */
export { emptySettingsSections, isSettingsSectionId, SETTINGS_SECTION_IDS } from './sections'

export type {
  SettingsSectionId,
  SettingsSections,
  SettingsSectionUpdate,
  SettingsSectionValue,
  StoredAppearanceSettings,
  StoredEditorSettings,
  StoredFilesSettings,
  StoredGeneralSettings,
  StoredLspSettings,
  StoredMcpSettings,
  StoredTerminalSettings
} from './sections'

export {
  getEffectiveSetting,
  isOverriddenInWorkspace,
  isSettingsScope,
  isWorkspaceScopedSection,
  resolveEffectiveSettings,
  SETTINGS_SCOPES,
  SETTINGS_SECTION_SCOPES
} from './scope'

export type { SettingsScope } from './scope'

export {
  classifySettingsSchemaVersion,
  SETTINGS_DOCUMENT_MAX_BYTES,
  SETTINGS_PRESERVED_MAX_BYTES,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_TEXT_MAX_LENGTH
} from './settingsDocument'

export type { PreservedSettings, SettingsDocument, SettingsSchemaVersion } from './settingsDocument'
