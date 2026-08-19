import type { WorkspaceFolderDocument } from '@shared/workspace'
import { createJsonStore, type JsonStore } from './jsonStore'
import { parseWorkspaceFolderDocument } from './workspaceFolderDocument'

/**
 * 「最後に開いていた Workspace」の保存先。
 *
 * 保存されるのは `%APPDATA%/Fluvix Nexus/workspace-folder.json`
 * （app.getPath('userData') 配下。jsonStore.ts が決める）。
 * ウィンドウ状態・レイアウトと同じ場所で、**プロジェクトフォルダの中には何も書かない**。
 * 「どのフォルダを開いていたか」はアプリ側の設定であって、そのフォルダの持ち物ではないため。
 *
 * ファイルを分けているのは用途が違うから（ARCHITECTURE.md §5）。
 * レイアウトの API に相乗りさせると「Workspace レイアウト専用」という限定が崩れる。
 *
 * 書き込みの頻度はレイアウトと違い「フォルダを開く / 閉じる」のときだけなので、
 * jsonStore の間引き（400ms）はそのまま素通りする。それでも同じ仕組みに載せているのは、
 * 一時ファイル経由の差し替え（書き込み中に落ちてもファイルが壊れない）と
 * 破損時の扱いを共通にしておくため。
 */

const STORE_FILE_NAME = 'workspace-folder.json'

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let store: JsonStore<WorkspaceFolderDocument> | null = null

function getStore(): JsonStore<WorkspaceFolderDocument> {
  store ??= createJsonStore(STORE_FILE_NAME, parseWorkspaceFolderDocument)
  return store
}

/** 保存済みの文書。未保存・破損・想定外の内容なら null。 */
export function readWorkspaceFolderDocument(): WorkspaceFolderDocument | null {
  return getStore().read()
}

/** 文書の保存を予約する。 */
export function saveWorkspaceFolderDocument(document: WorkspaceFolderDocument): void {
  getStore().save(document)
}

/**
 * 予約済みの書き込みを即座に反映する。
 *
 * 終了時に呼ぶ（app の will-quit）。フォルダを開いた直後に終了しても
 * 次回起動で復元できるようにするための保険。
 */
export function flushWorkspaceFolderDocument(): void {
  // 一度も使っていなければ保存すべきものも無い（ここでストアを作る必要は無い）。
  store?.flush()
}
