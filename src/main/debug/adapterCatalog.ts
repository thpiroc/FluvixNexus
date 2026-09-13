import type { PlatformId } from '@shared/api'
import { DEBUG_PROFILE_LANGUAGES, type DebugProfileLanguage } from '@shared/debug'
import {
  findExecutableOnPath,
  trimTrailingSeparator,
  type FileExistsCheck
} from '../platform/executablePath'

/**
 * Debug Adapter の Main-owned catalog foundation。
 *
 * Session 6-1 では実 adapter との統合は行わない。ここには閉じた集合だけを置き、
 * executable / args / cwd を Renderer から指定できる形を作らない。
 *
 * Session 6-10 で、行が**起動するもの**（実行ファイルの名前と adapter の引数）を持てる形にし、
 * それを PATH から絶対パスへ解く `resolveDebugAdapterExecutable` を足した。
 *
 * Session 6-12 で **python の行を `integrated` にした**（最初の実 adapter。`python -m debugpy.adapter`）。
 * node / csharp は `not-integrated` のまま（Node adapter の入手経路と transport は未調査。
 * docs/ARCHITECTURE.md §20.7 / §20.20）。
 */

/*
  言語の名前そのものは shared にある（Session 6-10 で Debug Profile の `language` として
  契約に載ったため。shared/debug/profile.ts）。LSP の `LANGUAGE_SERVER_IDS` と同じく、
  移したのは**名前だけ**で、何をどう起動するかはこのファイルに残っている。
*/
export const DEBUG_ADAPTER_LANGUAGE_IDS = DEBUG_PROFILE_LANGUAGES

export type DebugAdapterLanguageId = DebugProfileLanguage
/**
 * その行の adapter を、この版が起動できるか。
 *
 * `integrated` は Session 6-9 で型にだけ足した（どの行もまだ使っていない）。
 * Debug の状態（shared/debug/status.ts の `unavailable`）がこの事実から導かれるため、
 * 実 adapter を繋ぐ Session（6-10 / 6-11）が行を書き換えれば、状態の側は1行も変わらずに
 * `unavailable` から `idle` へ移る。
 */
export type DebugAdapterIntegrationStatus = 'integrated' | 'not-integrated'

/**
 * 起動するもの（Session 6-10）。**表の側だけが持つ。**
 *
 * - `executable` は拡張子を除いた名前。PATH を辿って絶対パスへ解く（名前だけで spawn しない）
 * - `args` は **adapter への**引数。profile の `programArgs`（プログラムへの引数）とは別物で、
 *   こちらを1語変えれば動くものが変わる（§20.4）
 */
export interface DebugAdapterExecutable {
  readonly executable: string
  readonly args: readonly string[]
}

export interface DebugAdapterCatalogEntry {
  readonly language: DebugAdapterLanguageId
  readonly name: string
  readonly integrationStatus: DebugAdapterIntegrationStatus
  /** 起動するもの。`integrated` の行だけが持つ（Session 6-10）。 */
  readonly adapter?: DebugAdapterExecutable
}

export interface DebugAdapterCommand {
  readonly name: string
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

const DEBUG_ADAPTER_CATALOG: Record<DebugAdapterLanguageId, DebugAdapterCatalogEntry> = {
  node: {
    language: 'node',
    name: 'Node.js Debug Adapter',
    integrationStatus: 'not-integrated'
  },
  /*
    Session 6-12。PATH の `python` で debugpy の adapter を stdio で立てる（`pip install debugpy`）。
    debuggee も同じ interpreter で動く（launch に `python` の欄を載せないため、adapter が
    自分の `sys.executable` を使う）。`-m` は cwd を sys.path の先頭に置くので、
    adapter のプロセスの cwd は Workspace の外にする（profileResolver.ts）。
  */
  python: {
    language: 'python',
    name: 'debugpy',
    integrationStatus: 'integrated',
    adapter: { executable: 'python', args: ['-m', 'debugpy.adapter'] }
  },
  csharp: {
    language: 'csharp',
    name: 'netcoredbg',
    integrationStatus: 'not-integrated'
  }
}

export function isDebugAdapterLanguageId(value: string): value is DebugAdapterLanguageId {
  return DEBUG_ADAPTER_LANGUAGE_IDS.includes(value as DebugAdapterLanguageId)
}

export function getDebugAdapterCatalogEntry(
  language: DebugAdapterLanguageId
): DebugAdapterCatalogEntry {
  return DEBUG_ADAPTER_CATALOG[language]
}

export function listDebugAdapterCatalogEntries(): readonly DebugAdapterCatalogEntry[] {
  return DEBUG_ADAPTER_LANGUAGE_IDS.map((language) => DEBUG_ADAPTER_CATALOG[language])
}

/**
 * 起動できる adapter が1つでもあるか（Session 6-9。Debug の状態の `unavailable` の根拠）。
 *
 * **catalog の行だけを見る。** PATH を探して実行ファイルがあるかまでは見ない ──
 * それは実 adapter を繋ぐ Session の仕事で、ここで探すと状態を読むたびに
 * ファイルシステムへ触ることになる。結果は真偽値1つで、名前もパスも外へ出ない。
 */
export function hasIntegratedDebugAdapter(
  entries: readonly DebugAdapterCatalogEntry[] = listDebugAdapterCatalogEntries()
): boolean {
  return entries.some((entry) => entry.integrationStatus === 'integrated')
}

/** 実行ファイルの絶対パスと adapter の引数（Main の中だけで使う）。 */
export interface ResolvedDebugAdapterExecutable {
  readonly file: string
  readonly args: readonly string[]
}

/** Windows の cmd.exe（`%SystemRoot%` からの相対位置）。`.cmd` を包むためだけに使う。 */
const WINDOWS_CMD_RELATIVE = 'System32\\cmd.exe'

/**
 * 行の adapter を、起動できる絶対パスへ解く（Session 6-10。Electron / fs 非依存・テスト対象）。
 *
 * 守ることは main/lsp/languageServerCatalog.ts（§19.2）と**同一**にしてある（§20.7）。
 *
 * - `integrated` でない行・起動するものを持たない行は null（起動しない）
 * - 実行ファイルは **PATH を辿って実体を確かめた絶対パス**。名前だけで spawn しない
 *   （Windows の CreateProcess は作業ディレクトリを先に見るため）
 * - **Workspace の中は探さない**（PATH の相対項目は platform 層が飛ばす）
 * - Windows の `.cmd` は `cmd.exe /c <絶対パス>` で包み、その `cmd.exe` も `%SystemRoot%` から組み立てる
 * - 表の `executable` に区切りや `:` が入っていたら解かない（表の書き損じで名前以外を探さない）
 *
 * 見つからなければ null。呼び出し側は `adapter-unavailable` として扱う。
 */
export function resolveDebugAdapterExecutable(
  entry: DebugAdapterCatalogEntry,
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): ResolvedDebugAdapterExecutable | null {
  const adapter = entry.adapter

  if (entry.integrationStatus !== 'integrated' || adapter === undefined) {
    return null
  }

  const executable = adapter.executable

  if (executable.length === 0 || /[\\/:]/.test(executable)) {
    return null
  }

  if (platform !== 'win32') {
    const found = findExecutableOnPath([executable], platform, env, exists)

    return found === null ? null : { file: found, args: [...adapter.args] }
  }

  // ネイティブの実行ファイルを先に探し、包むのは包まないと動かないものだけにする。
  const found = findExecutableOnPath(
    [`${executable}.exe`, `${executable}.cmd`],
    platform,
    env,
    exists
  )

  if (found === null) {
    return null
  }

  if (found.toLowerCase().endsWith('.exe')) {
    return { file: found, args: [...adapter.args] }
  }

  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT

  if (typeof systemRoot !== 'string' || systemRoot.length === 0) {
    // 名前だけの cmd.exe へ落とさない（PATH と cwd から解決されることになる）。
    return null
  }

  return {
    file: `${trimTrailingSeparator(systemRoot)}\\${WINDOWS_CMD_RELATIVE}`,
    args: ['/c', found, ...adapter.args]
  }
}
