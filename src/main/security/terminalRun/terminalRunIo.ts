import { execFile, spawn, type ChildProcess } from 'child_process'
import { existsSync, statSync } from 'fs'
import { realpath, stat } from 'fs/promises'
import { trimTrailingSeparator } from '../../platform/executablePath'
import { createTerminalEnvironment } from '../../terminal/terminalEnvironment'
import type { TerminalLaunchSpec } from './terminalLaunch'
import {
  createTerminalOutputCollector,
  type CapturedTerminalOutput,
  type TerminalOutputCollector
} from './terminalOutput'

/**
 * 実際にプロセスを起動する・実行ファイルを確かめる部分（Security Core v1 の STEP8）。
 *
 * **`child_process` を読むのは Security Core の中でここだけ**（terminalRunSurface.test.ts が
 * 見ている）。`exec` / `execSync` / `shell: true` は使わない ── どれも1本の文字列を
 * シェルに解釈させる形で、承認した argv との対応がシェルの読み方に委ねられる。
 *
 * ```
 * 起動       spawn(実体, args, { shell: false, stdin: 'ignore', windowsHide })
 * 環境変数   人間用 Terminal と同じ（Electron 由来の2つだけ落とす。terminalEnvironment.ts）
 * 入力       渡さない（stdin は閉じる）── 入力を待つコマンドは、待たずに終わる
 * 出力       stdout / stderr を集める（先頭から上限まで。terminalOutput.ts）
 * 時間       120 秒で打ち切る。子プロセスごと終了させる（taskkill /T /F）
 * ```
 *
 * ## 人間用 Terminal とは別の経路
 *
 * node-pty（terminal/terminalSessions.ts）も `terminal:write` も使わない。あちらは
 * 利用者が打ち込むための対話的な端末で、Renderer から入力を送れる。Agent の実行を
 * そこへ流すと、**承認していない入力が同じシェルへ混ざりうる**うえ、出力も伏せずに
 * 画面へ出る。
 *
 * ## 残るもの（DESIGN.md §6.4 に記録）
 *
 * コマンドが自分で起動し、親から切り離したプロセス（常駐するサーバなど）は、
 * 打ち切りの後も残りうる。これは利用者が承認したコマンド自身の振る舞いにあたる。
 */

/** 実行の時間の上限（2026-09-23 確定。固定）。 */
export const TERMINAL_RUN_TIMEOUT_MS = 120_000

/**
 * 本体のプロセスが終わった後、出力の管が閉じるのを待つ時間。
 *
 * 本体が終わっても、本体が起動した子が管を握っていると `close` が来ない。
 * そのまま 120 秒待たせないため、少し待って閉じる。
 */
const CLOSE_GRACE_MS = 2_000

/** 打ち切った後、出力の管が閉じるのを待つ時間。 */
const KILL_GRACE_MS = 5_000

/** 実行ファイルの identity（承認の前と実行の直前で比べる）。 */
export interface ExecutableIdentity {
  /** リンクを解いた後の実体。**Main の中だけで使う**（画面・Audit へは出さない）。 */
  readonly realPath: string
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
}

/** 実行ファイルを確かめる。ファイルでなければ・読めなければ `null`。 */
export async function inspectExecutable(file: string): Promise<ExecutableIdentity | null> {
  try {
    const realPath = await realpath(file)
    const stats = await stat(realPath, { bigint: true })

    if (!stats.isFile()) {
      return null
    }

    return Object.freeze({
      realPath,
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      mtimeNs: stats.mtimeNs
    })
  } catch {
    return null
  }
}

/** 同じ実体か。 */
export function isSameExecutable(a: ExecutableIdentity, b: ExecutableIdentity): boolean {
  return (
    a.realPath === b.realPath &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs
  )
}

/** PATH の探索で使う「そこにファイルがあるか」。 */
export function executableExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/** 実行の結果。出力は**まだ伏せていない**（Gate が terminalOutput.ts で伏せる）。 */
export type RunProcessResult =
  | {
      readonly kind: 'exited'
      readonly exitCode: number | null
      readonly output: CapturedTerminalOutput
    }
  | { readonly kind: 'timed-out'; readonly output: CapturedTerminalOutput }
  | { readonly kind: 'spawn-failed'; readonly error: unknown }

/**
 * 起動して、終わるまで待つ。**例外を投げない。**
 *
 * `cwd` は Boundary（STEP2）が確かめ直した後の実体のパス（呼び出し側が渡す）。
 */
export function runTerminalProcess(
  spec: TerminalLaunchSpec,
  cwd: string,
  timeoutMs: number = TERMINAL_RUN_TIMEOUT_MS
): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    const collector = createTerminalOutputCollector()
    let child: ChildProcess

    try {
      child = spawn(spec.file, [...spec.args], {
        cwd,
        env: createTerminalEnvironment(process.env),
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve(Object.freeze({ kind: 'spawn-failed' as const, error }))
      return
    }

    watch(child, collector, timeoutMs, resolve)
  })
}

function watch(
  child: ChildProcess,
  collector: TerminalOutputCollector,
  timeoutMs: number,
  resolve: (result: RunProcessResult) => void
): void {
  let settled = false
  let timedOut = false
  let exitCode: number | null = null
  let exited = false
  let graceTimer: NodeJS.Timeout | null = null

  function settle(result: RunProcessResult): void {
    if (settled) {
      return
    }

    settled = true
    clearTimeout(timeoutTimer)

    if (graceTimer !== null) {
      clearTimeout(graceTimer)
    }

    resolve(result)
  }

  /** 出力の管を閉じて、集めたもので終わる。 */
  function finish(): void {
    child.stdout?.destroy()
    child.stderr?.destroy()

    const output = collector.finish()

    settle(
      timedOut
        ? Object.freeze({ kind: 'timed-out' as const, output })
        : Object.freeze({ kind: 'exited' as const, exitCode, output })
    )
  }

  child.stdout?.on('data', (chunk: Buffer) => collector.append('stdout', chunk))
  child.stderr?.on('data', (chunk: Buffer) => collector.append('stderr', chunk))

  child.once('error', (error) => {
    // 起動そのものができなかった（pid が無い）。起動した後の error は close を待つ。
    if (child.pid === undefined) {
      settle(Object.freeze({ kind: 'spawn-failed' as const, error }))
    }
  })

  child.once('exit', (code) => {
    exited = true
    exitCode = typeof code === 'number' ? code : null

    if (!timedOut) {
      graceTimer = setTimeout(finish, CLOSE_GRACE_MS)
    }
  })

  child.once('close', () => {
    finish()
  })

  const timeoutTimer = setTimeout(() => {
    if (exited) {
      // 本体は終わっている。管が閉じないだけなので、閉じて終わる。
      finish()
      return
    }

    timedOut = true
    killTree(child)
    graceTimer = setTimeout(finish, KILL_GRACE_MS)
  }, timeoutMs)
}

/**
 * 子プロセスごと終了させる。
 *
 * Windows は `taskkill /T /F`（`%SystemRoot%` から組み立てる。PATH には任せない）。
 * 呼べなければ本体だけでも終わらせる。
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid
  const taskkill = process.platform === 'win32' ? systemTaskkillPath() : null

  if (taskkill === null || typeof pid !== 'number') {
    killSelf(child)
    return
  }

  try {
    /*
      本体を先に終わらせると、taskkill が子を辿れなくなる（親を失った子が残る）。
      木ごと終わらせてから、念のため本体にも送る。
    */
    execFile(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false }, () =>
      killSelf(child)
    )
  } catch {
    killSelf(child)
  }
}

function killSelf(child: ChildProcess): void {
  try {
    child.kill('SIGKILL')
  } catch {
    // すでに終わっている。
  }
}

function systemTaskkillPath(): string | null {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT

  if (typeof systemRoot !== 'string' || !/^[A-Za-z]:\\/.test(systemRoot)) {
    return null
  }

  return `${trimTrailingSeparator(systemRoot)}\\System32\\taskkill.exe`
}
