import type { WorkspaceLayoutDocument } from '@shared/workspace'
import { createJsonStore, type JsonStore } from './jsonStore'
import { parseWorkspaceLayoutDocument } from './workspaceLayoutDocument'

/**
 * Workspace レイアウトの保存先。
 *
 * 保存されるのは `%APPDATA%/Fluvix Nexus/workspace-layout.json`
 * （app.getPath('userData') 配下。jsonStore.ts が決める）。
 * プロジェクトフォルダやインストール先には書かない ── レイアウトは「アプリの設定」であって
 * 特定のプロジェクトの持ち物ではないため。
 *
 * ウィンドウ状態（store/windowState.ts）と同じ形をしており、
 * 保存先の決定・書き込みの間引き・一時ファイル経由の差し替え・破損時の扱いは
 * すべて jsonStore.ts から引き継ぐ。ここが持つのは「どのファイル名で」
 * 「どの検証を通して」読み書きするかだけ。
 *
 * 書き込みの間引きは2段になっている。
 *   Renderer 側 … レイアウトが変わってから 400ms（ドラッグ中は IPC を送らない）
 *   Main 側     … 依頼を受けてから 400ms（jsonStore）
 * ドラッグやリサイズのように毎フレーム値が変わる操作でも、ディスクへの書き込みは
 * 操作が終わった後の1回になる。
 */

const STORE_FILE_NAME = 'workspace-layout.json'

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let store: JsonStore<WorkspaceLayoutDocument> | null = null

function getStore(): JsonStore<WorkspaceLayoutDocument> {
  store ??= createJsonStore(STORE_FILE_NAME, parseWorkspaceLayoutDocument)
  return store
}

/** 保存済みのレイアウト文書。未保存・破損・想定外の内容なら null。 */
export function readWorkspaceLayoutDocument(): WorkspaceLayoutDocument | null {
  return getStore().read()
}

/** レイアウト文書の保存を予約する。連続した依頼は最後の1回にまとめられる。 */
export function saveWorkspaceLayoutDocument(document: WorkspaceLayoutDocument): void {
  getStore().save(document)
}

/**
 * 予約済みの書き込みを即座に反映する。
 *
 * 終了時に呼ぶ（app の will-quit）。通常操作中も間引きの範囲で保存され続けるため、
 * これは「最後の数百 ms を取りこぼさない」ための保険であって、保存の主経路ではない。
 */
export function flushWorkspaceLayoutDocument(): void {
  // 一度も使っていなければ保存すべきものも無い（ここでストアを作る必要は無い）。
  store?.flush()
}
