import { app } from 'electron'
import type { LoadKeybindingsResponse } from '@shared/ipc'
import type { StoredKeybindingEntry } from '@shared/keybindings'
import { createLogger } from '../logger'
import { createKeybindingsStore, type KeybindingsStore } from './keybindingsStore'

/**
 * ユーザーのキー割り当ての保存先（Shortcuts S3）。
 *
 * 保存されるのは `%APPDATA%/Fluvix Nexus/keybindings.json`
 * （app.getPath('userData') 配下）。設定と同じ場所で、**Workspace の中には
 * 何も書かない**（キー割り当てはその人の道具の形で、プロジェクトの持ち物ではない）。
 *
 * このファイルが持つのは Electron に関わる2つだけ（store/settings.ts と同じ形）。
 *
 *   - 保存先のフォルダ（userData）を決める
 *   - 読み込み・保存で起きたことをログに出す
 *
 * 読み書きそのものは store/keybindingsStore.ts にある（Electron 非依存・テスト対象）。
 */

const log = createLogger('keybindings')

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let store: KeybindingsStore | null = null

function getStore(): KeybindingsStore {
  store ??= createKeybindingsStore(app.getPath('userData'), {
    onIssue: (message, ...details) => {
      log.warn(message, ...details)
    }
  })
  return store
}

/** 保存済みの割り当て。無い・壊れている場合は行が空（＝既定の割り当てだけで動く）。 */
export function readKeybindings(): LoadKeybindingsResponse {
  return getStore().read()
}

/** 割り当ての保存を予約する。 */
export function saveKeybindings(entries: readonly StoredKeybindingEntry[]): void {
  getStore().save(entries)
}

/**
 * 予約済みの書き込みを即座に反映する。
 *
 * 終了時に呼ぶ（app の will-quit）。
 */
export function flushKeybindingsDocument(): void {
  // 一度も使っていなければ保存すべきものも無い（ここでストアを作る必要は無い）。
  store?.flush()
}
