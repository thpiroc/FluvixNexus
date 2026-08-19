import { FILES_BINARY_SNIFF_BYTES, type FileEncoding, type FileLineEnding } from '@shared/files'

/**
 * 読み込んだバイト列をテキストとして扱えるかの判断と、その変換。
 *
 * fs には触れない（テストできる形にしておく）。実際に読むのは readWorkspaceFile.ts。
 * workspacePath.ts が「パス文字列の判断」を持っているのと同じ立ち位置で、
 * こちらは「中身の判断」を持つ。
 *
 * ## 文字コードの境界はここ
 *
 * 「バイト列 ↔ 文字列」の変換をこの1ファイルに閉じてある。今は UTF-8（BOM の有無）
 * だけを扱うが、Shift_JIS / UTF-16 を足すときも増えるのはここと
 * writeWorkspaceFile.ts の書き出しだけで、IPC の契約（encoding を持ち回る形）も
 * Editor の経路も変わらない（shared/files/content.ts の FileEncoding）。
 */

/** UTF-8 の BOM（文字として）。Windows のツールが付けることがある。 */
const UTF8_BOM = '﻿'

/** UTF-8 の BOM（バイト列として）。 */
const UTF8_BOM_BYTES = Uint8Array.from([0xef, 0xbb, 0xbf])

/**
 * バイナリか。
 *
 * 先頭 FILES_BINARY_SNIFF_BYTES バイトに NUL があればバイナリとみなす（git と同じ判断）。
 * 全体を走査しないのは、判定のためだけに大きなファイルを舐める意味が無いため。
 *
 * **UTF-16 のテキストもバイナリとして扱われる。** ASCII 文字が並ぶと NUL が
 * 1バイトおきに現れるため。文字コードの判別と変換は後続（Editor が
 * 文字コードを選べるようになる段階）で、今は「UTF-8 だけを開く」と決めている。
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, FILES_BINARY_SNIFF_BYTES)

  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return true
    }
  }

  return false
}

/**
 * 読み込んだ時点の改行。
 *
 * 混在している場合は、最初に見つかった方を採る。保存を実装する際に
 * 「開いたときの形」を保つために持つ値なので、多数決より
 * 「そのファイルが元々どちらで書かれていたか」に寄せる。
 */
export function detectLineEnding(text: string): FileLineEnding {
  const firstLineFeed = text.indexOf('\n')

  if (firstLineFeed < 0) {
    // 改行が無いファイル。Windows を対象にしているため、新しい行を足すなら CRLF。
    return 'crlf'
  }

  return firstLineFeed > 0 && text[firstLineFeed - 1] === '\r' ? 'crlf' : 'lf'
}

/** 先頭の BOM を落とす。無ければそのまま返す。 */
export function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text
}

/**
 * 読み込んだバイト列の文字コード。
 *
 * BOM が付いていたかどうかだけを見る。中身から Shift_JIS などを推定はしない
 * ── 推定は外れるうえ、外れたことに気づけるのは**保存して壊れた後**になる。
 * UTF-8 として読めないものは binary として扱う方が、化けた内容を
 * 編集して保存できる状態を作らずに済む（shared/files/content.ts）。
 */
export function detectEncoding(bytes: Uint8Array): FileEncoding {
  return startsWithUtf8Bom(bytes) ? 'utf8-bom' : 'utf8'
}

function startsWithUtf8Bom(bytes: Uint8Array): boolean {
  if (bytes.length < UTF8_BOM_BYTES.length) {
    return false
  }

  return UTF8_BOM_BYTES.every((byte, index) => bytes[index] === byte)
}

/**
 * 書き出すバイト列を作る。
 *
 * 中身の文字列に BOM は含まれない（読むときに落としてある）ため、
 * `utf8-bom` のときだけ先頭に足す。**開いたときの形をそのまま書き戻す**のが目的で、
 * ここで形を揃えようとすると「開いて保存しただけで差分が出る」が起きる
 * （改行を Main 側で変換しないのと同じ判断。shared/ipc/contracts/files.ts）。
 */
export function encodeFileContent(content: string, encoding: FileEncoding): Buffer {
  const body = Buffer.from(content, 'utf8')

  return encoding === 'utf8-bom' ? Buffer.concat([Buffer.from(UTF8_BOM_BYTES), body]) : body
}
