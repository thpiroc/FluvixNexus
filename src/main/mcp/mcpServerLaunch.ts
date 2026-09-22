import type { PlatformId } from '@shared/api'
import type { McpConfigProblem } from '@shared/mcp'
import {
  findExecutableOnPath,
  isAbsoluteExecutablePath,
  trimTrailingSeparator,
  type FileExistsCheck
} from '../platform/executablePath'
import { resolveNpmGlobalServerCommand, type NpmGlobalServerSpec } from './mcpNpmServer'

/**
 * MCP サーバーの「起動のしかた」（MCP 共通。Electron / fs / child_process 非依存・テスト対象）。
 *
 * サーバーの定義（例: notionMcpServer.ts）は、次のどれか1つを選ぶ。
 *
 * | 種類                  | 何を起動するか                                          | 利用者に求めるもの |
 * | --------------------- | ------------------------------------------------------- | ------------------ |
 * | `bundled-node-script` | アプリに同梱したスクリプトを、アプリ自身の Node で起動 | 何も無い           |
 * | `npm-global`          | 利用者が `npm install -g` したパッケージ（mcpNpmServer） | Node と npm        |
 * | `executable-on-path`  | PATH 上の実行ファイル（Go などで書かれたサーバー）      | その実行ファイル   |
 * | `user-command`        | 利用者が Settings で決めた Command と引数（§21.10）     | その Command       |
 *
 * ## 同梱したスクリプトは、アプリ自身の Node で動かす
 *
 * Electron の実行ファイルは、`ELECTRON_RUN_AS_NODE=1` を付けて起動すると素の Node として
 * 動く。これを使えば、利用者の PC に Node が無くても、版を固定したサーバーを動かせる
 * （Node で書かれた MCP サーバーの多くは、1つのファイルにまとめて配られている）。
 *
 * 置き場所はアプリが決める（配布物では `resources/mcp-servers/<name>`、開発時は
 * `node_modules/<package>`。mcpService.ts）── 定義が書くのは「どのパッケージの、
 * どのファイルか」だけで、PATH も Workspace も起動されるものに影響しない。
 *
 * ## 起動に付く環境変数
 *
 * `environment` は起動のしかたそのものに要る変数（`ELECTRON_RUN_AS_NODE`）だけ。
 * サーバーの設定（token など）は環境の組み立て（mcpServerEnvironment.ts）が別に足す。
 */

/** 起動するもの1つ分。Main の中だけで使う（Renderer へは渡さない）。 */
export interface McpServerCommand {
  /** ログに出す名前。実行ファイルのパスではない。 */
  readonly name: string
  /** 実行ファイルの絶対パス。 */
  readonly file: string
  readonly args: readonly string[]
  /** 起動のしかたに要る環境変数（サーバーの設定ではない）。 */
  readonly environment: Readonly<Record<string, string>>
  /**
   * 引数を Node の引用の規則で包まず、並べたまま渡す（Windows だけ）。
   * `.cmd` / `.bat` を `cmd.exe /d /s /c "…"` で包むときにだけ使う
   * ── `cmd.exe` は Node の引用の規則（`\"`）を読まない。
   */
  readonly windowsVerbatimArguments?: boolean
  /**
   * 終わらせるときに、子孫のプロセスごと終わらせる道具（`taskkill.exe` の絶対パス）。
   *
   * 利用者が足したサーバーは、起動したものがさらに別のプロセスを立てることがある
   * （`npx` → node、`uvx` → python、`cmd.exe` → バッチの中身）。起動したものだけを
   * kill すると、中の本体が残り続ける。
   */
  readonly killTreeWith?: string
}

export type McpServerCommandResolution =
  | { readonly ok: true; readonly command: McpServerCommand }
  | {
      readonly ok: false
      readonly problem: Extract<
        McpConfigProblem,
        'node-not-found' | 'server-not-installed' | 'command-not-found' | 'arguments-unsupported'
      >
    }

/** アプリに同梱したパッケージの、どのファイルを起動するか。 */
export interface BundledNodeScriptLaunch {
  readonly kind: 'bundled-node-script'
  readonly name: string
  /** npm のパッケージ名（開発時は node_modules から読む）。 */
  readonly packageName: string
  /** 配布物の中の置き場所の名前（`resources/mcp-servers/<bundleName>`）。 */
  readonly bundleName: string
  /** パッケージの中の入口（区切りごと）。 */
  readonly entry: readonly string[]
  readonly args: readonly string[]
}

export interface NpmGlobalLaunch {
  readonly kind: 'npm-global'
  readonly spec: NpmGlobalServerSpec
}

export interface ExecutableOnPathLaunch {
  readonly kind: 'executable-on-path'
  readonly name: string
  /** OS ごとの実行ファイル名の候補（PATH を辿って探す。main/platform/executablePath.ts）。 */
  readonly executableNames: {
    readonly win32: readonly string[]
    readonly other: readonly string[]
  }
  readonly args: readonly string[]
}

/**
 * 利用者が Settings で決めた Command と引数（§21.10）。
 *
 * Command は絶対パスか、PATH を辿って探す名前（mcpServerLaunch.ts の
 * `resolveUserCommand`）。引数は配列のまま渡す。
 */
export interface UserCommandLaunch {
  readonly kind: 'user-command'
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
}

export type McpServerLaunch =
  BundledNodeScriptLaunch | NpmGlobalLaunch | ExecutableOnPathLaunch | UserCommandLaunch

/** 同梱したスクリプトを動かす Node（アプリ自身の Electron）。 */
export interface McpNodeRuntime {
  /** Electron の実行ファイルの絶対パス（`process.execPath`）。 */
  readonly file: string
  /** Node として動かすための変数（`ELECTRON_RUN_AS_NODE=1`）。 */
  readonly environment: Readonly<Record<string, string>>
}

/** 起動のしかたを解決するのに要るもの。 */
export interface McpLaunchContext {
  readonly platform: PlatformId
  readonly env: Readonly<Record<string, string | undefined>>
  readonly exists: FileExistsCheck
  /** 同梱したパッケージの置き場所（絶対パス）。 */
  readonly bundledPackageDirectory: (launch: BundledNodeScriptLaunch) => string
  readonly nodeRuntime: McpNodeRuntime
}

export function resolveMcpServerLaunch(
  launch: McpServerLaunch,
  context: McpLaunchContext
): McpServerCommandResolution {
  switch (launch.kind) {
    case 'bundled-node-script':
      return resolveBundledNodeScript(launch, context)

    case 'npm-global':
      return resolveNpmGlobalServerCommand(
        launch.spec,
        context.platform,
        context.env,
        context.exists
      )

    case 'executable-on-path': {
      const names =
        context.platform === 'win32' ? launch.executableNames.win32 : launch.executableNames.other
      const found = findExecutableOnPath(names, context.platform, context.env, context.exists)

      return found === null
        ? { ok: false, problem: 'server-not-installed' }
        : {
            ok: true,
            command: { name: launch.name, file: found, args: launch.args, environment: {} }
          }
    }

    case 'user-command':
      return resolveUserCommand(launch, context)
  }
}

/**
 * Windows で名前だけの Command を探すときの拡張子（既定の PATHEXT の順）。
 *
 * 利用者の PATHEXT は読まない ── 何が「実行できる」かを環境変数で広げられると、
 * `.js` や `.vbs` が関連付けのプログラムで起動しうる。
 */
const WINDOWS_COMMAND_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd'] as const

function hasWindowsCommandExtension(command: string): boolean {
  const lower = command.toLowerCase()
  return WINDOWS_COMMAND_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

function isBatchFile(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file)
}

/**
 * 利用者が決めた Command を、起動する実体（絶対パス）へ。
 *
 * | 書き方                        | 探し方                                                          |
 * | ----------------------------- | --------------------------------------------------------------- |
 * | 絶対パス                      | そこに在るか（Windows では拡張子を省いた書き方も当たる）         |
 * | 名前だけ（`npx`・`uvx`）      | PATH を**こちらで辿る**（作業ディレクトリは見ない。executablePath.ts） |
 * | 相対パス（`.\x.exe`）          | 受け付けない（検証で先に断っている。shared/mcp/customServers.ts） |
 */
function locateUserCommand(command: string, context: McpLaunchContext): string | null {
  const { platform, env, exists } = context
  const windows = platform === 'win32'

  if (isAbsoluteExecutablePath(command, platform)) {
    if (exists(command)) {
      return command
    }

    if (!windows || hasWindowsCommandExtension(command)) {
      return null
    }

    for (const extension of WINDOWS_COMMAND_EXTENSIONS) {
      if (exists(`${command}${extension}`)) {
        return `${command}${extension}`
      }
    }

    return null
  }

  if (/[\\/]/.test(command)) {
    return null
  }

  const names =
    windows && !hasWindowsCommandExtension(command)
      ? WINDOWS_COMMAND_EXTENSIONS.map((extension) => `${command}${extension}`)
      : [command]

  return findExecutableOnPath(names, platform, env, exists)
}

/** Windows の System32（`cmd.exe` と `taskkill.exe` の在り処）。PATH からは探さない。 */
function windowsSystem32(env: McpLaunchContext['env']): string | null {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR

  return typeof root === 'string' && isAbsoluteExecutablePath(root, 'win32')
    ? `${trimTrailingSeparator(root)}\\System32`
    : null
}

/**
 * `.cmd` / `.bat` を `cmd.exe /d /s /c "…"` の1行へ。渡せない文字があれば null。
 *
 * ## なぜ包むのか
 *
 * バッチは実行ファイルではなく、`shell: false` のままでは起動できない
 * （Node は `.cmd` を直に起動することを断る。CVE-2024-27980）。`npx` のように
 * バッチで配られる Command を使うには `cmd.exe` に読ませるしかない。
 *
 * ## 何を断るか
 *
 * `cmd.exe` は1行を読み直す。どの引数も `"…"` で囲むので、`&` `|` `<` `>` `^` `(` `)`
 * は囲みの中の文字のまま残る。囲みの中でも効いてしまうものだけを断る。
 *
 * | 文字 | 理由                                                                 |
 * | ---- | -------------------------------------------------------------------- |
 * | `"`  | 囲みを閉じてしまう（その後ろの `&` などが命令として読まれる）        |
 * | `%`  | 囲みの中でも環境変数として展開される（`%PATH%`）                     |
 * | `!`  | バッチの中で遅延展開が有効だと展開される                             |
 *
 * 改行などの制御文字は、保存する時点で断っている（shared/mcp/customServers.ts）。
 * 引数の末尾の `\` は2つに増やす ── 囲みを閉じる `"` の直前の `\` は、バッチの
 * 先で起動される node などが「`"` をそのまま文字にする」と読むため。
 */
export function buildWindowsBatchCommandLine(file: string, args: readonly string[]): string | null {
  const unsafe = /["%!\r\n]/

  if (unsafe.test(file) || args.some((arg) => unsafe.test(arg))) {
    return null
  }

  const quote = (value: string): string => `"${value.replace(/(\\+)$/, '$1$1')}"`

  return [`"${file}"`, ...args.map(quote)].join(' ')
}

function resolveUserCommand(
  launch: UserCommandLaunch,
  context: McpLaunchContext
): McpServerCommandResolution {
  const file = locateUserCommand(launch.command, context)

  if (file === null) {
    return { ok: false, problem: 'command-not-found' }
  }

  if (context.platform !== 'win32') {
    return {
      ok: true,
      command: { name: launch.name, file, args: launch.args, environment: {} }
    }
  }

  const system32 = windowsSystem32(context.env)
  const killTreeWith = system32 === null ? undefined : `${system32}\\taskkill.exe`

  if (!isBatchFile(file)) {
    return {
      ok: true,
      command: { name: launch.name, file, args: launch.args, environment: {}, killTreeWith }
    }
  }

  if (system32 === null) {
    // バッチを読ませる `cmd.exe` の在り処が分からない。PATH から探して別の cmd を掴まない。
    return { ok: false, problem: 'command-not-found' }
  }

  const commandLine = buildWindowsBatchCommandLine(file, launch.args)

  if (commandLine === null) {
    return { ok: false, problem: 'arguments-unsupported' }
  }

  return {
    ok: true,
    command: {
      name: launch.name,
      file: `${system32}\\cmd.exe`,
      // /d … AutoRun（レジストリの自動実行）を読まない。/s /c … 外側の `"` 1組だけを外して実行する。
      args: ['/d', '/s', '/c', `"${commandLine}"`],
      environment: {},
      windowsVerbatimArguments: true,
      killTreeWith
    }
  }
}

function resolveBundledNodeScript(
  launch: BundledNodeScriptLaunch,
  context: McpLaunchContext
): McpServerCommandResolution {
  const separator = context.platform === 'win32' ? '\\' : '/'
  const entry = [
    trimTrailingSeparator(context.bundledPackageDirectory(launch)),
    ...launch.entry
  ].join(separator)

  // 同梱したはずのファイルが無いのは、配布物が壊れている（入れ直してもらう）。
  if (!context.exists(entry)) {
    return { ok: false, problem: 'server-not-installed' }
  }

  return {
    ok: true,
    command: {
      name: launch.name,
      file: context.nodeRuntime.file,
      args: [entry, ...launch.args],
      environment: context.nodeRuntime.environment
    }
  }
}
