import { realpath, stat, writeFile } from 'fs/promises'
import { basename, relative, resolve, sep } from 'path'
import { FILES_FILE_MAX_BYTES, isFileEncoding, type FileEncoding } from '@shared/files'
import { encodeFileContent } from './fileContent'
import { isInsideWorkspace, normalizeWorkspaceRelativePath } from './workspacePath'

/**
 * 別名で保存（Save As）の、Electron に依存しない側（Session 4-2）。
 *
 * ダイアログを出すのは `ipc/handlers/files.ts`（Electron に触れる唯一の場所）で、
 * ここが持つのは**選ばれた後**の3つだけになる。
 *
 * ```
 * prepareSaveAsBytes     渡された中身を、書けるバイト列にする（書く前に確かめる）
 * writeFileAtPath        選ばれた絶対パスへ書く
 * describeSaveAsLocation 書けた場所が Workspace の中か外かを決める
 * ```
 *
 * 分けてあるのは、`store/windowBounds.ts` と `store/windowState.ts` を分けているのと
 * 同じ理由（docs/DEVELOPMENT.md §3）── ダイアログを混ぜると、判断のある部分が
 * まるごとテストの外へ出る。
 *
 * ---
 *
 * ## 1. なぜ `writeWorkspaceFile.ts` を広げないか
 *
 * あちらが確かめているのは「**その相対位置が指す実体**が Workspace の中にあるか」で、
 * 対象が実在することが前提になっている（`realpath` に失敗した時点で `not-found`）。
 * まさにこの前提のせいで、外から消されたファイルの内容はどこへも書き戻せない
 * ── それが Session 4-2 が閉じようとしている経路そのものになる。
 *
 * そこへ「新しく作ってもよい」「外でもよい」を足すと、**同じ関数が要求の中身によって
 * 別の検証を通る**ことになる。境界の話は「どちらの検証を通ったか」が一目で分かる形に
 * 保ちたいので、別の関数として切ってある。
 *
 * ## 2. 信頼の根拠は「利用者が選んだ」ことに置く
 *
 * この経路だけは Workspace の外へも書ける。その根拠は Renderer が渡した値ではなく、
 * **Main が出したネイティブのダイアログで利用者が選んだ**という事実にある。
 *
 * ```
 * Renderer が渡せるもの   中身 / 文字コード / ダイアログを開く位置の助言（Workspace 相対）
 * Renderer が渡せないもの 保存先そのもの（絶対パスを受け取る引数が無い）
 * ```
 *
 * したがって `writeFileAtPath` の絶対パスは**要求から来ない**。この関数を
 * Renderer から届いた文字列に対して呼ぶ経路を作らないこと ── その1点だけが、
 * ここの安全性を支えている。
 *
 * ## 3. 書く前に確かめ、書いてから場所を決める
 *
 * 中身の検証（文字列か・上限を超えないか）は**ダイアログを出す前**に済ませる。
 * 選ばせてから断ると、利用者は保存先を選ぶ手間を無駄にしたうえで、
 * 何が悪かったのかをダイアログの外で知ることになる。
 *
 * 逆に「Workspace の中か外か」は**書いた後**に決める。選ばれたパスは symlink や
 * ジャンクションを経由しうるので、実体（`realpath`）で比べないと、
 * 中に見えて外にあるもの・外に見えて中にあるものを取り違える。
 *
 * ## 4. 一時ファイル経由にしない
 *
 * `store/jsonStore.ts` は一時ファイル → rename の形を採るが、こちらは採らない。
 * 理由は `writeWorkspaceFile.ts` と同じで、書き換える相手が利用者のファイルだから
 * ── 差し替えると元のファイルの属性（ACL・ハードリンク・監視ハンドル）を失う。
 * 上書きを選んだ場合、書く相手は「今そこにあるそのファイル」であり続ける。
 */

/* -------------------------------------------------------------- 中身 */

export type PrepareSaveAsBytesOutcome =
  | { readonly status: 'ok'; readonly bytes: Buffer; readonly encoding: FileEncoding }
  | { readonly status: 'invalid-content' }

/**
 * 渡された中身を、書けるバイト列にする。
 *
 * 上限は読み込み・上書き保存と同じ `FILES_FILE_MAX_BYTES`。数えるのは
 * **実際に書くバイト列**で、文字列の長さではない（BOM のぶんだけ上限を超えて
 * 書けてしまうため。`writeWorkspaceFile.ts` と同じ判断）。
 *
 * 文字コードが分からなければ `utf8`（BOM 無し）へ倒す。Main が勝手に BOM を
 * 足したり落としたりしないための既定で、上書き保存とまったく同じ扱いになる。
 */
export function prepareSaveAsBytes(
  rawContent: unknown,
  rawEncoding: unknown
): PrepareSaveAsBytesOutcome {
  if (typeof rawContent !== 'string') {
    return { status: 'invalid-content' }
  }

  const encoding: FileEncoding = isFileEncoding(rawEncoding) ? rawEncoding : 'utf8'
  const bytes = encodeFileContent(rawContent, encoding)

  if (bytes.byteLength > FILES_FILE_MAX_BYTES) {
    return { status: 'invalid-content' }
  }

  return { status: 'ok', bytes, encoding }
}

/* ------------------------------------------------ ダイアログを開く位置 */

/**
 * ダイアログの初期表示に使う絶対パス。
 *
 * 受け取るのは Workspace 相対の助言だけで、`normalizeWorkspaceRelativePath` を
 * 通らないもの・root 自身（空文字）は断る。**ここから Workspace の外は指せない。**
 *
 * 断った場合に Workspace root へ落とさずに null を返すのは、
 * 「助言が壊れていた」を黙って別の場所で開く形にしないため（呼び出し側が決める）。
 */
export function resolveSaveAsDialogPath(rootPath: string, rawRelativePath: unknown): string | null {
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  if (relativePath === null || relativePath === '') {
    return null
  }

  const absolutePath = resolve(rootPath, relativePath)

  // 正規化を通っていれば外は指せないが、確かめてから使う（渡す先はダイアログ）。
  return isInsideWorkspace(rootPath, absolutePath) ? absolutePath : null
}

/* -------------------------------------------------------------- 書く */

export type WriteFileAtPathOutcome =
  | {
      readonly status: 'ok'
      /** 書いた相手の実体（symlink を解いた後）。場所の判定はこちらで行う。 */
      readonly realPath: string
      readonly name: string
      readonly byteLength: number
      readonly revision: { readonly mtimeMs: number; readonly size: number }
      /** 書く前にそこへ何も無かったか（変化の伝え方が created / modified で分かれる）。 */
      readonly created: boolean
    }
  | { readonly status: 'not-found' }
  | { readonly status: 'not-a-file' }
  | { readonly status: 'permission-denied' }
  | { readonly status: 'invalid-path' }
  | { readonly status: 'failed'; readonly detail: string }

function errorCodeOf(cause: unknown): string | null {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const { code } = cause as { code: unknown }

    return typeof code === 'string' ? code : null
  }

  return null
}

/**
 * 失敗を分類する。表は `writeWorkspaceFile.ts` と揃えてある
 * ── 同じ書き込みの失敗が、経路によって別の分類で返らないようにするため。
 */
function toFailureOutcome(cause: unknown): WriteFileAtPathOutcome {
  switch (errorCodeOf(cause)) {
    case 'ENOENT':
      // 親フォルダが無い（ダイアログの後に消された等）。
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
 * 選ばれた絶対パスへ書く。
 *
 * **渡してよいのはネイティブの保存ダイアログが返したパスだけ**（冒頭の 2）。
 *
 * 書く前に相手を `stat` するのは2つのため。
 *   - フォルダを選ばれていた場合に、書きに行く前に断る（`writeFile` は
 *     プラットフォームによって別の errno を返す）
 *   - 新しく作ったのか上書きしたのかを、応答に載せる（変化の伝え方が分かれる）
 *
 * 書いた後に `realpath` を取り、その実体で「中か外か」を判定する。
 * 書く前に取らないのは、**まだ存在しないファイル**には実体が無いため。
 */
export async function writeFileAtPath(
  absolutePath: string,
  bytes: Buffer
): Promise<WriteFileAtPathOutcome> {
  let created = true

  try {
    const existing = await stat(absolutePath)

    if (existing.isDirectory()) {
      return { status: 'not-a-file' }
    }

    created = false
  } catch (cause) {
    if (errorCodeOf(cause) !== 'ENOENT') {
      return toFailureOutcome(cause)
    }
  }

  try {
    await writeFile(absolutePath, bytes)
  } catch (cause) {
    return toFailureOutcome(cause)
  }

  try {
    const realPath = await realpath(absolutePath)
    const stats = await stat(realPath)

    return {
      status: 'ok',
      realPath,
      // 利用者が今しがた打った名前。Renderer へ渡すのはここまでで、場所は渡さない。
      name: basename(realPath),
      byteLength: stats.size,
      revision: { mtimeMs: stats.mtimeMs, size: stats.size },
      created
    }
  } catch (cause) {
    return toFailureOutcome(cause)
  }
}

/* ------------------------------------------------------ 中か外かを決める */

export interface SaveAsLocation {
  /**
   * Workspace の中なら相対位置、外なら null。
   *
   * null は「書けなかった」ではなく「**Editor が開ける範囲の外へ書けた**」を表す。
   */
  readonly relativePath: string | null
}

/**
 * 書けた場所が Workspace の中か外かを決める。
 *
 * ## 実体どうしで比べる
 *
 * 両方を `realpath` に通してから比べる。片方だけを解くと、Workspace root 自体が
 * symlink 越しに開かれている場合に、中にあるものを外と判定する。
 *
 * ## 相対位置は「Main が組み立てて、もう一度検証する」
 *
 * 出した相対位置は、この後 Renderer がタブの位置として持ち、次の Ctrl+S で
 * `files:write-file` へ渡ってくる。**そのとき同じ場所へ着かなければ意味が無い**ので、
 * ここでも `normalizeWorkspaceRelativePath` を通し、通らない形（区切りの都合で
 * 表せない位置など）は中と見なさない ── 外として扱えば、タブが移らないだけで
 * 書けた事実は失われない。
 */
export async function describeSaveAsLocation(
  rootPath: string,
  realPath: string
): Promise<SaveAsLocation> {
  let realRootPath: string

  try {
    realRootPath = await realpath(rootPath)
  } catch {
    // Workspace root が読めない（切り替え・削除と前後した）。外として扱う。
    return { relativePath: null }
  }

  if (!isInsideWorkspace(realRootPath, realPath)) {
    return { relativePath: null }
  }

  const raw = relative(realRootPath, realPath)

  if (raw === '') {
    // root 自身。ファイルとしては指せない。
    return { relativePath: null }
  }

  const relativePath = normalizeWorkspaceRelativePath(raw.split(sep).join('/'))

  return { relativePath: relativePath === '' ? null : relativePath }
}
