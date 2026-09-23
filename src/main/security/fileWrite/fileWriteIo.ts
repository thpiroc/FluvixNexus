import { createHash } from 'crypto'
import { lstat, open, unlink, type FileHandle } from 'fs/promises'
import { FILES_FILE_MAX_BYTES, type FileEncoding } from '@shared/files'
import { errnoCodeOf } from '../../files/errno'
import { detectEncoding, looksBinary, stripBom } from '../../files/fileContent'
import {
  confirmOpenedWorkspaceFile,
  type FileIdentity,
  type VerifiedWorkspaceTarget
} from '../boundary/workspaceBoundary'

/**
 * 実際にディスクを読む / 書く部分（Security Core v1 の STEP7）。
 *
 * **確かめた対象を開き、開いたハンドルが確かめた対象だと確認できたときだけ、
 * そのハンドル越しにだけ触る。** パスを渡す fs の API（`writeFile` / `truncate`）は
 * 使わない ── 確かめてから触るまでの間に途中の要素が差し替えられると、パスは
 * 別の実体を指すようになるため（DESIGN.md §6.4 の TOCTOU）。
 *
 * ```
 * recheck（Gate）      → 直前にもう一度 Boundary を通す
 * open                 既存は 'r+'（切り詰めない）・新規は 'wx+'（排他作成）
 * confirm              confirmOpenedWorkspaceFile（identity・リンク数・親の実体）
 * 既存の中身の照合      承認したときの中身と同じか（ハンドル越しに読む）
 * write → truncate      位置 0 から全部書いてから、長さを合わせる
 * sync                  書いたものをディスクへ流す
 * verify               ハンドル越しに読み直して、バイト列が一致するか
 * confirm（もう一度）   書いた後も、そのハンドルが確かめた対象のままか
 * ```
 *
 * ## 切り詰める順番
 *
 * 既存のファイルは `'w'` ではなく **`'r+'` で開く。** `'w'` は開いた瞬間に中身を消すため、
 * confirm が通らなかったとき（＝ 別の実体を開いていたとき）には、**確認する前に
 * 他人のファイルを空にしてしまう。**
 *
 * 書く順も「先に truncate(0)」にはしない。**全部書いてから、長さを合わせる。**
 * 先に空にすると、書き込みが途中で失敗したときにファイルが空のまま残る。
 * 後から詰める形なら、失敗しても**古い中身の続き**が残る（望ましくはないが、
 * 空よりは失われるものが少ない）。
 *
 * ## atomic な temp + rename は採らない
 *
 * 一時ファイルへ書いて差し替える形は、**採らない。**
 *
 *   - 差し替えると元のファイルの属性（ACL・hard link・監視ハンドル・作成日時）を失う。
 *     既存の Editor の保存（files/writeWorkspaceFile.ts）が同じ理由でそうしている
 *   - rename はパスに対する操作で、**ハンドルで確かめた実体には結び付かない。**
 *     confirm を通した意味が消える（差し替えの隙が rename の側へ移るだけ）
 *   - Windows の rename は、対象が開かれていると失敗する。Editor で開いたままの
 *     ファイルへ Agent が書けない、という食い違いが起きる
 *
 * 「一般に atomic だから」は採用の理由にしない。**この経路で守りたいのは
 * 「書き込みの途中で落ちても壊れない」ではなく「確かめた実体にだけ書く」**にあたる。
 *
 * ## 新しいファイルを作ってしまったときは、消す
 *
 * 新規は `'wx+'`（排他作成）で開くため、**開いた時点でファイルができる。** その後の
 * confirm が通らなかった場合（開く瞬間に途中の要素が外へのリンクへ差し替えられた）、
 * そのファイルは Workspace の外にできている可能性がある。**ハンドルの identity と
 * 一致することを確かめてから unlink する** ── 一致を見ずに消すと、差し替えた先の
 * 別のファイルを消すことになる。
 */

/** 読み書きが通らなかった理由（`AuditReason` にある語）。 */
export type FileWriteIoDenial =
  | 'invalid-request'
  | 'open-failed'
  | 'handle-unconfirmed'
  | 'not-found'
  | 'not-a-file'
  | 'target-exists'
  | 'existing-file-changed'
  | 'content-too-large'
  | 'unsupported-content'
  | 'write-failed'
  | 'verify-failed'

/** 今ディスクにある中身（承認の前に読む）。 */
export type ReadCurrentFileResult =
  | {
      readonly ok: true
      /** BOM を落とした本文（Diff の左に出すもの）。 */
      readonly text: string
      /** 今ディスクにある形（書き戻すときも同じ形にする）。 */
      readonly encoding: FileEncoding
      /**
       * 今の中身の指紋（生のバイト列の SHA-256）。
       *
       * **Main の中だけで使う。** Audit にも Renderer にも出さない（DESIGN.md §6.4）。
       * 書き込みの直前に、承認を出したときから中身が変わっていないかを見るためだけの値。
       */
      readonly contentHash: string
    }
  | { readonly ok: false; readonly denial: FileWriteIoDenial }

export type WriteFileResult =
  { readonly ok: true } | { readonly ok: false; readonly denial: FileWriteIoDenial }

/**
 * 既存ファイルの今の中身を、確かめた対象から読む。
 *
 * 開いて confirm を通してからハンドル越しに読む（パスで読み直さない）。**例外を投げない。**
 */
export async function readCurrentFile(
  target: VerifiedWorkspaceTarget
): Promise<ReadCurrentFileResult> {
  if (target.state.kind !== 'file') {
    return denied('invalid-request')
  }

  let handle: FileHandle

  try {
    handle = await open(target.realPath, 'r')
  } catch (cause) {
    return denied(openDenial(cause))
  }

  try {
    if (!(await confirmOpenedWorkspaceFile(target, handle))) {
      return denied('handle-unconfirmed')
    }

    const stats = await handle.stat({ bigint: true })

    if (stats.size > BigInt(FILES_FILE_MAX_BYTES)) {
      return denied('content-too-large')
    }

    const bytes = await readAll(handle, Number(stats.size))

    if (looksBinary(bytes)) {
      return denied('unsupported-content')
    }

    const encoding = detectEncoding(bytes)
    const text = stripBom(bytes.toString('utf8'))

    /*
      UTF-8 として往復できないファイル（壊れた並び・別の文字コード）は扱わない。
      往復しないまま Diff を出すと、画面には U+FFFD が並び、承認しても
      「見たとおりの変更」にはならない。
    */
    if (!bytes.equals(encodeWithEncoding(text, encoding))) {
      return denied('unsupported-content')
    }

    return Object.freeze({ ok: true as const, text, encoding, contentHash: hashOf(bytes) })
  } catch {
    return denied('open-failed')
  } finally {
    await closeQuietly(handle)
  }
}

/**
 * 確かめた対象へ書く。
 *
 * `expectedContentHash` は既存ファイルのときだけ渡す（承認を出したときの中身の指紋）。
 * 新しいファイルのときは `null`。**例外を投げない。**
 */
export async function writeConfirmedFile(
  target: VerifiedWorkspaceTarget,
  bytes: Buffer,
  expectedContentHash: string | null
): Promise<WriteFileResult> {
  /*
    書き込みとして確かめた対象しか触らない。読み取りとして確かめた対象は、
    リンク数を見ていない（confirmOpenedWorkspaceFile が hard link を通す）。
  */
  if (target.access !== 'write') {
    return denied('invalid-request')
  }

  const creating = target.state.kind === 'missing'

  if (!creating && target.state.kind !== 'file') {
    return denied('invalid-request')
  }

  if (creating !== (expectedContentHash === null)) {
    // 新規なのに指紋がある / 既存なのに指紋が無い。組み立てを間違えている。
    return denied('invalid-request')
  }

  let handle: FileHandle

  try {
    /*
      既存は 'r+'（読み書き・切り詰めない）、新規は 'wx+'（読み書き・排他作成）。
      どちらも**読める形で開く** ── 書いた後に同じハンドルから読み直して
      確かめるため（パスで開き直すと、別の実体を読みうる）。
      新規に 'w' 系を使っても、`x`（O_EXCL）が付いている限り既存のものは開かない。
    */
    handle = await open(target.realPath, creating ? 'wx+' : 'r+')
  } catch (cause) {
    return denied(creating ? createDenial(cause) : openDenial(cause))
  }

  let confirmed = false
  let succeeded = false
  let created: FileIdentity | null = null

  try {
    if (creating) {
      created = identityOf(await handle.stat({ bigint: true }))
    }

    if (!(await confirmOpenedWorkspaceFile(target, handle))) {
      return denied('handle-unconfirmed')
    }

    confirmed = true

    if (expectedContentHash !== null) {
      const current = await readAllOfHandle(handle)

      // 承認を見せている間に、他のプロセス・利用者・Editor が書き換えていないか。
      if (hashOf(current) !== expectedContentHash) {
        return denied('existing-file-changed')
      }
    }

    await writeAll(handle, bytes)
    await handle.truncate(bytes.byteLength)
    await handle.sync()

    // 書いた後の確認は、同じハンドルから読み直す（パスで開き直すと別の実体を読みうる）。
    const written = await readAllOfHandle(handle)

    if (!written.equals(bytes)) {
      return denied('verify-failed')
    }

    // 書いている間に hard link を張られた・親が差し替えられた、をもう一度見る。
    if (!(await confirmOpenedWorkspaceFile(target, handle))) {
      return denied('verify-failed')
    }

    succeeded = true

    return OK
  } catch {
    return denied(confirmed ? 'write-failed' : 'handle-unconfirmed')
  } finally {
    await closeQuietly(handle)

    if (created !== null && !succeeded) {
      // 作ったが最後まで通らなかった。作ったものだけを消す。
      await removeCreatedFile(target.realPath, created)
    }
  }
}

/**
 * 作ってしまったファイルを、確かめてから消す。
 *
 * 新規は `'wx+'` で開くため、**confirm が通らなかったときにはもうファイルができている。**
 * 開く瞬間に途中の要素が外へのリンクへ差し替えられていた場合、そのファイルは
 * Workspace の外にある ── 中身は1バイトも書いていないが、空のファイルが残るのは
 * 副作用にあたるため、ここで片付ける（DESIGN.md §6.4 の「外への空ファイルを作らない」）。
 *
 * 消す前に**開いたときの identity（dev / ino）と一致すること**を確かめる。
 * 一致を見ずに消すと、差し替えられた先にもともとあった別のファイルを消すことになる。
 */
async function removeCreatedFile(realPath: string, created: FileIdentity): Promise<void> {
  try {
    const stats = await lstat(realPath, { bigint: true })

    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n) {
      return
    }

    if (stats.dev !== created.dev || stats.ino !== created.ino) {
      // 今その位置にあるのは、こちらが作ったものではない。
      return
    }

    await unlink(realPath)
  } catch {
    // 消せなかった（開かれている・権限）。空のファイルが残るが、これ以上できることは無い。
  }
}

/** 位置 0 から `size` バイト読む（ハンドルの位置に依らない）。 */
async function readAll(handle: FileHandle, size: number): Promise<Buffer> {
  if (size === 0) {
    return Buffer.alloc(0)
  }

  const buffer = Buffer.alloc(size)
  let read = 0

  while (read < size) {
    const { bytesRead } = await handle.read(buffer, read, size - read, read)

    if (bytesRead === 0) {
      // 読んでいる途中で短くなった。読めた分だけを返す（比較はそこで外れる）。
      return buffer.subarray(0, read)
    }

    read += bytesRead
  }

  return buffer
}

/** ハンドルが指す実体の全体を読む。 */
async function readAllOfHandle(handle: FileHandle): Promise<Buffer> {
  const stats = await handle.stat({ bigint: true })

  if (stats.size > BigInt(FILES_FILE_MAX_BYTES)) {
    // 上限を超えている。比較できないため、空として扱う（照合は必ず外れる）。
    return Buffer.alloc(0)
  }

  return readAll(handle, Number(stats.size))
}

/**
 * 位置 0 から全部書く。
 *
 * `write` は1回で全部書けるとは限らない（partial write）。書けた分だけ進めて、
 * 残りを書き続ける。**1回で書けたことを前提にしない。**
 */
async function writeAll(handle: FileHandle, bytes: Buffer): Promise<void> {
  let written = 0

  while (written < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, written, bytes.byteLength - written, written)

    if (bytesWritten <= 0) {
      throw new Error('the write made no progress.')
    }

    written += bytesWritten
  }
}

function encodeWithEncoding(text: string, encoding: FileEncoding): Buffer {
  return Buffer.from(encoding === 'utf8-bom' ? `﻿${text}` : text, 'utf8')
}

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function identityOf(stats: { readonly dev: bigint; readonly ino: bigint }): FileIdentity {
  return Object.freeze({ dev: stats.dev, ino: stats.ino })
}

async function closeQuietly(handle: FileHandle): Promise<void> {
  try {
    await handle.close()
  } catch {
    // 閉じられなかった。結論は変えない。
  }
}

/** 既存のものを開けなかった理由。 */
function openDenial(cause: unknown): FileWriteIoDenial {
  switch (errnoCodeOf(cause)) {
    case 'ENOENT':
      return 'not-found'

    case 'EISDIR':
      return 'not-a-file'

    default:
      return 'open-failed'
  }
}

/** 新しく作れなかった理由。 */
function createDenial(cause: unknown): FileWriteIoDenial {
  return errnoCodeOf(cause) === 'EEXIST' ? 'target-exists' : 'open-failed'
}

function denied(denial: FileWriteIoDenial): {
  readonly ok: false
  readonly denial: FileWriteIoDenial
} {
  return Object.freeze({ ok: false as const, denial })
}

const OK: WriteFileResult = Object.freeze({ ok: true })
