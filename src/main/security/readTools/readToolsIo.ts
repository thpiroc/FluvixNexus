import type { Dirent } from 'fs'
import { open, readdir, type FileHandle } from 'fs/promises'
import { FILES_FILE_MAX_BYTES } from '@shared/files'
import { errnoCodeOf } from '../../files/errno'
import { isSamePath } from '../../files/workspacePath'
import {
  confirmOpenedWorkspaceFile,
  isVerifiedWorkspaceTarget,
  recheckWorkspaceTarget,
  resolveWorkspaceTarget,
  type VerifiedWorkspaceTarget
} from '../boundary/workspaceBoundary'

/**
 * Read Tool Gate がディスクを読む部分（Security Core v1 の STEP9）。
 *
 * File Write Gate の読み取り（fileWrite/fileWriteIo.ts の readCurrentFile）と同じ順で読む。
 *
 * ```
 * open(realPath, 'r')           Boundary が確かめた実体の場所を開く
 * confirmOpenedWorkspaceFile    開いたハンドルが、確かめた対象か（identity・親の実体）
 * stat → 上限                   Editor が開ける 2 MiB（FILES_FILE_MAX_BYTES）まで
 * ハンドル越しに読む            パスで読み直さない
 * ```
 *
 * パスで読み直さないのは、確かめてから読むまでの間に途中の要素が外へのリンクへ
 * 差し替えられても、**確かめた実体以外の中身を Agent へ渡さない**ため（DESIGN.md §6.4 の
 * TOCTOU）。confirm は**読む前**に行う ── 外の実体を開いてしまっても、中身は1バイトも
 * 読まずに閉じる（読んでから Mask するのではない）。**例外を投げない。**
 *
 * ## root を固定した読み取り（STEP9.1）
 *
 * file_search のように1回の要求で多くの位置を読む Tool は、**要求の始めに Boundary が
 * 確かめた root（実体・identity）を固定し**、各位置をその root に対して確かめ直す。
 *
 * ```
 * resolvePinnedWorkspaceTarget   Boundary で解決 → root の実体・identity が固定値と同じ
 *                                → リンクを通っていない（aliased でない）→ 期待する種別
 * listPinnedWorkspaceDirectory   ↑で確かめたフォルダを realPath で readdir
 *                                → 読んだ後にもう一度 recheck（途中で差し替えられたら捨てる）
 * readVerifiedFileBytes          ↑で確かめたファイルを open → confirm → ハンドル越しに読む
 * confirmPinnedWorkspaceRoot     root が固定値のままか
 * ```
 *
 * 確かめられなかったときは、**root が変わったのか、その位置だけなのか**を返す。root が
 * 変わっていれば要求全体を捨て、位置だけなら読まずにとばす、は呼び出し側（Gate）が決める。
 * Boundary は事実を返すだけで、ここも Policy（Secret・Permission）は見ない。
 */

export type ReadFileBytesDenial =
  'invalid-request' | 'open-failed' | 'handle-unconfirmed' | 'not-found' | 'content-too-large'

export type ReadFileBytesResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly denial: ReadFileBytesDenial }

/** 確かめた対象（読み取り・ファイル）を、確かめたハンドル越しに読む。 */
export async function readVerifiedFileBytes(
  target: VerifiedWorkspaceTarget
): Promise<ReadFileBytesResult> {
  if (target.access !== 'read' || target.state.kind !== 'file') {
    return denied('invalid-request')
  }

  let handle: FileHandle

  try {
    handle = await open(target.realPath, 'r')
  } catch (cause) {
    return denied(errnoCodeOf(cause) === 'ENOENT' ? 'not-found' : 'open-failed')
  }

  try {
    if (!(await confirmOpenedWorkspaceFile(target, handle))) {
      return denied('handle-unconfirmed')
    }

    const stats = await handle.stat({ bigint: true })

    if (stats.size > BigInt(FILES_FILE_MAX_BYTES)) {
      return denied('content-too-large')
    }

    return Object.freeze({ ok: true as const, bytes: await readAll(handle, Number(stats.size)) })
  } catch {
    return denied('open-failed')
  } finally {
    try {
      await handle.close()
    } catch {
      // 閉じられなかった。読んだ結果は変わらない。
    }
  }
}

/**
 * ハンドルから最後まで読む。
 *
 * `size` は開いた後に見た大きさ。読んでいる間に伸びても上限の 1 バイト先までしか
 * 読まない（伸びたものは上限超えとして扱う）。
 */
async function readAll(handle: FileHandle, size: number): Promise<Uint8Array> {
  const limit = Math.min(size, FILES_FILE_MAX_BYTES) + 1
  const buffer = Buffer.alloc(limit)
  let offset = 0

  while (offset < limit) {
    const { bytesRead } = await handle.read(buffer, offset, limit - offset, offset)

    if (bytesRead === 0) {
      break
    }

    offset += bytesRead
  }

  if (offset > FILES_FILE_MAX_BYTES) {
    throw new Error('the file grew beyond the limit while reading')
  }

  return new Uint8Array(buffer.buffer, buffer.byteOffset, offset)
}

/** root を固定して確かめた結果。 */
export type PinnedTargetResult =
  | { readonly ok: true; readonly target: VerifiedWorkspaceTarget }
  | {
      readonly ok: false
      /** root 自体が固定値から変わった（または確かめられない）。 */
      readonly rootChanged: boolean
    }

/** root を固定して並べた結果。 */
export type PinnedDirectoryListing =
  | { readonly ok: true; readonly entries: readonly Dirent[] }
  | { readonly ok: false; readonly rootChanged: boolean }

/**
 * 要求の始めに固定した root が、今も同じ実体・identity か。
 *
 * 固定できる root は、Boundary が読み取りとして確かめた Workspace root（相対位置が空・
 * ディレクトリ）だけ。それ以外を渡されたら false（同じとは言えない）。
 */
export async function confirmPinnedWorkspaceRoot(root: VerifiedWorkspaceTarget): Promise<boolean> {
  if (!isPinnableRoot(root)) {
    return false
  }

  try {
    const current = await recheckWorkspaceTarget(root)

    return current.ok && isSameRoot(root, current.target)
  } catch {
    return false
  }
}

/**
 * 固定した root の下の位置1件を、読み取りとして確かめる。
 *
 * 通すのは次のすべてを満たすときだけ。
 *
 *   - Boundary（STEP2）が Workspace の中の実体として解決した
 *   - そのときの root の実体・identity が、固定した root と同じ
 *   - 途中にリンクを通っていない（`aliased` でない）── 走査は readdir の名前から位置を
 *     組み上げ、リンクには潜らないため、ここでリンクを通るなら差し替えられている
 *   - 期待する種別（ファイル / ディレクトリ）
 *
 * 解決できなかったときは、root が今も固定値のままかを確かめて `rootChanged` を返す。
 */
export async function resolvePinnedWorkspaceTarget(
  root: VerifiedWorkspaceTarget,
  relativePath: string,
  kind: 'file' | 'directory'
): Promise<PinnedTargetResult> {
  if (!isPinnableRoot(root)) {
    return ROOT_CHANGED
  }

  try {
    const resolved = await resolveWorkspaceTarget(root.rootPath, relativePath, 'read')

    if (!resolved.ok) {
      return (await confirmPinnedWorkspaceRoot(root)) ? POSITION_UNVERIFIED : ROOT_CHANGED
    }

    const target = resolved.target

    if (!isSameRoot(root, target)) {
      return ROOT_CHANGED
    }

    if (target.aliased || target.state.kind !== kind) {
      return POSITION_UNVERIFIED
    }

    return Object.freeze({ ok: true as const, target })
  } catch {
    return (await confirmPinnedWorkspaceRoot(root)) ? POSITION_UNVERIFIED : ROOT_CHANGED
  }
}

/**
 * 固定した root の下のフォルダを1階層並べる。
 *
 * **潜る前に**確かめる（resolvePinnedWorkspaceTarget。root 自身は confirmPinnedWorkspaceRoot）
 * ── 外のフォルダを並べてから弾くのではない。並べるのは確かめた実体の場所（realPath）で、
 * 並べた後にもう一度 recheck し、実体・identity が変わっていたら並べた結果を捨てる
 * （確かめてから readdir までの間に差し替えられた一覧を、走査へ渡さない）。
 */
export async function listPinnedWorkspaceDirectory(
  root: VerifiedWorkspaceTarget,
  relativePath: string
): Promise<PinnedDirectoryListing> {
  let target: VerifiedWorkspaceTarget

  if (relativePath === '') {
    if (!(await confirmPinnedWorkspaceRoot(root))) {
      return ROOT_CHANGED
    }

    target = root
  } else {
    const resolved = await resolvePinnedWorkspaceTarget(root, relativePath, 'directory')

    if (!resolved.ok) {
      return resolved
    }

    target = resolved.target
  }

  let entries: Dirent[]

  try {
    entries = await readdir(target.realPath, { withFileTypes: true })
  } catch {
    return (await confirmPinnedWorkspaceRoot(root)) ? POSITION_UNVERIFIED : ROOT_CHANGED
  }

  try {
    const after = await recheckWorkspaceTarget(target)

    if (after.ok && isSameRoot(root, after.target)) {
      return Object.freeze({ ok: true as const, entries: Object.freeze(entries) })
    }
  } catch {
    // 下で root を確かめる。
  }

  return (await confirmPinnedWorkspaceRoot(root)) ? POSITION_UNVERIFIED : ROOT_CHANGED
}

function isPinnableRoot(root: unknown): root is VerifiedWorkspaceTarget {
  return (
    isVerifiedWorkspaceTarget(root) &&
    root.access === 'read' &&
    root.canonicalRelativePath === '' &&
    root.state.kind === 'directory'
  )
}

function isSameRoot(pinned: VerifiedWorkspaceTarget, current: VerifiedWorkspaceTarget): boolean {
  return (
    isSamePath(pinned.realRootPath, current.realRootPath) &&
    pinned.rootIdentity.dev === current.rootIdentity.dev &&
    pinned.rootIdentity.ino === current.rootIdentity.ino
  )
}

const ROOT_CHANGED = Object.freeze({ ok: false as const, rootChanged: true })
const POSITION_UNVERIFIED = Object.freeze({ ok: false as const, rootChanged: false })

function denied(denial: ReadFileBytesDenial): ReadFileBytesResult {
  return Object.freeze({ ok: false as const, denial })
}
