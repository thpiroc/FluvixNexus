import type { FilesSettingsDocument } from '@shared/settings'
import { createJsonStore, type JsonStore } from './jsonStore'
import { parseFilesSettingsDocument } from './filesSettingsDocument'

/**
 * Files の見え方（表示方式・カラムの幅）の保存先（Session 3-6-8）。
 *
 * 保存されるのは `%APPDATA%/Fluvix Nexus/files-settings.json`
 * （app.getPath('userData') 配下。jsonStore.ts が決める）。
 * ウィンドウ状態・レイアウト・Workspace・Editor 設定と同じ場所で、
 * **プロジェクトフォルダの中には何も書かない**。見え方はその人の道具の形であって、
 * プロジェクトの持ち物ではないため。
 *
 * ファイルを分けているのは用途が違うから（ARCHITECTURE.md §5）。
 * Editor 設定へ相乗りさせると「Editor の設定」という限定が最初の相乗りで消える。
 *
 * **Renderer は保存先を知らない。** パスもファイル名も指定できず、
 * 渡せるのは文書の中身だけ（shared/ipc/contracts/settings.ts）。
 */

const STORE_FILE_NAME = 'files-settings.json'

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let store: JsonStore<FilesSettingsDocument> | null = null

function getStore(): JsonStore<FilesSettingsDocument> {
  store ??= createJsonStore(STORE_FILE_NAME, parseFilesSettingsDocument)
  return store
}

/** 保存済みの文書。未保存・破損・想定外の内容なら null。 */
export function readFilesSettingsDocument(): FilesSettingsDocument | null {
  return getStore().read()
}

/** 文書の保存を予約する。 */
export function saveFilesSettingsDocument(document: FilesSettingsDocument): void {
  getStore().save(document)
}

/**
 * 予約済みの書き込みを即座に反映する。
 *
 * 終了時に呼ぶ（app の will-quit）。表示方式を切り替えた直後に終了しても
 * 次回起動で保たれるようにするための保険。
 */
export function flushFilesSettingsDocument(): void {
  // 一度も使っていなければ保存すべきものも無い（ここでストアを作る必要は無い）。
  store?.flush()
}
