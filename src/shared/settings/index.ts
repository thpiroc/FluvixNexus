/**
 * 設定の保存形式の公開窓口。
 *
 * shared 層のルールどおり、ここは型と定数だけを持つ。検証は保存先を持つ側
 * （main/store/editorSettingsDocument.ts）と、意味を知っている側
 * （renderer/src/editor/autoSave.ts）が分担する。
 */
export {
  EDITOR_SETTINGS_DOCUMENT_MAX_BYTES,
  EDITOR_SETTINGS_SCHEMA_VERSION
} from './editorSettings'

export type { EditorSettingsDocument, StoredAutoSaveSettings } from './editorSettings'

export { FILES_SETTINGS_DOCUMENT_MAX_BYTES, FILES_SETTINGS_SCHEMA_VERSION } from './filesSettings'

export type { FilesSettingsDocument, StoredFilesViewSettings } from './filesSettings'
