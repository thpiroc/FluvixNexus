import { readFile, readdir, realpath, stat } from 'fs/promises'
import { join } from 'path'
import {
  FILES_RELATIVE_PATH_MAX_LENGTH,
  FILE_CONTENT_SEARCH_FILE_MAX_BYTES,
  FILE_CONTENT_SEARCH_MAX_FILES,
  FILE_CONTENT_SEARCH_MAX_MATCHES,
  FILE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE,
  FILE_CONTENT_SEARCH_TIME_BUDGET_MS,
  FILE_SEARCH_MAX_DEPTH,
  FILE_SEARCH_MAX_SCANNED_ENTRIES,
  WORKSPACE_ROOT_RELATIVE_PATH,
  joinRelativePath,
  type FileContentMatchFile,
  type FileContentSearchLimit,
  type FileSearchStatus
} from '@shared/files'
import { findContentMatches } from './contentMatches'
import { errnoCodeOf } from './errno'
import { looksBinary, stripBom } from './fileContent'
import { isIgnoredDirectoryName } from './ignoredDirectories'
import type { WorkspaceSearchCancellation } from './searchWorkspaceFiles'
import { normalizeSearchQuery } from './searchQuery'

/**
 * Workspace 全体を**中身**で探す（Session 3-6-5）。
 *
 * 名前の検索（searchWorkspaceFiles.ts）と同じく、Electron にも IPC にも依存せず
 * 結末を値として返す（IPC の失敗分類への翻訳は ipc/handlers/files.ts）。
 * 止めてよいかを訊きに行く先（`cancellation`）も同じもので、
 * **誰が止めたかはこの層も知らない**（workspaceSearchSession.ts）。
 *
 * ## 名前の検索と走査を共有していない理由
 *
 * 潜り方（root だけを realpath で解き、readdir が返した名前を継ぎ足して降りる）は
 * 同じで、除外の規則（ignoredDirectories.ts）・深さと走査数の上限
 * （shared/files/search.ts）も共有している。**値と規則は共有し、ループは分けた**。
 *
 * 分けたのは、2つの走査が「何を集め、何で止まるか」で別物だから。
 *
 *   名前 … フォルダも結果になる / 見つけた件数で止まる / フォルダ単位で並べ替える
 *   中身 … ファイルだけを開く / 読んだファイル数と一致の総数で止まる / 読めないものはとばす
 *
 * 共通の走査へ寄せると、「何を結果にするか」「いつ止まるか」「どう並べるか」を
 * 呼び出し側から差し込む形になり、**ループの外に散った条件を読んで初めて
 * 挙動が分かる**状態になる。今のところ利いている共有（除外・深さ・走査数・
 * 検索語の規則）はすべて**値と純粋な関数**として共有できており、
 * そちらの方が食い違いを防ぐという目的に対して素直に効く。
 *
 * ## リンクは辿らないし、読まない
 *
 * 名前の検索はリンクを**1件として結果に出す**（そこに在るものだから）。
 * 全文検索は逆で、**リンクは中身を読まない。** 読めば指し先が Workspace の外に
 * ある実体の中身が preview に載り、Renderer へ渡ってしまう ──
 * readWorkspaceFile.ts が「読むときは対象そのものの realpath を見る」と決めている
 * のと同じ線で、こちらは**そもそも読まない**方に倒す
 * （リンクの中へ潜らないのは名前の検索と同じ）。
 *
 * ## 読まないもの
 *
 * | 対象                       | 理由                                                     |
 * | -------------------------- | -------------------------------------------------------- |
 * | `.git` / `node_modules`    | 監視・名前の検索と同じ除外（ignoredDirectories.ts）      |
 * | symlink / ジャンクション   | 外の実体の中身を持ち込まない（上記）                     |
 * | 大きすぎるファイル         | Editor で開ける上限と同じ（shared/files/contentSearch.ts）|
 * | バイナリ                   | 判定は Editor と同じ（fileContent.ts の looksBinary）    |
 *
 * どれも失敗として返さず、黙ってとばす。**探せなかったものを1件ずつ数えて
 * 見せる意味が無い**（利用者が知りたいのは見つかったものと、
 * 全部を見たかどうかだけ）。
 *
 * ## 上限
 *
 * 6つある。深さ・走査数は名前の検索と共有し、残りは全文検索のもの
 * （shared/files/contentSearch.ts）。
 *
 *   ファイル数 FILE_CONTENT_SEARCH_MAX_FILES              … 開いて読んだ数
 *   一致の総数 FILE_CONTENT_SEARCH_MAX_MATCHES            … 返す一致の数
 *   1件あたり  FILE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE   … 1ファイルから取る数
 *   時間       FILE_CONTENT_SEARCH_TIME_BUDGET_MS         … 遅いディスクでも終わらせる
 *   深さ       FILE_SEARCH_MAX_DEPTH                      … それより下へは潜らない
 *   走査数     FILE_SEARCH_MAX_SCANNED_ENTRIES            … 名前を見たエントリの総数
 */

/** 上限の差し替え（テスト用。既定は shared/files/ の値）。 */
export interface WorkspaceContentSearchOptions {
  readonly maxFiles?: number
  readonly maxMatches?: number
  readonly maxMatchesPerFile?: number
  readonly maxFileBytes?: number
  readonly maxDepth?: number
  readonly maxScannedEntries?: number
  readonly timeBudgetMs?: number
  readonly cancellation?: WorkspaceSearchCancellation
  /** 時間の見方（テストで固定するために差し替えられる）。 */
  readonly now?: () => number
}

export type SearchWorkspaceFileContentsOutcome =
  | {
      readonly status: 'ok'
      /** 最後まで見たか、取り消されたか（shared/files/search.ts）。 */
      readonly completion: FileSearchStatus
      /** 見つかったもの（ファイル単位）。走査した順＝浅い場所が先。 */
      readonly files: readonly FileContentMatchFile[]
      /** 一致の総数。 */
      readonly matchCount: number
      /** 実際に中身を読んだファイル数。 */
      readonly searchedFileCount: number
      /** 名前を見たエントリ数（読まずにとばしたものを含む）。 */
      readonly scannedCount: number
      readonly truncated: boolean
      readonly limit: FileContentSearchLimit | null
    }
  /** 検索語として扱えない（空・桁違いに長い・改行を含む・文字列でない）。 */
  | { readonly status: 'invalid-query' }
  | { readonly status: 'not-found' }
  | { readonly status: 'permission-denied' }
  | { readonly status: 'failed'; readonly detail: string }

/** これから潜るフォルダ。 */
interface PendingDirectory {
  /** フォルダ名（潜る順を名前順に揃えるために持つ。root は空文字）。 */
  readonly name: string
  readonly relativePath: string
  /** realpath から組み立てた絶対パス（Renderer へは出さない）。 */
  readonly absolutePath: string
  readonly depth: number
}

/** これから中身を読むファイル。 */
interface PendingFile {
  readonly name: string
  readonly relativePath: string
  readonly absolutePath: string
}

/**
 * 全文検索として使える検索語か。
 *
 * 共通の規則（searchQuery.ts）に**改行を含まないこと**を足している。
 * 照合は1行ずつ行う（contentMatches.ts）ため、改行をまたぐ語はどの行とも
 * 一致しない ── 受け付けて常に0件を返すより、「その語では検索できません」と
 * 答える方が、探し方が悪いのか無いのかが利用者に伝わる。
 */
function normalizeContentQuery(raw: unknown): string | null {
  const query = normalizeSearchQuery(raw)

  if (query === null || query.includes('\n') || query.includes('\r')) {
    return null
  }

  return query
}

/** root を開けなかった理由を、この層の結末へ翻訳する。 */
function toRootFailureOutcome(cause: unknown): SearchWorkspaceFileContentsOutcome {
  switch (errnoCodeOf(cause)) {
    case 'ENOENT':
    case 'ENOTDIR':
      return { status: 'not-found' }

    case 'EACCES':
    case 'EPERM':
      return { status: 'permission-denied' }

    default:
      return { status: 'failed', detail: String(cause) }
  }
}

/** 名前順（同じフォルダの中で、読みに行く順を決める）。 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function byName(a: { readonly name: string }, b: { readonly name: string }): number {
  const compared = collator.compare(a.name, b.name)

  if (compared !== 0) {
    return compared
  }

  // 大文字小文字だけが違う組でも並びが揺れないようにする（entrySort.ts と同じ理由）。
  return a.name === b.name ? 0 : a.name < b.name ? -1 : 1
}

export async function searchWorkspaceFileContents(
  rootPath: string,
  rawQuery: unknown,
  options: WorkspaceContentSearchOptions = {}
): Promise<SearchWorkspaceFileContentsOutcome> {
  const query = normalizeContentQuery(rawQuery)

  if (query === null) {
    return { status: 'invalid-query' }
  }

  const maxFiles = options.maxFiles ?? FILE_CONTENT_SEARCH_MAX_FILES
  const maxMatches = options.maxMatches ?? FILE_CONTENT_SEARCH_MAX_MATCHES
  const maxMatchesPerFile = options.maxMatchesPerFile ?? FILE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE
  const maxFileBytes = options.maxFileBytes ?? FILE_CONTENT_SEARCH_FILE_MAX_BYTES
  const maxDepth = options.maxDepth ?? FILE_SEARCH_MAX_DEPTH
  const maxScannedEntries = options.maxScannedEntries ?? FILE_SEARCH_MAX_SCANNED_ENTRIES
  const timeBudgetMs = options.timeBudgetMs ?? FILE_CONTENT_SEARCH_TIME_BUDGET_MS
  const cancellation = options.cancellation ?? { cancelled: false }
  const now = options.now ?? Date.now
  const startedAt = now()

  /*
    起点は実体まで解決した root。ここだけが「外から与えられた場所」で、
    以降の位置はすべて readdir が返した名前から組み上がる
    （searchWorkspaceFiles.ts と同じ ── 境界は潜り方で守る）。
  */
  let realRootPath: string

  try {
    realRootPath = await realpath(rootPath)
  } catch (cause) {
    return toRootFailureOutcome(cause)
  }

  const files: FileContentMatchFile[] = []
  let matchCount = 0
  let searchedFileCount = 0
  let scannedCount = 0
  /** 走査そのものを止めた理由。 */
  let stopReason: FileContentSearchLimit | null = null
  /** 深さの上限で潜らなかった場所があるか。走査は続くため、理由としては弱い。 */
  let depthSkipped = false
  /** どこかのファイルで、そのファイル内の上限に当たったか（同じく弱い理由）。 */
  let fileMatchesTruncated = false
  let completion: FileSearchStatus = 'completed'

  const queue: PendingDirectory[] = [
    {
      name: '',
      relativePath: WORKSPACE_ROOT_RELATIVE_PATH,
      absolutePath: realRootPath,
      depth: 0
    }
  ]

  /** 時間の上限に達したか（読み込みの前後で見る）。 */
  const outOfTime = (): boolean => now() - startedAt >= timeBudgetMs

  while (queue.length > 0 && stopReason === null) {
    if (cancellation.cancelled) {
      completion = 'cancelled'
      break
    }

    if (outOfTime()) {
      stopReason = 'time'
      break
    }

    // 幅優先。浅い場所ほど先に読むため、打ち切っても身近な場所から結果が出る。
    const directory = queue.shift() as PendingDirectory

    let dirents
    try {
      dirents = await readdir(directory.absolutePath, { withFileTypes: true })
    } catch {
      // 1つのフォルダが読めないこと（消えた・権限が無い）で検索全体を止めない。
      continue
    }

    // await から戻った直後。取り消しが届いているならここで気づく。
    if (cancellation.cancelled) {
      completion = 'cancelled'
      break
    }

    /** このフォルダの中で読むファイル（並べ替えてから順に読む）。 */
    const pendingFiles: PendingFile[] = []
    /** このフォルダの中で、さらに潜る先。 */
    const children: PendingDirectory[] = []

    for (const dirent of dirents) {
      if (scannedCount >= maxScannedEntries) {
        stopReason = 'scanned'
        break
      }

      scannedCount += 1

      const isDirectory = dirent.isDirectory()

      // 除外するフォルダは中も見ない（監視・名前の検索と同じ規則）。
      if (isDirectory && isIgnoredDirectoryName(dirent.name)) {
        continue
      }

      /*
        リンクは潜りもしないし読みもしない（このファイルの冒頭）。
        `isDirectory()` は指し先の種別を見ないため、ここで先に落としておく。
      */
      if (dirent.isSymbolicLink()) {
        continue
      }

      const relativePath = joinRelativePath(directory.relativePath, dirent.name)

      // 契約上の上限（shared/files/entry.ts）を超える位置は返さない。
      if (relativePath.length > FILES_RELATIVE_PATH_MAX_LENGTH) {
        continue
      }

      if (isDirectory) {
        if (directory.depth + 1 > maxDepth) {
          depthSkipped = true
          continue
        }

        children.push({
          name: dirent.name,
          relativePath,
          absolutePath: join(directory.absolutePath, dirent.name),
          depth: directory.depth + 1
        })

        continue
      }

      // 普通のファイルだけを読む（デバイス・FIFO などは対象にしない）。
      if (!dirent.isFile()) {
        continue
      }

      pendingFiles.push({
        name: dirent.name,
        relativePath,
        absolutePath: join(directory.absolutePath, dirent.name)
      })
    }

    if (stopReason !== null) {
      break
    }

    // 読む順は名前順。readdir の順序はディスク側の都合で決まるため、
    // そのままだと同じ検索でも結果の並びが変わる。
    for (const file of [...pendingFiles].sort(byName)) {
      if (cancellation.cancelled) {
        completion = 'cancelled'
        break
      }

      if (searchedFileCount >= maxFiles) {
        stopReason = 'files'
        break
      }

      if (outOfTime()) {
        stopReason = 'time'
        break
      }

      /*
        大きさを先に見る。読んでから捨てるのでは、読む時点で費用が発生する
        （readWorkspaceFile.ts と同じ順序）。
      */
      let byteLength: number

      try {
        const stats = await stat(file.absolutePath)

        if (!stats.isFile()) {
          continue
        }

        byteLength = stats.size
      } catch {
        // 見ている間に消えた・権限が無い。1件のために検索を止めない。
        continue
      }

      if (byteLength > maxFileBytes) {
        continue
      }

      let bytes: Buffer

      try {
        bytes = await readFile(file.absolutePath)
      } catch {
        continue
      }

      // 読み込みの前後は await の隙間。取り消しはここでも見る。
      if (cancellation.cancelled) {
        completion = 'cancelled'
        break
      }

      // 判定は Editor で開くときと同じ（fileContent.ts）。
      if (looksBinary(bytes)) {
        continue
      }

      searchedFileCount += 1

      /*
        BOM は落としてから照合する。落とさないと、1行目の先頭で探した語が
        見えない1文字ぶんずれる（桁の数え方が Editor と食い違う）。
      */
      const text = stripBom(bytes.toString('utf8'))

      const outcome = findContentMatches(
        text,
        query,
        // 総数の残りとファイル単位の上限、厳しい方で切る。
        Math.min(maxMatchesPerFile, maxMatches - matchCount)
      )

      if (outcome.truncated) {
        fileMatchesTruncated = true
      }

      if (outcome.matches.length === 0) {
        continue
      }

      files.push({
        relativePath: file.relativePath,
        name: file.name,
        matches: outcome.matches,
        truncated: outcome.truncated
      })

      matchCount += outcome.matches.length

      if (matchCount >= maxMatches) {
        stopReason = 'matches'
        break
      }
    }

    if (completion === 'cancelled' || stopReason !== null) {
      break
    }

    // 潜る順も名前順に揃える（同じ深さでは名前順に見に行く）。
    queue.push(...[...children].sort(byName))
  }

  /*
    弱い理由は、走査を止めた理由が無いときだけ表に出す。
    深さを先に見るのは、**そこに在るのに探していない**という取りこぼしの方が、
    「見つけたものの一部を出していない」より次の一手に効くため。
  */
  const limit =
    stopReason ?? (depthSkipped ? 'depth' : fileMatchesTruncated ? 'file-matches' : null)

  return {
    status: 'ok',
    completion,
    files,
    matchCount,
    searchedFileCount,
    scannedCount,
    truncated: limit !== null,
    limit
  }
}
