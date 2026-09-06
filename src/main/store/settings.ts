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

/**
 * 保存された section の知らせ（Session 5-4）。
 *
 * Session 4-3A の時点で、**保存された設定を Main が読み返す理由は無かった**
 * ── どの設定も効くのは Renderer の中だけで、Main は保存先を持つだけの層に
 * 留まっていた。`lsp` section がその前提から外れる最初のもので、
 * 有効 / 無効はプロセスを立てる / 終わらせる Main の側で効く
 * （shared/lsp/serverSettings.ts）。
 *
 * そこで「保存された」ことだけを知らせる。**この層は誰が聞いているかを知らない**
 * ── ここから個別の機能を呼ぶ形にすると、保存先が LSP の都合を持つことになる
 * （main/workspaceFolder/currentWorkspaceFolder.ts と同じ理由）。
 */
export type SettingsSectionSavedListener = (update: SettingsSectionUpdate) => void

const savedListeners = new Set<SettingsSectionSavedListener>()

/** 設定が保存されたときに呼ばれる。戻り値は購読の解除。 */
export function onSettingsSectionSaved(listener: SettingsSectionSavedListener): () => void {
  savedListeners.add(listener)

  return () => {
    savedListeners.delete(listener)
  }
}

/** 1つの section の保存を予約する。 */
export function saveSettingsSection(update: SettingsSectionUpdate): void {
  getStore().saveSection(update)

  /*
    知らせるのは保存を予約した後。受け手（main/lsp/languageServerSettings.ts）は
    ディスクではなくこの値を読むので、間引きの待ち時間は関わらない
    ── 押した瞬間にサーバが止まる / 立ち上がる必要がある。
  */
  for (const listener of savedListeners) {
    try {
      listener(update)
    } catch (cause) {
      // 受け手の失敗で、設定の保存そのものを失敗にしない。
      log.error('a settings listener failed.', cause)
    }
  }
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
