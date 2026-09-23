import type { PlatformId } from '@shared/api'
import { findExecutableOnPath, type FileExistsCheck } from '../../platform/executablePath'
import {
  executableKindOf,
  executableNameCandidates,
  isAcceptableCommandName,
  isSafeBatchPath,
  type TerminalExecutableKind
} from './terminalCommand'

/**
 * コマンドの名前を、起動する実体（絶対パス）へ解決する（Security Core v1 の STEP8。
 * Electron にも fs にも依存しない ── 在るかどうかの確認は引数で受け取る）。
 *
 * ## PATH は Main が辿る
 *
 * 名前だけを OS へ渡すと、Windows の CreateProcess は**作業ディレクトリを先に見る。**
 * 作業ディレクトリは Workspace の中なので、`npm` と頼んだつもりが Workspace の中の
 * `npm.exe` が動く、が起きうる。人間用 Terminal のシェル解決（terminal/shellCommand.ts）
 * と同じく、PATH は**こちらで辿って絶対パスにしてから**渡す。
 *
 *   - 相対の項目（`.` / `bin`）は飛ばす（platform/executablePath.ts の規則をそのまま使う）
 *   - **Workspace の中を指す項目も飛ばす**（`node_modules/.bin` を PATH に足している環境で、
 *     Workspace の中身がコマンドとして選ばれないように）
 *
 * 実体が Workspace の中にあるかは、リンクを解いた後の場所でもう一度確かめる
 * （呼び出し側。terminalRunGate.ts）── PATH の項目の綴りが外でも、リンクで中を指せるため。
 *
 * ## 何も見つからなければ拒む
 *
 * 見つからない名前を「とりあえず名前のまま起動する」fallback は無い
 * （名前のまま起動すると、上の cwd の問題がそのまま戻る）。
 */

export interface TerminalExecutableEnvironment {
  readonly platform: PlatformId
  readonly env: Readonly<Record<string, string | undefined>>
  readonly exists: FileExistsCheck
  /**
   * Workspace root（綴りのまま と realpath 後）。**PATH の中でこれらの中を指す項目は使わない。**
   */
  readonly workspaceRoots: readonly string[]
}

export type TerminalExecutableResult =
  | { readonly ok: true; readonly file: string; readonly kind: TerminalExecutableKind }
  | { readonly ok: false; readonly denial: 'unsupported-command' | 'command-not-found' }

/** コマンドの名前を実体へ解決する。**例外を投げない。** */
export function resolveTerminalExecutable(
  command: unknown,
  environment: TerminalExecutableEnvironment
): TerminalExecutableResult {
  try {
    return resolve(command, environment)
  } catch {
    return NOT_FOUND
  }
}

function resolve(
  command: unknown,
  { platform, env, exists, workspaceRoots }: TerminalExecutableEnvironment
): TerminalExecutableResult {
  if (!isAcceptableCommandName(command)) {
    return UNSUPPORTED
  }

  const names = executableNameCandidates(command, platform)

  if (names.length === 0) {
    return UNSUPPORTED
  }

  const path = pathOutsideWorkspace(env, platform, workspaceRoots)

  if (path === null) {
    return NOT_FOUND
  }

  const file = findExecutableOnPath(names, platform, { PATH: path }, exists)

  if (file === null) {
    return NOT_FOUND
  }

  const kind = executableKindOf(file, platform)

  // cmd.exe の `"…"` で包めないパス（`%` を含む など）にある .cmd は起動しない。
  if (kind === 'batch' && !isSafeBatchPath(file)) {
    return UNSUPPORTED
  }

  return Object.freeze({ ok: true as const, file, kind })
}

/**
 * リンクを解いた後の実体が Workspace の中にあるか。
 *
 * 区切りまで含めて比べる（`workspace-evil` を `workspace` の中と取り違えない）。
 * 読めない値は「中」と答える（拒否側へ倒す）。
 */
export function isInsideWorkspaceRoot(
  realRootPath: unknown,
  realPath: unknown,
  platform: PlatformId
): boolean {
  if (typeof realRootPath !== 'string' || typeof realPath !== 'string' || realRootPath === '') {
    return true
  }

  const root = comparable(realRootPath, platform)
  const target = comparable(realPath, platform)

  return target === root || target.startsWith(`${root}/`)
}

/** PATH から、Workspace の中を指す項目を除いたもの。PATH が無ければ `null`。 */
function pathOutsideWorkspace(
  env: Readonly<Record<string, string | undefined>>,
  platform: PlatformId,
  workspaceRoots: readonly string[]
): string | null {
  // Windows の環境変数は大文字小文字を区別しないが、Node の process.env は素通しで来る。
  const rawPath = env.PATH ?? env.Path ?? env.path

  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return null
  }

  const separator = platform === 'win32' ? ';' : ':'
  const roots = workspaceRoots
    .filter((root) => typeof root === 'string' && root.length > 0)
    .map((root) => comparable(root, platform))

  return rawPath
    .split(separator)
    .filter((item) => {
      const entry = comparable(item.trim().replace(/^"|"$/g, ''), platform)

      return !roots.some((root) => entry === root || entry.startsWith(`${root}/`))
    })
    .join(separator)
}

/** 比べるための形（区切りを `/` へ揃え、末尾の区切りを落とす。Windows は大文字小文字も揃える）。 */
function comparable(value: string, platform: PlatformId): string {
  const unified = value.replace(/\\/g, '/').replace(/\/+$/, '')

  return platform === 'win32' ? unified.toLowerCase() : unified
}

const UNSUPPORTED: TerminalExecutableResult = Object.freeze({
  ok: false,
  denial: 'unsupported-command'
})

const NOT_FOUND: TerminalExecutableResult = Object.freeze({
  ok: false,
  denial: 'command-not-found'
})
