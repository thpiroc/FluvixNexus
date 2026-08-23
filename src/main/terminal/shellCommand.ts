import type { PlatformId } from '@shared/api'
import {
  TERMINAL_SHELL_IDS,
  type TerminalShellChoice,
  type TerminalShellId
} from '@shared/terminal'
import {
  findExecutableOnPath,
  trimTrailingSeparator,
  type FileExistsCheck
} from '../platform/executablePath'

/**
 * 何を起動するかを決める表（Electron / fs / node-pty 非依存・テスト対象）。
 *
 * ## Renderer が指定できないことの実体がここにある
 *
 * `terminal:create` の要求に実行ファイルの欄は無い（shared/ipc/contracts/terminal.ts）。
 * Session 3-7-2 で足したのは**この表のどの行か**を指す値（`TerminalShellId`）だけで、
 * 行の中身 ── 実行ファイル・引数・どこから解決するか ── は今もここだけが持つ。
 * 知らない値は Main が断るため、外から差し替える経路は依然として無い。
 *
 * ## PATH で解決しない（既定のシェル）
 *
 * `powershell.exe` とだけ書くと、解決に使われるのは**起動時の PATH と
 * 作業ディレクトリ**になる。作業ディレクトリは利用者が開いた Workspace で、
 * その中に `powershell.exe` が置かれていることは十分ありうる
 * （clone してきたリポジトリの中身は、この時点ではただのファイルでしかない）。
 * 「フォルダを開いただけ」が「そのフォルダの中の実行ファイルが動く」になっては困る。
 *
 * そこで `%SystemRoot%` から絶対パスを組み立てる。System32 配下は
 * Workspace の中身によって変わらない場所であり、ここを起点にする限り
 * **開いたフォルダの中身が起動されるものに影響しない。**
 *
 * `%SystemRoot%` が無い環境では名前だけに落とす。落としてでも起動できる方が
 * 「ターミナルが使えない」より良いが、それは異常な環境での最後の手段であって
 * 既定の経路ではない。
 *
 * ## PATH を「辿る」ことと、PATH に「任せる」ことは違う（Node / Claude Code）
 *
 * Node も Claude Code も System32 には居ない。置き場所を決めるのは利用者で、
 * それを知っているのは PATH だけになる。とはいえ実行ファイル名だけを
 * node-pty へ渡すと、上と同じ理由で**作業ディレクトリの中身が起動されうる**
 * （Windows の CreateProcess は cwd を先に見る）。
 *
 * そこで PATH は**こちらで辿り、実体を確かめてから絶対パスを渡す**。
 *
 *   - 相対の項目（`.` や `bin` のような書き方）は飛ばす。cwd を起点に解決されるため
 *   - 見つからなければ、その行は「この環境には無い」として選択肢から外す
 *
 * 結果として、Workspace の中に `node.exe` を置かれても起動されるものは変わらない
 * （`shellCommand.test.ts` がこの性質を直接確かめている）。
 *
 * ## `.cmd` は直接起動できない
 *
 * npm が入れる `claude` は Windows では `claude.cmd`（バッチ）で、
 * CreateProcess はバッチを直接実行できない。`cmd.exe /c <絶対パス>` で包むが、
 * **その `cmd.exe` も `%SystemRoot%` から組み立てる**（PATH に任せない）。
 * 包む対象は PATH から実体を確かめた絶対パスなので、ここでも
 * 「開いたフォルダの中身」は起動されるものに影響しない。
 *
 * ## v1 は Windows だけ、ただし分岐は platform 層の形に合わせる
 *
 * DESIGN.md §8 のとおり、OS 固有の分岐は Main のこの層に閉じ込める。
 * Renderer / shared には OS の話が出てこない ── 既定のシェルの id が
 * `'powershell'` ではなく `'default'` なのはそのためで、
 * それが PowerShell に解決されるのはこの表の都合になる。
 */

/** 起動するもの1つ分。 */
export interface ShellCommand {
  /** 画面に出す名前。Renderer へ渡るのはこちらだけ。 */
  readonly name: string
  /** 実行ファイル。Main の中だけで使う。 */
  readonly file: string
  readonly args: readonly string[]
}

/**
 * 実行ファイルがそこに在るか。
 *
 * 引数で受け取るのは、`fs` を直接読むとこの表がテストできなくなるため
 * （`env` を受け取っているのと同じ理由）。実体を渡すのは呼び出し側
 * （main/terminal/terminalSessions.ts）。
 *
 * 定義は platform 層にある ── PATH の辿り方は Terminal だけのものではなく、
 * Git も同じ規則で `git` 本体を探す（main/platform/executablePath.ts）。
 */
export type { FileExistsCheck }

/** Windows の PowerShell（%SystemRoot% からの相対位置）。 */
const WINDOWS_POWERSHELL_RELATIVE = 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'

/** Windows の cmd.exe（%SystemRoot% からの相対位置）。`.cmd` を包むためだけに使う。 */
const WINDOWS_CMD_RELATIVE = 'System32\\cmd.exe'

/**
 * 選択肢に出す名前。
 *
 * 起動できない行も UI へは名前付きで返るため（`available: false`）、
 * 解決できたかどうかに依らない名前がここに要る。`default` だけは
 * 解決してみるまで名前が決まらない（PowerShell / Shell）ので、
 * `resolveDefaultShell` が返すものを優先する。
 */
const SHELL_FALLBACK_NAMES: Record<TerminalShellId, string> = {
  default: 'Shell',
  node: 'Node',
  'claude-code': 'Claude Code'
}

/**
 * 表の1行を実際の起動コマンドへ解決する。
 *
 * この環境で起動できなければ null（呼び出し側が UNSUPPORTED へ翻訳する）。
 * 既定のシェルだけは必ず何かを返す ── シェルがまったく起動できない環境では、
 * そもそも Terminal パネルが成立しない。
 */
export function resolveShellCommand(
  shellId: TerminalShellId,
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): ShellCommand | null {
  switch (shellId) {
    case 'default':
      return resolveDefaultShell(platform, env)

    case 'node':
      return resolveFromPath('Node', nodeExecutableNames(platform), platform, env, exists)

    case 'claude-code':
      return resolveClaudeCode(platform, env, exists)
  }
}

/**
 * 選択肢の一覧（表の並びのまま）。
 *
 * **起動できないものも `available: false` で返す。** 呼び出し側が黙って
 * 落としてしまうと、Main のログにも「Node を出さなかった」が残らない。
 * UI へ出すかどうかを決めるのは受け取った側（renderer/src/terminal/）。
 */
export function listShellChoices(
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): readonly TerminalShellChoice[] {
  return TERMINAL_SHELL_IDS.map((id) => {
    const command = resolveShellCommand(id, platform, env, exists)

    return {
      id,
      name: command?.name ?? SHELL_FALLBACK_NAMES[id],
      available: command !== null
    }
  })
}

/**
 * 既定のシェルを決める。
 *
 * `env` を引数で受け取るのは、`process.env` を直接読むとテストできなくなるため
 * （store/windowBounds.ts と windowState.ts の分け方と同じ）。
 */
export function resolveDefaultShell(
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>
): ShellCommand {
  if (platform === 'win32') {
    return {
      name: 'PowerShell',
      file: resolveSystemPowerShell(env) ?? 'powershell.exe',
      /*
        -NoLogo … 起動のたびに著作権表示で2行使わない。
        -NoExit などは付けない ── 利用者が `exit` と打ったら終わるのが端末の約束で、
        終われないシェルは「閉じられないアプリ」と同じ種類の不便になる。
      */
      args: ['-NoLogo']
    }
  }

  /*
    v1 の対象ではない（DESIGN.md §8）。ここに分岐を置いているのは、
    Mac 対応を始めるときに書き換える場所を1つに保つため。
    `$SHELL` を見るのは、Unix 系では「利用者が選んだシェル」がそこにあるという
    約束が成立しているから（Windows にはその約束が無い）。
  */
  const loginShell = env.SHELL

  return {
    name: 'Shell',
    file: typeof loginShell === 'string' && loginShell.length > 0 ? loginShell : '/bin/sh',
    args: []
  }
}

/**
 * Windows の PowerShell を `%SystemRoot%` から絶対パスで指す。読めなければ null。
 *
 * 起動するシェルとしてだけでなく、**OS へ問い合わせる道具**としても使う
 * （childProcesses.ts ── 実行中のコマンドがあるかを聞く）。切り出してあるのは、
 * 「PATH に任せない」という判断をどちらの用途でも同じ1箇所から引くため。
 */
export function resolveSystemPowerShell(
  env: Readonly<Record<string, string | undefined>>
): string | null {
  return resolveSystemFile(WINDOWS_POWERSHELL_RELATIVE, env)
}

/* ------------------------------------------------------------------ 各行の解決 */

function nodeExecutableNames(platform: PlatformId): readonly string[] {
  return platform === 'win32' ? ['node.exe'] : ['node']
}

/**
 * Claude Code。
 *
 * Windows では npm が `claude.cmd`（バッチ）を置く。バッチは CreateProcess で
 * 直接起動できないため `cmd.exe /c` で包む ── 包む相手は PATH から実体を
 * 確かめた**絶対パス**なので、cwd の中身が起動されることはない。
 */
function resolveClaudeCode(
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): ShellCommand | null {
  const name = 'Claude Code'

  if (platform !== 'win32') {
    return resolveFromPath(name, ['claude'], platform, env, exists)
  }

  /*
    順番に意味がある。ネイティブの実行ファイルがあればそれを直接起動し、
    包むのは包まないと動かないものだけにする（間に1つプロセスが挟まると、
    Ctrl+C の届き方も終了コードの返り方も cmd.exe の都合に左右される）。
  */
  const found = findExecutableOnPath(
    ['claude.exe', 'claude.cmd', 'claude.bat'],
    platform,
    env,
    exists
  )

  if (found === null) {
    return null
  }

  if (found.toLowerCase().endsWith('.exe')) {
    return { name, file: found, args: [] }
  }

  const cmd = resolveSystemFile(WINDOWS_CMD_RELATIVE, env)

  if (cmd === null) {
    /*
      %SystemRoot% が読めない環境。既定のシェルは名前だけに落として起動を試みるが、
      こちらは落とさない ── 落とすと「PATH と cwd から解決される cmd.exe」に
      なってしまい、この表が守っている性質そのものが崩れる。
      Claude Code が選べなくなるだけで、既定のシェルは使える。
    */
    return null
  }

  return { name, file: cmd, args: ['/c', found] }
}

function resolveFromPath(
  name: string,
  executableNames: readonly string[],
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): ShellCommand | null {
  const found = findExecutableOnPath(executableNames, platform, env, exists)

  return found === null ? null : { name, file: found, args: [] }
}

/* ---------------------------------------------------------------- パスの組み立て */

/** `%SystemRoot%` からの絶対パス。読めなければ null。 */
function resolveSystemFile(
  relative: string,
  env: Readonly<Record<string, string | undefined>>
): string | null {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT

  if (typeof systemRoot !== 'string' || systemRoot.length === 0) {
    return null
  }

  return `${trimTrailingSeparator(systemRoot)}\\${relative}`
}

/*
  PATH の辿り方そのものは platform 層にある（main/platform/executablePath.ts）。
  Terminal だけの話ではなく、Git も同じ規則で `git` 本体を探すため
  ── 2箇所に書くと、片方だけ「相対の項目も拾う」ように直された時点で、
  その経路からだけ作業ディレクトリの中身が起動されるようになる。
*/
