import { open, type FileHandle } from 'fs/promises'
import { FILES_FILE_MAX_BYTES } from '@shared/files'
import { errnoCodeOf } from '../../files/errno'
import {
  confirmOpenedWorkspaceFile,
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
 * TOCTOU）。**例外を投げない。**
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

function denied(denial: ReadFileBytesDenial): ReadFileBytesResult {
  return Object.freeze({ ok: false as const, denial })
}
