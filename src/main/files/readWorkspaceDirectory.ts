import { readdir, realpath } from 'fs/promises'
import { join } from 'path'
import { FILES_DIRECTORY_MAX_ENTRIES, type FileEntry } from '@shared/files'
import { sortFileEntries } from './entrySort'
import { toFileEntry } from './fileEntry'
import { resolveLinkEntryType } from './linkEntryType'
import {
  isInsideWorkspace,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath
} from './workspacePath'

/**
 * Workspace の中のフォルダ1つ分を読む。
 *
 * ファイルシステムに触れる唯一の場所で、パス文字列に対する判断は
 * files/workspacePath.ts が持つ（テストできる形に切り離してある）。
 *
 * ## 読むのは1階層だけ（Lazy Load）
 *
 * 再帰しない。Workspace を開いた瞬間に全体を舐めると、node_modules を持つ
 * プロジェクトではそれだけで数万〜数十万件になる。展開されたフォルダを
 * その都度1階層読む形にしておけば、読む量は利用者が実際に開いた範囲で止まる。
 *
 * ## 失敗しても投げない
 *
 * フォルダは読んでいる最中に消えるし、権限が無いこともある。
 * どれもアプリが落ちる理由にはならないため、結末を値として返して
 * ipc/handlers/files.ts が IPC の失敗分類へ翻訳する（この層は IPC を知らない）。
 */

export type ReadWorkspaceDirectoryOutcome =
  | {
      readonly status: 'ok'
      /** 正規化した相対位置。応答に載せて、どのフォルダの結果かを照合できるようにする。 */
      readonly relativePath: string
      readonly entries: readonly FileEntry[]
      readonly truncated: boolean
    }
  /** 相対位置として扱えない（絶対パス・`..`・桁違いに長いなど）。 */
  | { readonly status: 'invalid-path' }
  /** 相対位置としては読めるが、実体が Workspace の外にある（symlink など）。 */
  | { readonly status: 'outside-workspace' }
  /** 無くなっている。Workspace root 自体が消えた場合もこれになる。 */
  | { readonly status: 'not-found' }
  /** 読む権限が無い。 */
  | { readonly status: 'permission-denied' }
  /** フォルダではなかった（ファイルを展開しようとした場合など）。 */
  | { readonly status: 'not-a-directory' }
  /** それ以外（I/O エラーなど）。 */
  | { readonly status: 'failed'; readonly detail: string }

/** errno を持つ例外か。fs の失敗は種類ごとに扱いが違うため、code を見て分ける。 */
function errorCodeOf(cause: unknown): string | null {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const { code } = cause as { code: unknown }
    return typeof code === 'string' ? code : null
  }

  return null
}

/** fs の失敗を、この層の結末へ翻訳する。 */
function toFailureOutcome(cause: unknown): ReadWorkspaceDirectoryOutcome {
  switch (errorCodeOf(cause)) {
    case 'ENOENT':
      return { status: 'not-found' }

    case 'EACCES':
    case 'EPERM':
      return { status: 'permission-denied' }

    case 'ENOTDIR':
      return { status: 'not-a-directory' }

    // symlink のループ・パスが長すぎる・名前として不正。どれも「その位置は読めない」。
    case 'ELOOP':
    case 'ENAMETOOLONG':
    case 'EINVAL':
      return { status: 'invalid-path' }

    default:
      return { status: 'failed', detail: String(cause) }
  }
}

export async function readWorkspaceDirectory(
  rootPath: string,
  rawRelativePath: unknown
): Promise<ReadWorkspaceDirectoryOutcome> {
  // 1. 文字列としての検証（`..`・絶対パス・NUL など）。
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  if (relativePath === null) {
    return { status: 'invalid-path' }
  }

  // 2. root と組んだ結果が Workspace の中に収まるか。
  const absolutePath = resolveWorkspacePath(rootPath, relativePath)

  if (absolutePath === null) {
    return { status: 'outside-workspace' }
  }

  /*
    3. 実体を見て、もう一度 Workspace の中か確かめる。

    ここまでは文字列の話でしかない。symlink / ジャンクションは相対位置としては
    正しいまま外を指せるため、realpath で実体まで解決してから境界を見る。
    root 側も realpath を取るのは、Workspace 自体が symlink の下にある場合に
    「解決した子」と「解決していない root」を比べることになり、
    中にあるものまで外だと判定してしまうため。
  */
  let realRootPath: string
  let realPath: string

  try {
    realRootPath = await realpath(rootPath)
  } catch (cause) {
    // Workspace root ごと消えた / 外付けドライブが外れた。
    return toFailureOutcome(cause)
  }

  try {
    realPath = await realpath(absolutePath)
  } catch (cause) {
    return toFailureOutcome(cause)
  }

  if (!isInsideWorkspace(realRootPath, realPath)) {
    return { status: 'outside-workspace' }
  }

  /*
    4. 列挙する。

    渡すのは realpath 側。検証したのはこちらであり、絶対パスの方を渡すと
    「確かめた対象」と「読む対象」が別物になる（間に symlink が差し替えられた場合に
    検証をすり抜ける）。
  */
  let dirents
  try {
    dirents = await readdir(realPath, { withFileTypes: true })
  } catch (cause) {
    return toFailureOutcome(cause)
  }

  const entries: FileEntry[] = []

  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      entries.push(toFileEntry(dirent.name, relativePath, 'directory'))
      continue
    }

    if (dirent.isSymbolicLink()) {
      entries.push(
        toFileEntry(
          dirent.name,
          relativePath,
          await resolveLinkEntryType(join(realPath, dirent.name))
        )
      )
      continue
    }

    // 通常のファイルのほか、デバイス・FIFO なども「開けないもの」として file に寄せる。
    entries.push(toFileEntry(dirent.name, relativePath, 'file'))
  }

  // 打ち切るのは並べ替えた後。先に切ると、同じフォルダでも読むたびに
  // 見えるものが変わりうる（readdir の順序はディスク側の都合で決まる）。
  const sorted = sortFileEntries(entries)
  const truncated = sorted.length > FILES_DIRECTORY_MAX_ENTRIES

  return {
    status: 'ok',
    relativePath,
    entries: truncated ? sorted.slice(0, FILES_DIRECTORY_MAX_ENTRIES) : sorted,
    truncated
  }
}
