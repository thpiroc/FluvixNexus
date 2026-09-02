import { app } from 'electron'
import type { SettingsSections, SettingsSectionUpdate } from '@shared/settings'
import { createLogger } from '../logger'
import { createSettingsStore, type SettingsStore } from './settingsStore'

/**
 * アプリ設定の保存先（Session 4-3A）。
 *
 * 保存されるのは `%APPDATA%/Fluvix Nexus/settings.json`
 * （app.getPath('userData') 配下）。ウィンドウ状態・レイアウト・Workspace と
 * 同じ場所で、**プロジェクトフォルダの中には何も書かない** ── 設定はその人の
 * 道具の形であって、プロジェクトの持ち物ではないため。
 *
 * このファイルが持つのは Electron に関わる2つだけで、
 *
 *   - 保存先のフォルダ（userData）を決める
 *   - 読み込みで落ちたものをログに出す
 *
 * 読み書きそのものは store/settingsStore.ts にある（Electron 非依存・テスト対象）。
 * Session 3-7-5 まではこの形の薄いファイルが用途ごとに3つあったが、
 * 保存先が1つになったのでこれも1つになった。
 *
 * **Renderer は保存先を知らない。** パスもファイル名も指定できず、渡せるのは
 * 「どの section を、どんな値にするか」だけ（shared/ipc/contracts/settings.ts）。
 */

const log = createLogger('settings')

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let store: SettingsStore | null = null

function getStore(): SettingsStore {
  store ??= createSettingsStore(app.getPath('userData'), {
    onIssue: (message, ...details) => {
      log.warn(message, ...details)
    }
  })
  return store
}

/** 保存済みの設定。未保存・破損の section は空（＝既定で始まる）。 */
export function readSettingsSections(): SettingsSections {
  return getStore().read()
}

/** 1つの section の保存を予約する。 */
export function saveSettingsSection(update: SettingsSectionUpdate): void {
  getStore().saveSection(update)
}

/**
 * 予約済みの書き込みを即座に反映する。
 *
 * 終了時に呼ぶ（app の will-quit）。設定を変えた直後に終了しても
 * 次回起動で保たれるようにするための保険。
 */
export function flushSettingsDocument(): void {
  // 一度も使っていなければ保存すべきものも無い（ここでストアを作る必要は無い）。
  store?.flush()
}
