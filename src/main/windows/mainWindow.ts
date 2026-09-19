import { BrowserWindow } from 'electron'
import { join } from 'path'
import { normalizeLanguageId, toLanguageArgument } from '@shared/language'
import { normalizeThemeId, THEME_WINDOW_BACKGROUND, toThemeArgument } from '@shared/theme'
import { devServerUrl } from '../app/runtime'
import { readEffectiveSettingsSections, readUserSettingsSections } from '../store/settings'
import { MINIMUM_WINDOW_SIZE } from '../store/windowBounds'
import { resolveInitialWindowState, trackWindowState } from '../store/windowState'
import { guardWindowClose } from './closeGuard'

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

/**
 * 保存済みの Theme（Session 4-4）。
 *
 * Renderer の描画前に見える色を決めるためだけに読む。**Main が Theme について
 * 知っているのはこの1点だけ**で、36色の中身も、どこにどう効くかも知らない
 * （持ち主は Renderer ── renderer/src/theme/useAppearance.ts）。
 *
 * ## なぜ Main が読む必要があるか
 *
 * 窓は Renderer が動き出すより前に画面へ出る。そのとき塗られるのは
 * `backgroundColor` で、これを Dark 固定にしていると **Light を選んでいる人には
 * 起動のたびに一瞬だけ黒い窓が出る**（Session 4-3B までの状態）。
 * 消すには、Renderer より前に Theme を知っている必要がある。
 *
 * ## 状態を二重に持ってはいない
 *
 * ここは**読むだけ**で、書かないし、変わったことも知らない。正本は
 * `settings.json` の `appearance.theme` 1つにほかならず、Renderer が
 * それを載せている。次の起動でまたここが読む、という向きだけがある。
 *
 * 読めない値・知らない Theme 名は既定（Dark）へ落とす ── Preload も
 * Renderer も同じ `normalizeThemeId` を通るので、**起動直後の色と
 * 読み込み後の色が食い違うことがない。**
 */
function resolveInitialTheme(): ReturnType<typeof normalizeThemeId> {
  // ワークスペース設定で Theme を変えている Workspace なら、その色で最初の1枚を塗る。
  return normalizeThemeId(readEffectiveSettingsSections().appearance.theme)
}

function resolveInitialLanguage(): ReturnType<typeof normalizeLanguageId> {
  // 表示言語はユーザー設定でだけ変えられる（shared/settings/scope.ts）。
  return normalizeLanguageId(readUserSettingsSections().general.language)
}

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
  const initialTheme = resolveInitialTheme()
  const initialLanguage = resolveInitialLanguage()

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
    // 最初の1枚。Renderer の描画前に、Theme と違う色が一瞬見えるのを防ぐ。
    backgroundColor: THEME_WINDOW_BACKGROUND[initialTheme],
    webPreferences: {
      // Renderer から OS へ直接触れさせないための設定。
      // Renderer が使えるのは preload が contextBridge で公開した API のみ。
      preload: join(__dirname, '../preload/index.js'),
      /*
        Preload へ渡す唯一の値（Session 4-4）。IPC を使わないのは、**IPC は
        Renderer が動き出してからしか使えず、それでは間に合わない**ため ──
        Preload はこれを読んで、HTML の解析が始まる前に `<html>` へ当てる
        （preload/theme.ts）。渡るのは Theme の名前1つだけで、
        Renderer から Node / fs / process へ触れる経路は増えていない。
      */
      additionalArguments: [toThemeArgument(initialTheme), toLanguageArgument(initialLanguage)],
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

  /*
    閉じる前に未保存の確認を挟む（closeGuard.ts）。
    ウィンドウの × も Alt+F4 も app.quit() による終了も、すべて 'close' を通るため
    ここ1箇所で足りる。ウィンドウが増えても掛け忘れないよう、生成の直後に置く
    （security/ が webContents 単位でガードを掛けているのと同じ考え方）。
  */
  guardWindowClose(window)

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
