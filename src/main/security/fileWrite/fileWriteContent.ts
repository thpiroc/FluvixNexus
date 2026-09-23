import { FILES_FILE_MAX_BYTES, type FileEncoding } from '@shared/files'
import { encodeFileContent } from '../../files/fileContent'
import { APPROVAL_CONTENT_MAX_CHARS } from '../approval/approvalAction'

/**
 * 提案された本文を、書いてよい形にする（Security Core v1 の STEP7。Electron にも fs にも依存しない）。
 *
 * **上限は既存のものを使い回す。** STEP7 のためだけに別の値を作ると、
 * 「Editor では開けないのに Agent は書ける」「承認は通るのに書けない」が生まれる。
 *
 * ```
 * APPROVAL_CONTENT_MAX_CHARS  1,000,000 文字  承認が受け付ける本文の上限（STEP6）
 *                                             = STEP3 の SECRET_SCAN_MAX_CHARS
 * FILES_FILE_MAX_BYTES        2 MiB           Editor が開ける上限（shared/files/content.ts）
 * ```
 *
 * 文字数とバイト数の**両方**を見る。文字数だけでは日本語の本文が 3 MiB になりうるし、
 * バイト数だけでは Secret の検査が最後まで走らない大きさのものが通る。
 *
 * ## v1 は UTF-8 のテキストだけ
 *
 * binary の書き込みは**同じ API に含めない**（DESIGN.md §6.4）。ここでは
 *
 *   - NUL を含む本文（既存の `looksBinary` と同じ判断）
 *   - UTF-8 として往復できない本文（対になっていないサロゲート）
 *
 * を拒む。往復を確かめるのは、`Buffer.from(text, 'utf8')` が壊れた並びを U+FFFD へ
 * 置き換えるため ── 黙って別の中身が書かれると、**承認した本文と書かれた本文が
 * 食い違う**（fingerprint は置き換え前の文字列から作られている）。
 *
 * ## 改行も BOM も変換しない
 *
 * 提案された本文はそのまま書く。BOM は**開いたときの形**に合わせる
 * （既存ファイルは今ディスクにある形、新しいファイルは BOM 無し）。
 * 既存の Editor の保存（files/writeWorkspaceFile.ts）と同じ判断で、Main 側で
 * 形を揃えると「開いて保存しただけで差分が出る」が起きる。
 */

/** 本文を受け付けられなかった理由（`AuditReason` にある語）。 */
export type FileWriteContentDenial = 'invalid-request' | 'content-too-large' | 'unsupported-content'

export type FileWriteContentResult =
  | {
      readonly ok: true
      /** そのまま書く本文（提案されたもの）。 */
      readonly content: string
      /** 実際にディスクへ書くバイト列（BOM はここで付く）。 */
      readonly bytes: Buffer
    }
  | { readonly ok: false; readonly denial: FileWriteContentDenial }

/**
 * 提案された本文を確かめ、書くバイト列にする。**例外を投げない。**
 *
 * `encoding` は既存ファイルなら今ディスクにある形、新しいファイルなら `'utf8'`。
 */
export function prepareFileWriteContent(
  rawContent: unknown,
  encoding: FileEncoding
): FileWriteContentResult {
  if (typeof rawContent !== 'string') {
    return DENIED['invalid-request']
  }

  if (rawContent.length > APPROVAL_CONTENT_MAX_CHARS) {
    return DENIED['content-too-large']
  }

  // NUL があるものは binary として扱う（files/fileContent.ts の looksBinary と同じ判断）。
  if (rawContent.includes('\0')) {
    return DENIED['unsupported-content']
  }

  let bytes: Buffer

  try {
    bytes = encodeFileContent(rawContent, encoding)
  } catch {
    return DENIED['unsupported-content']
  }

  if (bytes.byteLength > FILES_FILE_MAX_BYTES) {
    return DENIED['content-too-large']
  }

  /*
    往復して同じ文字列に戻るか。戻らないものは、書いた後のファイルを読み直すと
    提案された本文と違うものになる（＝ post-write verification が必ず落ちる）。
    ここで拒んでおく方が、承認を1回無駄にさせずに済む。
  */
  if (bytes.toString('utf8') !== (encoding === 'utf8-bom' ? `﻿${rawContent}` : rawContent)) {
    return DENIED['unsupported-content']
  }

  return Object.freeze({ ok: true as const, content: rawContent, bytes })
}

const DENIED = Object.freeze({
  'invalid-request': Object.freeze({ ok: false as const, denial: 'invalid-request' as const }),
  'content-too-large': Object.freeze({ ok: false as const, denial: 'content-too-large' as const }),
  'unsupported-content': Object.freeze({
    ok: false as const,
    denial: 'unsupported-content' as const
  })
})
