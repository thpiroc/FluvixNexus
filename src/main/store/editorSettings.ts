import type { EditorSettingsDocument } from '@shared/settings'
import { createJsonStore, type JsonStore } from './jsonStore'
import { parseEditorSettingsDocument } from './editorSettingsDocument'

/**
 * Editor 設定（Auto Save）の保存先。
 *
 * 保存されるのは `%APPDATA%/Fluvix Nexus/editor-settings.json`
 * （app.getPath('userData') 配下。jsonStore.ts が決める）。
 * ウィンドウ状態・レイアウト・Workspace と同じ場所で、
 * **プロジェクトフォルダの中には何も書かない**。設定はその人の道具の形であって、
 * プロジェクトの持ち物ではないため。
 *
 * ファイルを分けているのは用途が違うから（ARCHITECTURE.md §5）。
 * レイアウトの API に相乗りさせると「Workspace レイアウト専用」という限定が崩れる。
 *
 * **Renderer は保存先を知らない。** パスもファイル名も指定できず、
 * 渡せるのは文書の中身だけ（shared/ipc/contracts/settings.ts）。
 */

const STORE_FILE_NAME = 'editor-settings.json'

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let store: JsonStore<EditorSettingsDocument> | null = null

function getStore(): JsonStore<EditorSettingsDocument> {
  store ??= createJsonStore(STORE_FILE_NAME, parseEditorSettingsDocument)
  return store
}

/** 保存済みの文書。未保存・破損・想定外の内容なら null。 */
export function readEditorSettingsDocument(): EditorSettingsDocument | null {
  return getStore().read()
}

/** 文書の保存を予約する。 */
export function saveEditorSettingsDocument(document: EditorSettingsDocument): void {
  getStore().save(document)
}

/**
 * 予約済みの書き込みを即座に反映する。
 *
 * 終了時に呼ぶ（app の will-quit）。設定を変えた直後に終了しても
 * 次回起動で保たれるようにするための保険。
 */
export function flushEditorSettingsDocument(): void {
  // 一度も使っていなければ保存すべきものも無い（ここでストアを作る必要は無い）。
  store?.flush()
}
