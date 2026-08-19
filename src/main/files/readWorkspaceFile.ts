import { readFile, realpath, stat } from 'fs/promises'
import {
  FILES_FILE_MAX_BYTES,
  splitRelativePath,
  type FileEncoding,
  type FileLineEnding,
  type FileRevision,
  type WorkspaceFileStatus
} from '@shared/files'
import { detectEncoding, detectLineEnding, looksBinary, stripBom } from './fileContent'
import {
  isInsideWorkspace,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath
} from './workspacePath'

/**
 * Workspace の中のファイル1件を読む。
 *
 * readWorkspaceDirectory.ts と同じ経路（文字列の検証 → realpath → 境界 → 読む）を通る。
 * 違うのは対象がフォルダではなくファイルであることだけで、境界の確かめ方は変えない。
 *
 * ## ここは対象そのものの realpath を見る
 *
 * 作成 / 改名 / 削除（mutateWorkspaceEntry.ts）が**親フォルダ**を見るのに対し、
 * 読み込みは**対象そのもの**を realpath まで解決してから境界に通す。
 * 目的が違うため。
 *
 *   読む   … 外の実体の中身を Renderer へ渡さない ＝ 指し先を見る必要がある
 *   消す   … 外の実体には触れず、Workspace の中のリンクを外す ＝ 親を見れば足りる
 *
 * 結果として「Workspace の外を指す symlink は、開けないが消せる」になる。
 * ツリーに並んでいるのに手が出せないものを作らず、外の中身も渡さない。
 *
 * ## 大きすぎる / バイナリは失敗ではない
 *
 * どちらも「読めたが、テキストとしては出せない」という結末なので、
 * 失敗ではなく status として返す（shared/files/content.ts）。
 * 消えている・権限が無い・Workspace の外は失敗のまま。
 */

export type ReadWorkspaceFileOutcome =
  | {
      readonly status: 'ok'
      readonly relativePath: string
      readonly name: string
      /** テキストとして出せるか（'ok' / 'binary' / 'too-large'）。 */
      readonly fileStatus: WorkspaceFileStatus
      readonly byteLength: number
      readonly content: string | null
      readonly lineEnding: FileLineEnding | null
      /**
       * 読み込んだ時点の文字コード。保存でそのまま書き戻すために持つ。
       *
       * 中身を渡していない（binary / too-large）場合は null。
       */
      readonly encoding: FileEncoding | null
      /**
       * 読み込んだ時点の版（保存の起点）。
       *
       * 中身を渡していない（binary / too-large）場合は保存の起点にもならないため null。
       */
      readonly revision: FileRevision | null
    }
  | { readonly status: 'invalid-path' }
  | { readonly status: 'outside-workspace' }
  | { readonly status: 'not-found' }
  | { readonly status: 'permission-denied' }
  /** フォルダを開こうとした。 */
  | { readonly status: 'not-a-file' }
  | { readonly status: 'failed'; readonly detail: string }

function errorCodeOf(cause: unknown): string | null {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const { code } = cause as { code: unknown }
    return typeof code === 'string' ? code : null
  }

  return null
}

function toFailureOutcome(cause: unknown): ReadWorkspaceFileOutcome {
  switch (errorCodeOf(cause)) {
    case 'ENOENT':
      return { status: 'not-found' }

    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return { status: 'permission-denied' }

    case 'EISDIR':
      return { status: 'not-a-file' }

    case 'ELOOP':
    case 'ENAMETOOLONG':
    case 'EINVAL':
    case 'ENOTDIR':
      return { status: 'invalid-path' }

    default:
      return { status: 'failed', detail: String(cause) }
  }
}

export async function readWorkspaceFile(
  rootPath: string,
  rawRelativePath: unknown
): Promise<ReadWorkspaceFileOutcome> {
  // 1. 文字列としての検証（`..`・絶対パス・NUL など）。
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  if (relativePath === null) {
    return { status: 'invalid-path' }
  }

  // root（空文字）はファイルではない。名前も取れないため、ここで落とす。
  const split = splitRelativePath(relativePath)

  if (split === null) {
    return { status: 'not-a-file' }
  }

  // 2. root と組んだ結果が Workspace の中に収まるか（文字列としての判断）。
  const absolutePath = resolveWorkspacePath(rootPath, relativePath)

  if (absolutePath === null) {
    return { status: 'outside-workspace' }
  }

  // 3. 実体を見て、もう一度 Workspace の中か確かめる（symlink / ジャンクション）。
  let realRootPath: string
  let realPath: string

  try {
    realRootPath = await realpath(rootPath)
  } catch (cause) {
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

  // 4. 大きさを先に見る。読んでから捨てるのでは、読む時点で固まる。
  let byteLength: number
  let revision: FileRevision

  try {
    const stats = await stat(realPath)

    if (stats.isDirectory()) {
      return { status: 'not-a-file' }
    }

    byteLength = stats.size
    /*
      版は「大きさを確かめたのと同じ stat」から採る。
      読んだ後にもう一度 stat すると、読んでいる最中に書き換えられた場合に
      「新しい版で、古い中身」という組み合わせを Renderer へ渡すことになる。
      逆（古い版・新しい中身）なら、保存時に stale として気づける側へ倒れる。
    */
    revision = { mtimeMs: stats.mtimeMs, size: stats.size }
  } catch (cause) {
    return toFailureOutcome(cause)
  }

  if (byteLength > FILES_FILE_MAX_BYTES) {
    return {
      status: 'ok',
      relativePath,
      name: split.name,
      fileStatus: 'too-large',
      byteLength,
      content: null,
      lineEnding: null,
      encoding: null,
      revision: null
    }
  }

  /*
    5. 読む。

    渡すのは realpath 側。検証したのはこちらであり、絶対パスの方を渡すと
    「確かめた対象」と「読む対象」が別物になる（readWorkspaceDirectory.ts と同じ）。
  */
  let bytes: Buffer

  try {
    bytes = await readFile(realPath)
  } catch (cause) {
    return toFailureOutcome(cause)
  }

  if (looksBinary(bytes)) {
    return {
      status: 'ok',
      relativePath,
      name: split.name,
      fileStatus: 'binary',
      byteLength,
      content: null,
      lineEnding: null,
      encoding: null,
      revision: null
    }
  }

  /*
    BOM は中身から落とし、「付いていた」という事実だけを encoding として持ち回る。
    落とさないと Monaco の1行目の先頭に見えない文字が残り、
    事実を持ち回らないと保存した瞬間に BOM が消える（main/files/fileContent.ts）。
  */
  const encoding = detectEncoding(bytes)
  const content = stripBom(bytes.toString('utf8'))

  return {
    status: 'ok',
    relativePath,
    name: split.name,
    fileStatus: 'ok',
    byteLength,
    content,
    lineEnding: detectLineEnding(content),
    encoding,
    revision
  }
}
