import { screen, type BrowserWindow } from 'electron'
import { createLogger } from '../logger'
import { createJsonStore, type JsonStore } from './jsonStore'
import {
  DEFAULT_WINDOW_SIZE,
  isBoundsVisible,
  parseWindowState,
  type WindowState
} from './windowBounds'

/**
 * ウィンドウのサイズ・位置・最大化状態を、次回起動時に復元できるよう保存する。
 *
 * 「前回と同じ場所に同じ大きさで開く」ことは、常時起動して使う開発ツールでは
 * 体感品質に直結するため STEP 1 の時点で入れておく。
 *
 * レイアウトプリセット（DESIGN.md §3）も同じ store/ 層へ追加する想定であり、
 * 保存先・書き込みの間引き・破損時の扱いは jsonStore.ts の仕組みをそのまま再利用する。
 */

const log = createLogger('window-state')

const STORE_FILE_NAME = 'window-state.json'

/**
 * app.getPath('userData') は app の準備後に確定するため、モジュール読み込み時ではなく
 * 最初に使う時点でストアを作る。
 */
let store: JsonStore<WindowState> | null = null

function getStore(): JsonStore<WindowState> {
  store ??= createJsonStore(STORE_FILE_NAME, parseWindowState)
  return store
}

/** BrowserWindow の生成時に渡す初期状態。位置が信用できない場合は x / y を持たない。 */
export interface InitialWindowState {
  readonly x?: number
  readonly y?: number
  readonly width: number
  readonly height: number
  readonly isMaximized: boolean
}

export function resolveInitialWindowState(): InitialWindowState {
  const saved = getStore().read()

  if (saved === null) {
    return { ...DEFAULT_WINDOW_SIZE, isMaximized: false }
  }

  const workAreas = screen.getAllDisplays().map((display) => display.workArea)

  if (!isBoundsVisible(saved.bounds, workAreas)) {
    // モニタ構成が変わった場合。サイズだけ引き継ぎ、位置は OS 標準の配置に任せる。
    log.info('saved window position is outside the current displays; restoring size only.')
    return {
      width: saved.bounds.width,
      height: saved.bounds.height,
      isMaximized: saved.isMaximized
    }
  }

  return { ...saved.bounds, isMaximized: saved.isMaximized }
}

/** ウィンドウの変化を購読し、状態を保存し続ける。 */
export function trackWindowState(window: BrowserWindow): void {
  const persist = (): void => {
    // 最大化中の getBounds() は画面いっぱいの値を返してしまう。
    // 復元したいのは「元に戻したときの大きさ」なので getNormalBounds() を使う。
    getStore().save({
      bounds: window.getNormalBounds(),
      isMaximized: window.isMaximized()
    })
  }

  // BrowserWindow.on はイベント名ごとにシグネチャが分かれているため、まとめずに個別に登録する。
  window.on('resize', persist)
  window.on('move', persist)
  window.on('maximize', persist)
  window.on('unmaximize', persist)

  // 閉じる操作は保存を待ってくれないため、この時点で書き込みまで済ませる。
  window.once('close', () => {
    persist()
    getStore().flush()
  })
}
