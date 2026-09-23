import { relative, sep } from 'path'
import { dialog, type BrowserWindow } from 'electron'
import { isDevelopment } from '../../app/runtime'
import { createLogger } from '../../logger'
import { getCurrentWorkspaceFolder } from '../../workspaceFolder/currentWorkspaceFolder'
import { writeAgentWorkspaceFile } from './currentFileWriteGate'

/**
 * 開発中だけの、File Write Gate を手で動かすための足場（Security Core v1 の STEP7）。
 *
 * Agent Loop（STEP9 以降）がまだ無いため、**Gate を呼ぶ側が存在しない。** 実機で
 * 「提案 → Diff → 続行 → Native 確認 → 書き込み → Audit」を通して確かめるために、
 * 開発用のメニュー項目からだけ Gate を呼べるようにしてある。
 *
 * ## 本番の Surface には出ない
 *
 * ```
 * 出さない   IPC チャンネル・Preload の API・Renderer から呼べる関数
 * 出る場所   開発時だけ作られるネイティブメニュー（app/menu.ts。配布ビルドでは
 *            Menu.setApplicationMenu(null) によりメニューそのものが無い）
 * 二重の鍵   isDevelopment（= !app.isPackaged）でも確かめる。
 *            メニューの側の条件が変わっても、ここが通らなければ何も起きない
 * ```
 *
 * **危険な debug IPC は足さない。** 「Renderer から任意のパスへ書ける口」を開発用に
 * 作ると、それは本番でも動く経路になる（条件を1つ間違えただけで露出する）。
 *
 * ## Gate を迂回しない
 *
 * ここが行うのは「書き込み先と本文を決めて `writeAgentWorkspaceFile` を呼ぶ」だけ。
 * Boundary も Policy も Secret も承認も、**Agent が呼んだときとまったく同じ**に通る。
 * 選んだ場所が Workspace の外なら Gate が拒否し、`.env` を選べば Secret ファイルとして
 * 拒否される ── 拒否される様子を確かめるのも、この足場の用途にあたる。
 */

const log = createLogger('security')

/** 提案する本文に足す1行（何が変わるか一目で分かるもの）。 */
const MARKER = '// FN Agent (development harness) wrote this line.'

/** 新しいファイルへ提案する本文。 */
const NEW_FILE_CONTENT = [
  MARKER,
  '',
  'これは FN Agent File Write Gate の動作確認用のファイルです。',
  '削除して構いません。',
  ''
].join('\n')

/** 開発用の足場を使える状態か。 */
export function canUseFileWriteHarness(): boolean {
  return isDevelopment
}

/**
 * 既存のファイルを選び、末尾へ1行足す変更を提案する。
 *
 * 選ばせるのにネイティブのファイル選択を使うのは、**Renderer に経路を作らない**ため。
 */
export async function proposeHarnessWriteToExistingFile(window: BrowserWindow): Promise<void> {
  if (!canUseFileWriteHarness()) {
    return
  }

  const rootPath = workspaceRootPath()

  if (rootPath === null) {
    await warn(window, 'Workspace を開いてから試してください。')
    return
  }

  const picked = await dialog.showOpenDialog(window, {
    title: 'FN Agent が変更を提案するファイルを選ぶ（開発用）',
    defaultPath: rootPath,
    properties: ['openFile']
  })

  if (picked.canceled || picked.filePaths.length !== 1) {
    return
  }

  const relativePath = toWorkspaceRelativePath(rootPath, picked.filePaths[0])

  /*
    今の中身は読まない ── 読んで足すと、この足場が「ファイルを読む経路」にもなる。
    本文は固定の1行だけにして、Gate が作る Diff（今の中身 → この1行）で確かめる。
  */
  await run(relativePath, `${MARKER}\n`)
}

/** 新しいファイルの位置を選び、作成を提案する。 */
export async function proposeHarnessWriteToNewFile(window: BrowserWindow): Promise<void> {
  if (!canUseFileWriteHarness()) {
    return
  }

  const rootPath = workspaceRootPath()

  if (rootPath === null) {
    await warn(window, 'Workspace を開いてから試してください。')
    return
  }

  const picked = await dialog.showSaveDialog(window, {
    title: 'FN Agent が作成を提案する位置を選ぶ（開発用）',
    defaultPath: rootPath,
    properties: ['showOverwriteConfirmation']
  })

  if (picked.canceled || picked.filePath === undefined) {
    return
  }

  await run(toWorkspaceRelativePath(rootPath, picked.filePath), NEW_FILE_CONTENT)
}

/**
 * Gate を呼ぶ。
 *
 * 結末はログにだけ残す（Audit は Gate 自身が記録する）。**結末を理由に
 * もう一度書き直すことはしない。**
 */
async function run(relativePath: string, content: string): Promise<void> {
  const outcome = await writeAgentWorkspaceFile(relativePath, content)

  log.info(
    outcome.ok
      ? 'the development harness completed an agent file write.'
      : `the development harness was refused: ${outcome.reason}.`
  )
}

function workspaceRootPath(): string | null {
  try {
    return getCurrentWorkspaceFolder()?.rootPath ?? null
  } catch {
    return null
  }
}

/**
 * 選ばれた絶対パスを Workspace 相対の綴りにする。
 *
 * **ここで境界を判断しない。** Workspace の外なら `..` を含む綴りになり、
 * Boundary（STEP2）がそれを拒否する ── 拒否されることを確かめられる形にしておく。
 */
function toWorkspaceRelativePath(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).split(sep).join('/')
}

async function warn(window: BrowserWindow, message: string): Promise<void> {
  await dialog.showMessageBox(window, {
    type: 'info',
    title: 'FN Agent File Write（開発用）',
    message,
    buttons: ['OK'],
    noLink: true
  })
}
