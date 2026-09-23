import { relative, sep } from 'path'
import { dialog, type BrowserWindow } from 'electron'
import { isDevelopment } from '../../app/runtime'
import { createLogger } from '../../logger'
import { getCurrentWorkspaceFolder } from '../../workspaceFolder/currentWorkspaceFolder'
import { runAgentTerminalCommand } from './currentTerminalRunGate'

/**
 * 開発中だけの、Terminal Command Runner を手で動かすための足場（Security Core v1 の STEP8）。
 *
 * STEP7 の fileWriteHarness.ts と同じ作り。Agent Loop がまだ無いため、**Runner を呼ぶ側が
 * 存在しない。** 実機で「提案 → 確認 → 続行 → Native 確認 → 起動 → 伏せた出力 → Audit」を
 * 通して確かめるために、開発用のメニュー項目からだけ Runner を呼べるようにしてある。
 *
 * ## 本番の Surface には出ない
 *
 * ```
 * 出さない   IPC チャンネル・Preload の API・Renderer から呼べる関数
 * 出る場所   開発時だけ作られるネイティブメニュー（app/menu.ts）
 * 二重の鍵   isDevelopment（= !app.isPackaged）でも確かめる
 * ```
 *
 * **コマンドは固定の一覧から選ぶだけ。** 任意のコマンドを打ち込める欄は作らない ──
 * 開発用であっても「Renderer から任意のコマンドを渡せる口」は、条件を1つ間違えるだけで
 * 本番の経路になる。
 *
 * ## Runner を迂回しない
 *
 * ここが行うのは「決まった command / args / cwd で `runAgentTerminalCommand` を呼ぶ」だけ。
 * Policy も Boundary も PATH の解決も承認も、**Agent が呼んだときとまったく同じ**に通る。
 * 拒否される組み合わせ（.cmd へ危険な文字・Workspace の外の作業ディレクトリ）を試すのも、
 * この足場の用途にあたる。
 */

const log = createLogger('security')

/** 足場から試せるもの。 */
export type TerminalHarnessScenario =
  | 'node-version'
  | 'npm-version'
  | 'git-status'
  | 'secret-output'
  | 'unsafe-batch-argument'
  | 'timeout'

interface HarnessCommand {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * 固定の一覧。
 *
 * `secret-output` は **Secret らしき値をコマンドの出力にだけ**出す（引数の文字列には
 * 値そのものが入らないよう、実行時に組み立てる）── 出力の Mask を確かめるため。
 * 値はどれも本物ではない。
 */
const SCENARIOS: Readonly<Record<TerminalHarnessScenario, HarnessCommand>> = Object.freeze({
  'node-version': { command: 'node', args: ['--version'] },
  'npm-version': { command: 'npm', args: ['--version'] },
  'git-status': { command: 'git', args: ['status', '--short', '--branch'] },
  'secret-output': {
    command: 'node',
    args: [
      '-e',
      [
        "const t = 'ghp_' + 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Y'.slice(0, 36);",
        "const k = '-----BEGIN ' + 'PRIVATE KEY-----';",
        "const e = '-----END ' + 'PRIVATE KEY-----';",
        "console.log('before the secrets');",
        "console.log('GITHUB_TOKEN=' + t);",
        "console.log(k); console.log('MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'); console.log(e);",
        "console.log('after the secrets');"
      ].join(' ')
    ]
  },
  'unsafe-batch-argument': { command: 'npm', args: ['run', 'x&whoami'] },
  timeout: { command: 'node', args: ['-e', 'setTimeout(() => {}, 180000)'] }
})

/** 開発用の足場を使える状態か。 */
export function canUseTerminalRunHarness(): boolean {
  return isDevelopment
}

/** 決まったコマンドを Workspace root で提案する。 */
export async function proposeHarnessCommand(
  window: BrowserWindow,
  scenario: TerminalHarnessScenario
): Promise<void> {
  if (!canUseTerminalRunHarness()) {
    return
  }

  if (workspaceRootPath() === null) {
    await inform(window, 'Workspace を開いてから試してください。')
    return
  }

  await run(window, SCENARIOS[scenario], '')
}

/**
 * 作業ディレクトリを選び、そこで `node --version` を提案する。
 *
 * 選ばせるのにネイティブのフォルダ選択を使うのは、**Renderer に経路を作らない**ため。
 * Workspace の外を選べば Boundary が拒否する（拒否される様子を確かめられる）。
 */
export async function proposeHarnessCommandInFolder(window: BrowserWindow): Promise<void> {
  if (!canUseTerminalRunHarness()) {
    return
  }

  const rootPath = workspaceRootPath()

  if (rootPath === null) {
    await inform(window, 'Workspace を開いてから試してください。')
    return
  }

  const picked = await dialog.showOpenDialog(window, {
    title: 'FN Agent がコマンドを実行する場所を選ぶ（開発用）',
    defaultPath: rootPath,
    properties: ['openDirectory']
  })

  if (picked.canceled || picked.filePaths.length !== 1) {
    return
  }

  await run(
    window,
    SCENARIOS['node-version'],
    toWorkspaceRelativePath(rootPath, picked.filePaths[0])
  )
}

/**
 * Runner を呼ぶ。
 *
 * 実行した場合の結果は Renderer の確認の画面が見せる。**起動する前に拒否された場合だけ**、
 * 画面が出ないため理由をここで知らせる（理由は Audit へ載る閉じた語）。
 */
async function run(window: BrowserWindow, harness: HarnessCommand, cwd: string): Promise<void> {
  const outcome = await runAgentTerminalCommand({
    command: harness.command,
    args: [...harness.args],
    cwd
  })

  if (outcome.ok) {
    log.info(`the development harness ran an agent command (exit ${String(outcome.exitCode)}).`)
    return
  }

  log.info(`the development harness was refused: ${outcome.reason}.`)

  if (outcome.output === null && !window.isDestroyed()) {
    await inform(window, `実行しませんでした（理由: ${outcome.reason}）。`)
  }
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
 * Boundary（STEP2）/ 承認の正規化（STEP6）がそれを拒否する。
 */
function toWorkspaceRelativePath(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).split(sep).join('/')
}

async function inform(window: BrowserWindow, message: string): Promise<void> {
  await dialog.showMessageBox(window, {
    type: 'info',
    title: 'FN Agent Terminal（開発用）',
    message,
    buttons: ['OK'],
    noLink: true
  })
}
