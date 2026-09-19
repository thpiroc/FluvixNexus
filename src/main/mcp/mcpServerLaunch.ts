import type { PlatformId } from '@shared/api'
import type { McpConfigProblem } from '@shared/mcp'
import {
  findExecutableOnPath,
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
}

export type McpServerCommandResolution =
  | { readonly ok: true; readonly command: McpServerCommand }
  | {
      readonly ok: false
      readonly problem: Extract<McpConfigProblem, 'node-not-found' | 'server-not-installed'>
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

export type McpServerLaunch = BundledNodeScriptLaunch | NpmGlobalLaunch | ExecutableOnPathLaunch

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
