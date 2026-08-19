import { realpath, stat, writeFile } from 'fs/promises'
import {
  FILES_FILE_MAX_BYTES,
  isFileEncoding,
  splitRelativePath,
  type FileEncoding,
  type FileRevision
} from '@shared/files'
import { encodeFileContent } from './fileContent'
import {
  isInsideWorkspace,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath
} from './workspacePath'

/**
 * Workspace の中のファイル1件へ書き戻す（Editor の保存）。
 *
 * readWorkspaceFile.ts と対になる。読む側と同じ経路
 * （文字列の検証 → realpath → 境界 → 対象の種別）を通り、最後だけが read ではなく write。
 *
 * ## 見るのは対象そのもの（親ではない）
 *
 * 作成 / 改名 / 削除（mutateWorkspaceEntry.ts）は**親フォルダ**を見る。
 * それらは「Workspace の中のリンクを外す」操作であって、指し先には触れないため。
 * 保存は逆で、**指し先の中身を書き換える**操作になる。
 * 親だけを見ていると、Workspace の中に置かれた「外を指す symlink」を通して
 * 外のファイルを書き換えられてしまう。
 *
 * ```
 * 読む   対象自身   外の実体の中身を渡さない
 * 保存   対象自身   外の実体の中身を書き換えない   ← ここ
 * 作る   親        外の実体には触れず、中のリンクを外す
 * ```
 *
 * ## 新しいファイルは作らない
 *
 * 対象が無ければ `not-found` を返す。保存は「今開いているファイルへ書き戻す」操作で、
 * 開けた時点でそのファイルは Workspace の中にあったことが確かめられている。
 * 無い場合に作る形にすると、
 *   - 確かめる対象が「対象自身」と「親」の2通りに分かれる（上の表が崩れる）
 *   - `files:create` と役割が重なり、同名衝突の扱いが2箇所に散る
 * ため、ここでは作らない。開いていたファイルが外から消された場合は
 * 保存が失敗し、Editor 側は未保存のまま残る（内容は失われない）。
 *
 * ## 無条件には上書きしない
 *
 * `baseRevision` が渡されていて、今ディスクにある版と食い違っていれば**書かずに**
 * `stale` を返す。ファイルはアプリの外でも書き換わるため、
 * 「開いたときのまま保存しようとしているか」をここで確かめられるようにしてある
 * （shared/files/content.ts）。どう見せるか・上書きするかは Renderer 側の判断で、
 * この層は書かないことだけを決める。
 *
 * ## 文字コードは読んだときの形のまま
 *
 * `encoding` は読み込みの応答で返したものがそのまま返ってくる。今のところ
 * 違いは BOM の有無だけで、変換は fileContent.ts が持つ。ここが勝手に決めると
 * 「BOM 付きで開いたファイルが、保存すると BOM 無しになる」が起きる
 * （改行を Main 側で揃えないのと同じ判断）。
 *
 * ## 失敗しても投げない
 *
 * 結末を値として返し、ipc/handlers/files.ts が IPC の失敗分類へ翻訳する
 * （読む側・書き換える側と同じ分担）。
 */

export type WriteWorkspaceFileOutcome =
  | {
      readonly status: 'ok'
      readonly relativePath: string
      /** 書き込んだ結果の版。Renderer は次の baseRevision にする。 */
      readonly revision: FileRevision
    }
  | {
      /** アプリの外で書き換えられていたため書かなかった。 */
      readonly status: 'stale'
      readonly relativePath: string
      /** 今ディスクにある版。 */
      readonly revision: FileRevision
    }
  | { readonly status: 'invalid-path' }
  /** 文字列でない / 大きすぎる中身。 */
  | { readonly status: 'invalid-content' }
  | { readonly status: 'outside-workspace' }
  | { readonly status: 'not-found' }
  | { readonly status: 'permission-denied' }
  /** フォルダを保存しようとした。 */
  | { readonly status: 'not-a-file' }
  | { readonly status: 'failed'; readonly detail: string }

function errorCodeOf(cause: unknown): string | null {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const { code } = cause as { code: unknown }
    return typeof code === 'string' ? code : null
  }

  return null
}

function toFailureOutcome(cause: unknown): WriteWorkspaceFileOutcome {
  switch (errorCodeOf(cause)) {
    case 'ENOENT':
      return { status: 'not-found' }

    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
    case 'EROFS':
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

/**
 * 境界の外から来た `baseRevision` を、比較してよい形へ落とす。
 *
 * 形が合わないものは「渡されなかった」と同じ扱いにはせず null（＝確かめない）にする。
 * ここで拒否しても利用者にできることが無く、拒否と上書きのどちらも安全側とは言えないため、
 * 判断は「確かめられるものは確かめる」に寄せる。
 */
function toFileRevision(raw: unknown): FileRevision | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  const { mtimeMs, size } = raw as { mtimeMs: unknown; size: unknown }

  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) {
    return null
  }

  if (typeof size !== 'number' || !Number.isFinite(size)) {
    return null
  }

  return { mtimeMs, size }
}

function isSameRevision(a: FileRevision, b: FileRevision): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size
}

/**
 * 境界の外から来た `encoding` を、書いてよい形へ落とす。
 *
 * 知らない値は既定（BOM 無しの UTF-8）にする。拒否にしないのは、
 * 利用者にできることが無いうえ、**保存できないことの方が害が大きい**ため。
 */
function toFileEncoding(raw: unknown): FileEncoding {
  return isFileEncoding(raw) ? raw : 'utf8'
}

export async function writeWorkspaceFile(
  rootPath: string,
  rawRelativePath: unknown,
  rawContent: unknown,
  rawBaseRevision: unknown,
  rawEncoding: unknown
): Promise<WriteWorkspaceFileOutcome> {
  // 1. 中身を先に確かめる。ディスクを触る前に落とせるものはここで落とす。
  if (typeof rawContent !== 'string') {
    return { status: 'invalid-content' }
  }

  const encoding = toFileEncoding(rawEncoding)
  const bytes = encodeFileContent(rawContent, encoding)

  /*
    読み込みの上限（FILES_FILE_MAX_BYTES）と同じ値で頭打ちにする。
    開けたファイルより大きく育つことはあるが、上限が無いと
    「Renderer から届いた文字列をそのままディスクへ流す」経路になる。

    数えるのは**実際に書くバイト列**。文字列の長さで数えると、
    BOM のぶんだけ上限を超えて書けてしまう。
  */
  if (bytes.byteLength > FILES_FILE_MAX_BYTES) {
    return { status: 'invalid-content' }
  }

  // 2. 相対位置を文字列として検証する（`..`・絶対パス・NUL など）。
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  if (relativePath === null) {
    return { status: 'invalid-path' }
  }

  // root（空文字）はファイルではない。
  if (splitRelativePath(relativePath) === null) {
    return { status: 'not-a-file' }
  }

  // 3. root と組んだ結果が Workspace の中に収まるか（文字列としての判断）。
  const absolutePath = resolveWorkspacePath(rootPath, relativePath)

  if (absolutePath === null) {
    return { status: 'outside-workspace' }
  }

  // 4. 実体を見て、もう一度 Workspace の中か確かめる（symlink / ジャンクション）。
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

  // 5. 今ディスクにあるものを見る（種別と、外で書き換えられていないか）。
  let currentRevision: FileRevision

  try {
    const stats = await stat(realPath)

    if (stats.isDirectory()) {
      return { status: 'not-a-file' }
    }

    currentRevision = { mtimeMs: stats.mtimeMs, size: stats.size }
  } catch (cause) {
    return toFailureOutcome(cause)
  }

  const baseRevision = toFileRevision(rawBaseRevision)

  if (baseRevision !== null && !isSameRevision(baseRevision, currentRevision)) {
    // 書かずに戻す。上書きするかどうかを決めるのはこの層ではない。
    return { status: 'stale', relativePath, revision: currentRevision }
  }

  /*
    6. 書く。

    一時ファイルへ書いてから rename する形（store/jsonStore.ts の作法）は採らない。
    あちらはアプリが持つ設定ファイルだが、こちらは利用者のプロジェクトの中身で、
    差し替えると元のファイルの属性（ACL・ハードリンク・監視ハンドル）を失う。
    「書き込み中に落ちても壊れない」より「そのファイルであり続ける」を採る。

    渡すのは realpath 側。検証したのはこちらであり、絶対パスの方を渡すと
    「確かめた対象」と「書く対象」が別物になる（readWorkspaceFile.ts と同じ）。
  */
  try {
    await writeFile(realPath, bytes)
  } catch (cause) {
    return toFailureOutcome(cause)
  }

  // 7. 書いた結果の版を返す。Renderer はこれを次の baseRevision にする。
  try {
    const stats = await stat(realPath)

    return {
      status: 'ok',
      relativePath,
      revision: { mtimeMs: stats.mtimeMs, size: stats.size }
    }
  } catch (cause) {
    return toFailureOutcome(cause)
  }
}
