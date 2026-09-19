import type { PlatformId } from '@shared/api'
import {
  findExecutableOnPath,
  findInDirectory,
  trimTrailingSeparator,
  type FileExistsCheck
} from '../platform/executablePath'
import type { McpServerCommandResolution } from './mcpServerLaunch'

/**
 * npm でグローバルに入る MCP サーバーの起動コマンドを解決する
 * （MCP 共通。Electron / fs / child_process 非依存・テスト対象）。
 *
 * 起動のしかたの1つ（mcpServerLaunch.ts の `npm-global`）。利用者が自分で入れた
 * サーバーを使う行のためにある。アプリが同梱するサーバーは `bundled-node-script` を使う。
 *
 * ## 利用者が入れたものだけを起動する
 *
 * `npx` で**その場で取ってくることはしない**。`npx` は起動のたびに npm レジストリへ
 * 問い合わせ、利用者が確かめていない版を実行しうる。利用者が `npm install -g` で
 * 入れたものだけを起動する。
 *
 * ## `.cmd` を包まず、node で入口のスクリプトを直接起動する
 *
 * npm が Windows に置くのは `<bin>.cmd`（バッチ）で、LSP の表は `cmd.exe /c` で
 * 包んでいる。ここでは包まない ── 包むと、終わらせるときに `kill` が届くのは
 * `cmd.exe` だけで、**中で動いている node が残る**。MCP の接続はテストのたびに
 * 立てて畳むので、残ると1回ごとに1本ずつ溜まっていく。
 *
 * そこで `.cmd` の在る場所（= npm のグローバルの置き場所）から、パッケージの
 * 入口を辿り、PATH から確かめた `node.exe` で直接起動する。
 * どちらも絶対パスで、Workspace の中身は起動されるものに影響しない
 * （main/platform/executablePath.ts）。
 */

/** npm のパッケージ1つ分の、起動のしかた。 */
export interface NpmGlobalServerSpec {
  /** ログに出す名前。 */
  readonly name: string
  /** パッケージの `bin` の名前（PATH に置かれる名前）。 */
  readonly binName: string
  /**
   * npm のグローバルの置き場所から見た、入口のあるフォルダ（Windows の区切りで書く）。
   * 例: `node_modules\@scope\package\bin`
   */
  readonly entryDirectory: string
  /** 入口のファイル名（パッケージの `bin` が指すもの）。 */
  readonly entryFile: string
  readonly args: readonly string[]
}

/**
 * npm のグローバルの既定の置き場所（Windows。`%APPDATA%` からの相対位置）。
 *
 * PATH に入っていない PC はある（インストール直後で環境変数が読み直されていない
 * など）ので、PATH で見つからなかったときだけ当たる（csharp-ls の `.dotnet` と同じ扱い）。
 */
const WINDOWS_NPM_GLOBAL_RELATIVE = 'npm'

export function resolveNpmGlobalServerCommand(
  spec: NpmGlobalServerSpec,
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): McpServerCommandResolution {
  if (platform !== 'win32') {
    /*
      Unix 系の npm は入口への symlink を PATH に置き、その先頭の
      `#!/usr/bin/env node` で起動される。包むものが無いので直接起動する。
    */
    const found = findExecutableOnPath([spec.binName], platform, env, exists)

    return found === null
      ? { ok: false, problem: 'server-not-installed' }
      : { ok: true, command: { name: spec.name, file: found, args: spec.args, environment: {} } }
  }

  const entry = findWindowsEntry(spec, env, exists)

  if (entry === null) {
    return { ok: false, problem: 'server-not-installed' }
  }

  const node = findExecutableOnPath(['node.exe'], platform, env, exists)

  if (node === null) {
    return { ok: false, problem: 'node-not-found' }
  }

  return {
    ok: true,
    command: { name: spec.name, file: node, args: [entry, ...spec.args], environment: {} }
  }
}

/**
 * Windows で、グローバルに入ったパッケージの入口を探す。
 *
 * `.cmd` を PATH から見つけ、その隣の `node_modules` を辿る。
 * **`.cmd` の中身は読まない** ── バッチを解釈しにいくと、書き換えられた
 * バッチが指す先を起動しうる。npm の置き方（`.cmd` と `node_modules` が同じ場所）
 * だけを当てにし、入口が実在することを確かめる。
 */
function findWindowsEntry(
  spec: NpmGlobalServerSpec,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): string | null {
  const shimName = `${spec.binName}.cmd`
  const shim = findExecutableOnPath([shimName], 'win32', env, exists)

  if (shim !== null) {
    const entry = entryUnder(spec, shim.slice(0, shim.lastIndexOf('\\')), exists)

    if (entry !== null) {
      return entry
    }
  }

  const appData = env.APPDATA

  if (typeof appData !== 'string' || appData.length === 0) {
    return null
  }

  // 相対のパスが入っていても、findInDirectory が絶対でないフォルダを断る。
  const prefix = `${trimTrailingSeparator(appData)}\\${WINDOWS_NPM_GLOBAL_RELATIVE}`

  return findInDirectory(prefix, [shimName], 'win32', exists) === null
    ? null
    : entryUnder(spec, prefix, exists)
}

function entryUnder(
  spec: NpmGlobalServerSpec,
  npmPrefix: string,
  exists: FileExistsCheck
): string | null {
  return findInDirectory(
    `${trimTrailingSeparator(npmPrefix)}\\${spec.entryDirectory}`,
    [spec.entryFile],
    'win32',
    exists
  )
}
