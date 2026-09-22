import { FILES_FILE_MAX_BYTES } from '@shared/files'
import { looksBinary, stripBom } from '../../files/fileContent'
import { SECRET_SCAN_MAX_CHARS } from './secretMasking'

/**
 * バイト列を Secret の検査にかけてよいか（Security Core v1 の STEP3）。
 *
 * **既存の Files の上限をそのまま使う。** 別の上限を STEP3 で作ると、Editor が開けない
 * 大きさのファイルを Agent の経路だけが読む、という食い違いが生まれる。
 *
 * ```
 * FILES_FILE_MAX_BYTES   2 MiB   shared/files/content.ts（Editor が開ける上限と同じ）
 * looksBinary            先頭 8000 バイトに NUL  main/files/fileContent.ts（git と同じ判断）
 * SECRET_SCAN_MAX_CHARS  1,000,000 文字  secretMasking.ts（STEP3 で足した上限）
 * ```
 *
 * バイナリは**文字列にしない。** 文字列にしてから捨てるのでは、捨てる前に 2 MiB の
 * 復号を通すことになるうえ、化けた文字列に対する検出の結果には意味が無い。
 *
 * 読み取りそのものはここではしない（fs に触れない ── ファイルを開くのは後の STEP の
 * Gate の役目で、ここは開いた結果の扱いだけを決める）。
 */

export type SecretScanTarget =
  /** 検査してよい本文（BOM は落としてある）。 */
  | { readonly kind: 'text'; readonly text: string }
  /** バイナリ。中身は渡さない。 */
  | { readonly kind: 'binary' }
  /** 大きすぎる。中身は渡さない。 */
  | { readonly kind: 'too-large' }
  /** バイト列として読めなかった。 */
  | { readonly kind: 'unreadable' }

/**
 * 読み込んだバイト列を、検査にかけられる本文にする。
 *
 * 判断できないもの（Uint8Array でない・復号に失敗した）は `unreadable` にする。
 * ここで `text` を返さない限り、後続は本文を持たない。
 */
export function scanTargetFromBytes(bytes: unknown): SecretScanTarget {
  if (!(bytes instanceof Uint8Array)) {
    return UNREADABLE
  }

  if (bytes.byteLength > FILES_FILE_MAX_BYTES) {
    return TOO_LARGE
  }

  try {
    if (looksBinary(bytes)) {
      return BINARY
    }

    const text = stripBom(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')
    )

    return text.length > SECRET_SCAN_MAX_CHARS
      ? TOO_LARGE
      : Object.freeze({ kind: 'text' as const, text })
  } catch {
    return UNREADABLE
  }
}

const BINARY: SecretScanTarget = Object.freeze({ kind: 'binary' })
const TOO_LARGE: SecretScanTarget = Object.freeze({ kind: 'too-large' })
const UNREADABLE: SecretScanTarget = Object.freeze({ kind: 'unreadable' })
