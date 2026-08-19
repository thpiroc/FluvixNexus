import { open, lstat, readdir } from 'fs/promises'
import { join } from 'path'
import { errnoCodeOf } from './errno'

/**
 * ごみ箱へ送れなかったとき、**何が邪魔をしているのか**をファイルシステムに訊き直す。
 *
 * ## なぜ訊き直すのか ── `shell.trashItem` は理由を持って帰ってこない
 *
 * `shell.trashItem` が投げるのは `message` と `stack` しか持たない素の Error で、
 * `code` も `errno` も付かない。残る手掛かりは message の文字列だけだが、
 * これが**分類には使えない**。この環境（Electron 43.3.0 / Windows 11）で
 * 実際に観測した対応は次のとおり。
 *
 * ```
 * "Failed to parse path"              対象が無い
 *                                     名前の末尾が空白 / ドット
 *                                     区切りが `/` のパス
 *                                     拡張表記（`\\?\`）のパス
 * "Operation was aborted"             対象のファイルが他プロセスに排他で開かれている
 *                                     フォルダの中に開かれているファイルがある
 * "Failed to perform delete operation" 権限が無く、シェルの昇格ダイアログを利用者が閉じた
 * ```
 *
 * **1つの文言が無関係な原因を束ね、1つの原因が複数の文言に散る。** 文字列を見て
 * 分類すると、Electron の版が変われば静かに壊れるうえ、今この瞬間ですら当たらない。
 * そこで message は診断用の detail に残すだけにして、**分類は errno を返す fs API に
 * 訊いて行う**（`EBUSY` / `EACCES` / `EPERM` / `ENOENT` は OS ではなく libuv が
 * 決めるため、判定が OS ごとに割れない）。
 *
 * ## 訊くのは「失敗した後」だけ
 *
 * 事前に調べて弾く形にはしない。**読み取り専用属性のファイルは
 * `open(path, 'r+')` が `EPERM` で失敗するが、ごみ箱へは問題なく入る**
 * （この環境で確認済み）。事前検査にすると、今まで消せていたものを消せなくする。
 *
 * 逆に、失敗した後であれば同じ `EPERM` を「権限が無い」と読んでよい。
 * 既に削除は失敗しており、そこで最も確からしい説明を選ぶ場面だからである。
 *
 * ## フォルダは中を見る
 *
 * フォルダの削除を止めるのは、たいていフォルダ自身ではなく**中の1ファイル**
 * （ビルド生成物の dll、開いたままのログなど）。フォルダを開けるかだけを見ても
 * 「その他の失敗」にしかならないので、中を歩いて最初の妨げを探す。
 *
 * 歩く量には上限を置く（{@link MAX_PROBED_ENTRIES} / {@link MAX_PROBE_DEPTH}）。
 * これは失敗した後にしか通らない経路だが、`node_modules` のようなフォルダで
 * 何万件も開き直すことに意味は無い。見つからなければ 'unknown' を返す
 * ── 分からないことを分かった風に言わない。
 *
 * ## リンクは開かない・辿らない
 *
 * symlink / ジャンクションを `open` すると**指し先**を触ることになり、
 * ジャンクション1つで Workspace の外を歩き回れてしまう。
 * mutateWorkspaceEntry.ts が「消すのはリンクそのもの」を貫いているのと同じ理由で、
 * ここでもリンクは種別を見るだけで素通りする。
 */

/* ------------------------------------------------------------------ 結末 */

/** 削除を妨げているものの種類。 */
export type DeleteObstacleKind =
  /** 対象が既に無い（削除と行き違った）。 */
  | 'not-found'
  /** 対象、またはその中のものが他のプロセスに使われている。 */
  | 'busy'
  /** 対象、またはその中のものに手を出す権限が無い。 */
  | 'permission-denied'
  /** 調べた範囲では理由が分からなかった。 */
  | 'unknown'

export interface DeleteObstacle {
  readonly kind: DeleteObstacleKind
  /**
   * 妨げが見つかった位置（**削除しようとしたものから見た相対**。対象自身なら空文字）。
   *
   * 診断のために持つ。絶対パスにしないのは、この値が detail として
   * Renderer 側まで流れるため ── 原因の位置は伝えたいが、
   * Workspace の外側の情報を混ぜる必要は無い。
   */
  readonly at: string | null
}

/* -------------------------------------------------- ファイルシステムの窓口 */

export type ProbeEntryType = 'file' | 'directory' | 'link'

export interface ProbeChild {
  readonly name: string
  readonly type: ProbeEntryType
}

/**
 * 調べるために使う操作。
 *
 * 差し替えられる形にしてあるのは、`EBUSY`（排他で開かれている）のような状態が
 * **テストから作れない**ため。Node には他プロセスの排他ロックを作る手段が無く、
 * 実物のディスクを相手にしても再現できない。判断そのものはここで検証し、
 * 実物とのつながりは mutateWorkspaceEntry.test.ts が受け持つ。
 */
export interface DeleteProbe {
  /** その位置に今あるものの種別。リンクは辿らない。無ければ errno 付きで投げる。 */
  readonly statLink: (path: string) => Promise<ProbeEntryType>
  /** フォルダの直下1階層。 */
  readonly listChildren: (path: string) => Promise<readonly ProbeChild[]>
  /** 書き込みのために開いて、すぐ閉じる。開けなければ errno 付きで投げる。 */
  readonly openForWrite: (path: string) => Promise<void>
}

/** 一度の調査で見るものの上限。 */
export const MAX_PROBED_ENTRIES = 256
/** 対象からどこまで潜るか。 */
export const MAX_PROBE_DEPTH = 8

/* ------------------------------------------------------- errno の読み替え */

/**
 * errno を妨げの種類へ。判断できないものは null（'unknown' とは区別する）。
 *
 * `EPERM` と `EACCES` を同じ扱いにしているのは、Windows の `ERROR_ACCESS_DENIED` が
 * 呼び出しによってどちらにも化けるため。利用者から見た結論は同じ（権限が無い）。
 */
function obstacleOfErrno(code: string | null): DeleteObstacleKind | null {
  switch (code) {
    case 'ENOENT':
      return 'not-found'

    // EBUSY: 排他で開かれている / 使用中。ETXTBSY: 実行中のバイナリ（POSIX）。
    case 'EBUSY':
    case 'ETXTBSY':
      return 'busy'

    case 'EACCES':
    case 'EPERM':
      return 'permission-denied'

    default:
      return null
  }
}

/* -------------------------------------------------------------- 調べる */

interface PendingNode {
  readonly path: string
  /** 対象から見た相対位置（対象自身は空文字）。 */
  readonly at: string
  readonly type: ProbeEntryType
  readonly depth: number
}

/**
 * ごみ箱へ送れなかった対象を調べ、最も確からしい理由を返す。
 *
 * ## 'busy' を 'permission-denied' より優先する
 *
 * 途中で権限の問題を見つけても、すぐには返さず**上限まで探し続けて `EBUSY` を探す。**
 * 読み取り専用属性のファイルは（消せるにもかかわらず）`EPERM` を返すため、
 * 先に見つかった `EPERM` を答えにすると、本当の原因である「使用中」を
 * 読み取り専用のファイル1つで覆い隠してしまう。
 *
 * 利用者にとっても、「閉じれば消せる」と「この場所では消せない」では
 * 次の一手がまるで違う。当てにいく順番は、当たったときに効く方から。
 */
export async function probeDeleteObstacle(
  absolutePath: string,
  probe: DeleteProbe = nodeDeleteProbe
): Promise<DeleteObstacle> {
  let rootType: ProbeEntryType

  try {
    rootType = await probe.statLink(absolutePath)
  } catch (cause) {
    // 対象そのものを見られない。ここで分かるのは主に「もう無い」。
    return { kind: obstacleOfErrno(errnoCodeOf(cause)) ?? 'unknown', at: '' }
  }

  const queue: PendingNode[] = [{ path: absolutePath, at: '', type: rootType, depth: 0 }]
  let examined = 0
  /** 見つけた権限の問題（'busy' が見つからなければこれを答えにする）。 */
  let permissionDeniedAt: string | null = null

  while (queue.length > 0 && examined < MAX_PROBED_ENTRIES) {
    const node = queue.shift() as PendingNode

    examined += 1

    // リンクは開かない・辿らない（指し先を触らないため）。
    if (node.type === 'link') {
      continue
    }

    const found =
      node.type === 'directory'
        ? await probeDirectory(probe, node, queue)
        : await probeFile(probe, node)

    if (found === 'busy') {
      return { kind: 'busy', at: node.at }
    }

    if (found === 'permission-denied' && permissionDeniedAt === null) {
      permissionDeniedAt = node.at
    }
  }

  return permissionDeniedAt === null
    ? { kind: 'unknown', at: null }
    : { kind: 'permission-denied', at: permissionDeniedAt }
}

/** フォルダを開いて、中身を待ち行列へ足す。開けなければその理由を返す。 */
async function probeDirectory(
  probe: DeleteProbe,
  node: PendingNode,
  queue: PendingNode[]
): Promise<DeleteObstacleKind | null> {
  let children: readonly ProbeChild[]

  try {
    children = await probe.listChildren(node.path)
  } catch (cause) {
    return obstacleOfErrno(errnoCodeOf(cause))
  }

  if (node.depth >= MAX_PROBE_DEPTH) {
    return null
  }

  for (const child of children) {
    queue.push({
      path: join(node.path, child.name),
      at: node.at === '' ? child.name : `${node.at}/${child.name}`,
      type: child.type,
      depth: node.depth + 1
    })
  }

  return null
}

/** ファイルを書き込みのために開けるか。開けなければその理由を返す。 */
async function probeFile(
  probe: DeleteProbe,
  node: PendingNode
): Promise<DeleteObstacleKind | null> {
  try {
    await probe.openForWrite(node.path)

    return null
  } catch (cause) {
    const kind = obstacleOfErrno(errnoCodeOf(cause))

    /*
      中のものが消えていることは、フォルダが消せない理由にならない
      （歩いている間に別のものが片付けただけ）。対象自身の 'not-found' は
      呼び出しの入口（statLink）で答えが出ている。
    */
    return kind === 'not-found' ? null : kind
  }
}

/* ---------------------------------------------------------- 既定の実装 */

function toProbeEntryType(stats: {
  isSymbolicLink: () => boolean
  isDirectory: () => boolean
}): ProbeEntryType {
  if (stats.isSymbolicLink()) {
    return 'link'
  }

  return stats.isDirectory() ? 'directory' : 'file'
}

export const nodeDeleteProbe: DeleteProbe = {
  statLink: async (path) => toProbeEntryType(await lstat(path)),

  listChildren: async (path) =>
    (await readdir(path, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      type: toProbeEntryType(entry)
    })),

  /**
   * 書き込みのために開いてすぐ閉じる。
   *
   * `r+` を使う ── 中身を変えずに「書ける状態か」を訊ける唯一の開き方で、
   * `w` は開けた瞬間に中身を捨ててしまう。
   */
  openForWrite: async (path) => {
    let handle: Awaited<ReturnType<typeof open>> | null = null

    try {
      handle = await open(path, 'r+')
    } finally {
      // 閉じられなかったことを、開けなかったことと取り違えない。
      await handle?.close().catch(() => undefined)
    }
  }
}
