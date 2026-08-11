import { BrowserWindow } from 'electron'
import { join } from 'path'
import { devServerUrl } from '../app/runtime'
import { MINIMUM_WINDOW_SIZE } from '../store/windowBounds'
import { resolveInitialWindowState, trackWindowState } from '../store/windowState'

/**
 * ウィンドウ管理の責務を持つモジュール。
 *
 * BrowserWindow の生成条件・セキュリティ設定・描画対象の読み込みはここに閉じる。
 * アプリのライフサイクル制御（いつ開くか / いつ終了するか）は app/lifecycle.ts の責務とし、
 * このモジュールからは app のイベントを購読しない。
 *
 * 遷移・新規ウィンドウ・権限の制御は security/ が webContents 単位で一括して掛けるため、
 * ここでは webPreferences の設定だけを持つ。
 */

/** ウィンドウの初期背景色。Renderer の描画前に白い画面が一瞬見えるのを防ぐ。 */
const WINDOW_BACKGROUND = '#1e1e1e'

/**
 * 現在のメインウィンドウ。
 *
 * 「もう開いているか」を BrowserWindow.getAllWindows() で判定すると、
 * 将来 GitHub パネルなどを独立ウィンドウとして開いた時点で意味が変わってしまう。
 * メインウィンドウの参照はこのモジュールが保持し、外部へは getMainWindow() で渡す。
 */
let mainWindow: BrowserWindow | null = null

function loadRenderer(window: BrowserWindow): void {
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 既に開いているメインウィンドウを前面に出す。二重起動時の復帰などで使う。 */
export function focusMainWindow(): void {
  if (mainWindow === null) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.focus()
}

export function createMainWindow(): BrowserWindow {
  const initialState = resolveInitialWindowState()

  const window = new BrowserWindow({
    // 前回終了時のサイズ・位置を引き継ぐ（保存が無い / 位置が画面外の場合は既定値）。
    ...(initialState.x !== undefined && initialState.y !== undefined
      ? { x: initialState.x, y: initialState.y }
      : {}),
    width: initialState.width,
    height: initialState.height,
    minWidth: MINIMUM_WINDOW_SIZE.width,
    minHeight: MINIMUM_WINDOW_SIZE.height,
    title: 'Fluvix Nexus',
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: {
      // Renderer から OS へ直接触れさせないための設定。
      // Renderer が使えるのは preload が contextBridge で公開した API のみ。
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Preload は contextBridge / ipcRenderer しか使わないため sandbox を有効にできる。
      // OS に触れる処理は Main Process 側にあり、Preload には持ち込まないこと（この前提が崩れると起動しなくなる）。
      sandbox: true,
      // Renderer 側で webview を使う予定はないため明示的に無効化する。
      webviewTag: false
    }
  })

  mainWindow = window
  window.on('closed', () => {
    mainWindow = null
  })

  if (initialState.isMaximized) {
    window.maximize()
  }

  trackWindowState(window)

  window.once('ready-to-show', () => {
    window.show()
  })

  loadRenderer(window)

  return window
}
