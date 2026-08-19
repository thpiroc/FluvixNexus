import { readdir, realpath } from 'fs/promises'
import { join } from 'path'
import {
  FILES_RELATIVE_PATH_MAX_LENGTH,
  FILE_SEARCH_MAX_DEPTH,
  FILE_SEARCH_MAX_RESULTS,
  FILE_SEARCH_MAX_SCANNED_ENTRIES,
  FILE_SEARCH_TIME_BUDGET_MS,
  WORKSPACE_ROOT_RELATIVE_PATH,
  joinRelativePath,
  matchesFileNameQuery,
  type FileEntry,
  type FileSearchLimit,
  type FileSearchStatus
} from '@shared/files'
import { compareFileEntries, sortFileEntries } from './entrySort'
import { errnoCodeOf } from './errno'
import { toFileEntry } from './fileEntry'
import { isIgnoredDirectoryName } from './ignoredDirectories'
import { resolveLinkEntryType } from './linkEntryType'
import { normalizeSearchQuery } from './searchQuery'

/**
 * Workspace 全体を名前で探す（Session 3-6-4）。
 *
 * 列挙（readWorkspaceDirectory.ts）が1フォルダ1階層を読むのに対し、こちらは
 * **root から再帰的に潜る**唯一の経路。Electron にも IPC にも依存せず、
 * 結末を値として返す（IPC の失敗分類への翻訳は ipc/handlers/files.ts）。
 *
 * ## 境界は「潜り方」で守る
 *
 * 起点は realpath まで解決した root ひとつだけで、そこから先は
 * **readdir が返した名前を継ぎ足して降りるだけ**にしてある。名前に区切り文字も
 * `..` も混ざらない以上、組み上がる位置は必ず root の下に収まる。
 * 相対位置を外から受け取らないため、workspacePath.ts の検証を通す相手も無い
 * （検証すべき入力そのものが無い、という形にしてある）。
 *
 * **リンク（symlink / ジャンクション）の中へは潜らない。** 潜れば指し先が
 * Workspace の外にある実体を舐めることになり、結果に「中にあるはずのない位置」が
 * 混ざる。コピー（copyTree.ts）が辿らないのと同じ線で、
 * リンクそのものは**1件として結果に出す**（そこに在るものだから）。
 * 併せて、リンクのループで無限に潜る経路もこの時点で消える。
 *
 * ## 無制限に列挙しない
 *
 * 上限は4つ（shared/files/search.ts）。どれも失敗ではなく
 * 「ここまでしか見ていない」という事実として返す。
 *
 *   件数   FILE_SEARCH_MAX_RESULTS          … 見つけた数で打ち切る
 *   深さ   FILE_SEARCH_MAX_DEPTH            … それより下へは潜らない
 *   走査数 FILE_SEARCH_MAX_SCANNED_ENTRIES  … 見たエントリの総数で打ち切る
 *   時間   FILE_SEARCH_TIME_BUDGET_MS       … 遅いディスクでも終わらせる
 *
 * 件数だけでは足りない ── 一致が0件でも数十万件を舐めることはあり、
 * その間ずっと Main が塞がる。走査数と時間は**見つからないときのため**の上限になる。
 *
 * ## 取り消せること
 *
 * 走査の途中で `cancellation.cancelled` を見る。判断そのものは持たず、
 * **誰が取り消したか（新しい検索・利用者・Workspace の切り替え）を知らない**
 * ── それを決めるのは workspaceSearchSession.ts。
 * ここは「止めてよいか」を訊きに行くだけにしてある。
 *
 * 見るのは readdir の直後（＝ await から戻った直後）。JavaScript は途中で
 * 割り込まれないため、取り消しの要求が届くのも await の隙間しかない。
 */

/** 走査を止めてよいかの問い合わせ先。 */
export interface WorkspaceSearchCancellation {
  readonly cancelled: boolean
}

/** 上限の差し替え（テスト用。既定は shared/files/search.ts の値）。 */
export interface WorkspaceSearchOptions {
  readonly maxResults?: number
  readonly maxDepth?: number
  readonly maxScannedEntries?: number
  readonly timeBudgetMs?: number
  readonly cancellation?: WorkspaceSearchCancellation
  /** 時間の見方（テストで固定するために差し替えられる）。 */
  readonly now?: () => number
}

export type SearchWorkspaceFilesOutcome =
  | {
      readonly status: 'ok'
      /** 最後まで見たか、取り消されたか（shared/files/search.ts）。 */
      readonly completion: FileSearchStatus
      /** 見つかったもの。フォルダが先・名前順を、フォルダ単位で保った並び。 */
      readonly matches: readonly FileEntry[]
      /** 上限に当たって全部は見ていないか。 */
      readonly truncated: boolean
      /** 打ち切った理由（truncated が false なら null）。 */
      readonly limit: FileSearchLimit | null
      /** 実際に見たエントリ数。 */
      readonly scannedCount: number
    }
  /** 検索語として扱えない（空・桁違いに長い・文字列でない）。 */
  | { readonly status: 'invalid-query' }
  /** Workspace root が無くなっている。 */
  | { readonly status: 'not-found' }
  /** Workspace root が読めない。 */
  | { readonly status: 'permission-denied' }
  /** それ以外（I/O エラーなど）。 */
  | { readonly status: 'failed'; readonly detail: string }

/** これから潜るフォルダ。 */
interface PendingDirectory {
  /** Workspace root からの相対位置（root は空文字）。 */
  readonly relativePath: string
  /** realpath から組み立てた絶対パス（Renderer へは出さない）。 */
  readonly absolutePath: string
  /** root を 0 とした深さ。 */
  readonly depth: number
}

/** root を開けなかった理由を、この層の結末へ翻訳する。 */
function toRootFailureOutcome(cause: unknown): SearchWorkspaceFilesOutcome {
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

export async function searchWorkspaceFiles(
  rootPath: string,
  rawQuery: unknown,
  options: WorkspaceSearchOptions = {}
): Promise<SearchWorkspaceFilesOutcome> {
  // 検索語として使えるかの規則は全文検索と共有している（searchQuery.ts）。
  const query = normalizeSearchQuery(rawQuery)

  if (query === null) {
    return { status: 'invalid-query' }
  }

  const maxResults = options.maxResults ?? FILE_SEARCH_MAX_RESULTS
  const maxDepth = options.maxDepth ?? FILE_SEARCH_MAX_DEPTH
  const maxScannedEntries = options.maxScannedEntries ?? FILE_SEARCH_MAX_SCANNED_ENTRIES
  const timeBudgetMs = options.timeBudgetMs ?? FILE_SEARCH_TIME_BUDGET_MS
  const cancellation = options.cancellation ?? { cancelled: false }
  const now = options.now ?? Date.now
  const startedAt = now()

  /*
    起点は実体まで解決した root。ここだけが「外から与えられた場所」で、
    以降の位置はすべて readdir が返した名前から組み上がる。
    root 自体が symlink の下にある場合も、解決してから降りることで
    途中の比較がずれない（readWorkspaceDirectory.ts と同じ理由）。
  */
  let realRootPath: string

  try {
    realRootPath = await realpath(rootPath)
  } catch (cause) {
    return toRootFailureOutcome(cause)
  }

  const matches: FileEntry[] = []
  let scannedCount = 0
  /** 走査そのものを止めた理由（件数 / 走査数 / 時間）。 */
  let stopReason: FileSearchLimit | null = null
  /** 深さの上限で潜らなかった場所があるか。走査は続くため、理由としては弱い。 */
  let depthSkipped = false
  let completion: FileSearchStatus = 'completed'

  const queue: PendingDirectory[] = [
    {
      relativePath: WORKSPACE_ROOT_RELATIVE_PATH,
      absolutePath: realRootPath,
      depth: 0
    }
  ]

  while (queue.length > 0) {
    if (cancellation.cancelled) {
      completion = 'cancelled'
      break
    }

    if (now() - startedAt >= timeBudgetMs) {
      stopReason = 'time'
      break
    }

    // 幅優先。浅い場所ほど先に出るため、件数で打ち切っても
    // 「近くにあるはずのものが出てこない」になりにくい。
    const directory = queue.shift() as PendingDirectory

    let dirents
    try {
      dirents = await readdir(directory.absolutePath, { withFileTypes: true })
    } catch {
      /*
        1つのフォルダが読めないこと（消えた・権限が無い）で検索全体を止めない。
        探し物が別の場所にあれば見つかる方が、断られるより役に立つ
        （root が読めない場合だけは上で結末として返している）。
      */
      continue
    }

    // await から戻った直後。取り消しが届いているならここで気づく。
    if (cancellation.cancelled) {
      completion = 'cancelled'
      break
    }

    /** このフォルダで見つかったもの（並べ替えてからまとめて積む）。 */
    const found: FileEntry[] = []
    /** このフォルダの中で、さらに潜る先（並べ替えるために entry を添える）。 */
    const children: { readonly entry: FileEntry; readonly next: PendingDirectory }[] = []

    for (const dirent of dirents) {
      if (scannedCount >= maxScannedEntries) {
        stopReason = 'scanned'
        break
      }

      scannedCount += 1

      const isDirectory = dirent.isDirectory()

      /*
        除外するフォルダ（`.git` / node_modules）は中も名前も対象にしない。
        監視と同じ規則を共有している（ignoredDirectories.ts）。
        同じ名前の**ファイル**は普通に扱う ── 除外したいのは
        「中に数万件を抱えるフォルダ」であって、名前そのものではない。
      */
      if (isDirectory && isIgnoredDirectoryName(dirent.name)) {
        continue
      }

      const relativePath = joinRelativePath(directory.relativePath, dirent.name)

      /*
        契約上の上限（shared/files/entry.ts）を超える位置は返さない。
        Renderer が扱えないうえ、そこから開こうとしても Main 側の検証で断られる。
      */
      if (relativePath.length > FILES_RELATIVE_PATH_MAX_LENGTH) {
        continue
      }

      if (matchesFileNameQuery(dirent.name, query)) {
        if (matches.length + found.length >= maxResults) {
          stopReason = 'results'
          break
        }

        /*
          リンクの種別だけは指し先を見ないと決まらない（列挙と同じ判断を
          linkEntryType.ts で共有している）。**辿るのはここだけ**で、
          中へ潜る判断には使わない。
        */
        const type = isDirectory
          ? 'directory'
          : dirent.isSymbolicLink()
            ? await resolveLinkEntryType(join(directory.absolutePath, dirent.name))
            : 'file'

        found.push(toFileEntry(dirent.name, directory.relativePath, type))
      }

      /*
        潜るのは**素のフォルダだけ。** リンクは種別がフォルダに見えても辿らない
        （このファイルの冒頭）。深すぎる場所は潜らずに印だけ残す。
      */
      if (!isDirectory) {
        continue
      }

      if (directory.depth + 1 > maxDepth) {
        depthSkipped = true
        continue
      }

      children.push({
        entry: toFileEntry(dirent.name, directory.relativePath, 'directory'),
        next: {
          relativePath,
          absolutePath: join(directory.absolutePath, dirent.name),
          depth: directory.depth + 1
        }
      })
    }

    // 並びはツリーと同じ規則（フォルダが先・名前順）。readdir の順序は
    // ディスク側の都合で決まるため、そのまま出すと同じ検索でも並びが変わる。
    matches.push(...sortFileEntries(found))

    if (stopReason !== null) {
      break
    }

    // 潜る順もツリーと同じ規則に揃える（同じ深さでは名前順に見に行く）。
    queue.push(
      ...[...children]
        .sort((a, b) => compareFileEntries(a.entry, b.entry))
        .map((child) => child.next)
    )
  }

  const limit = stopReason ?? (depthSkipped ? 'depth' : null)

  return {
    status: 'ok',
    completion,
    matches,
    truncated: limit !== null,
    limit,
    scannedCount
  }
}
