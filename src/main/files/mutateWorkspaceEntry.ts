import { constants } from 'fs'
import { copyFile, lstat, mkdir, realpath, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { shell } from 'electron'
import {
  COPY_NAME_MAX_ATTEMPTS,
  FILES_RELATIVE_PATH_MAX_LENGTH,
  copyCandidateName,
  findExistingNameProblem,
  findFileNameProblem,
  joinRelativePath,
  normalizeFileName,
  splitRelativePath,
  type FileEntry,
  type FileEntryType,
  type FileNameProblem
} from '@shared/files'
import { isWindows } from '../platform'
import { copyDirectoryContents } from './copyTree'
import { probeDeleteObstacle } from './deleteObstacle'
import { errnoCodeOf } from './errno'
import { toFileEntry } from './fileEntry'
import {
  isAtOrUnderPath,
  isInsideWorkspace,
  isSamePath,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath
} from './workspacePath'

/**
 * Workspace の中のファイル / フォルダを作る・改名する・移動する・複製する・削除する。
 *
 * readWorkspaceDirectory.ts が「読む」側でやっていることを、そのまま「書き換える」側にも通す。
 * ファイルシステムに触れる場所をここに閉じ、パス文字列に対する判断は
 * files/workspacePath.ts と shared/files/ が持つ（テストできる形に切り離してある）。
 *
 * ## 境界は「操作が起きるフォルダ」に対して確かめる
 *
 * 作成・改名・削除はどれも**あるフォルダの中で起きる**操作で、対象そのものは
 * 操作した後にしか（あるいは操作した時点で）存在しない。そのため確かめるのは
 * **親フォルダ**で、操作するのはその realpath の直下に限る。
 *
 * ```
 * 1. 相対位置を文字列として検証        `..` / 絶対パス / `:` / NUL / 長さ
 * 2. 名前を検証                        1階層ぶんの名前か（下記のとおり用途で2種類ある）
 * 3. 親フォルダを realpath まで解決     symlink / ジャンクションの指し先を見る
 * 4. その realpath が Workspace の中か  外なら拒否
 * 5. join(親の realpath, 名前) を操作   確かめた場所の直下だけを触る
 * ```
 *
 * **移動とコピーだけは親が2つある**（元の親と行き先の親）。片方だけを通すと、もう片方から
 * Workspace の外へ出られる。1〜5 を**両方に対して**通し、そのうえで
 * 「行き先が、動かす / 複製するもの自身か、その中にあるか」だけを固有の判断として足す
 * （下の moveWorkspaceEntry / copyWorkspaceEntry）。
 *
 * コピーにはもう1つ、他の操作に無い判断がある ── **元がリンクなら断る。**
 * 他の操作はリンクそのものを動かすだけだが、コピーは中身を持ってくる操作なので、
 * 辿ると Workspace の外の実体を中へ持ち込める（copyTree.ts / shared/files/copy.ts）。
 *
 * 4 で親を見るため、`linkToOutside/new.txt` のような要求は作成の時点で拒否される。
 * 一方 `linkToOutside` 自身の削除・改名は通る ── **リンクを消すのであって、
 * 指し先を消すのではない**ため。Workspace の中にある「外を指す入口」を片付けられないと、
 * ツリーに並んでいるのに手が出せないものが残る。
 *
 * 対象そのものの realpath を見て拒否する形にしていないのはこの理由による。
 * 見てしまうと「外を指すジャンクションは消せない」になり、
 * 守りたいもの（外の実体）とは別のものを守ることになる。
 *
 * ## 2 の「名前の検証」は、問いが2つある
 *
 * 同じ検証を全部の操作に通すと、**新規作成のための規則が既存のものにも掛かる。**
 * `aux.ts` は「これから作る名前」としては受け付けないが、他の OS で作られたものが
 * 実際に置かれていることはある。そこへ作成向けの規則を当てると、
 * ツリーに並んでいるのに削除できないファイルができる ── 守るものが何も無いのに、である。
 *
 * ```
 * これから付ける名前か   findFileNameProblem       resolveNewName    作成 / 改名の新しい名前
 * 既に在るものを指せるか findExistingNameProblem   resolveExisting   削除 / 改名の元
 * ```
 *
 * 後者が見るのは「1階層ぶんの名前として成立しているか」だけで、
 * **境界の検証（1・3・4・5）はどちらも同じものを通る。** 緩めたのは名前の規則であって、
 * Workspace の外へ出られないことでも、触る場所を親の realpath 直下に限ることでもない。
 * 実在するかどうかは、その先の lstat が答える。
 *
 * ## 失敗しても投げない
 *
 * 結末を値として返し、ipc/handlers/files.ts が IPC の失敗分類へ翻訳する
 * （この層は IPC を知らない）。読む側と同じ分担。
 */

/* ------------------------------------------------------------------ 結末 */

export type WorkspaceMutationFailure =
  /** 相対位置として扱えない（絶対パス・`..`・桁違いに長いなど）。 */
  | { readonly status: 'invalid-path' }
  /** 名前として扱えない。何が引っかかったかを添える。 */
  | { readonly status: 'invalid-name'; readonly problem: FileNameProblem }
  /** 相対位置としては読めるが、操作しようとした場所が Workspace の外にある。 */
  | { readonly status: 'outside-workspace' }
  /**
   * 行き先として成立しない（動かす / 複製するもの自身か、その中）。
   *
   * invalid-path と分けているのは、**パスの形は正しい**ため。利用者が直すのは
   * 書き方ではなく行き先の選び方で、文言もそこに合わせる必要がある
   * （shared/files/move.ts）。移動とコピーにしか起きない。
   */
  | { readonly status: 'invalid-destination' }
  /**
   * 複製しようとしたものが symlink / ジャンクションだった。
   *
   * コピーにしか起きない。**リンクを辿ると、Workspace の外にある実体の中身を
   * 中へ持ち込める**ため、指し先を複製しない（リンクを作り直す形にもしない）。
   * 削除・改名・移動がリンクに対して通る（リンクそのものを動かすだけ）のと
   * 矛盾しない ── 違うのは、コピーだけが**中身を持ってくる操作**である点。
   * 理由は shared/files/copy.ts。
   */
  | { readonly status: 'link-source' }
  /** 親フォルダ、または対象が無い。 */
  | { readonly status: 'not-found' }
  /** 同名のものが既にある。 */
  | { readonly status: 'already-exists' }
  /** 権限が無い。 */
  | { readonly status: 'permission-denied' }
  /**
   * 対象（フォルダなら中のもの）が他のプロセスに使われていて手が出せない。
   *
   * permission-denied と分けているのは、利用者の次の一手が違うため
   * ── こちらは**使っているアプリを閉じれば同じ操作が通る**。
   */
  | { readonly status: 'busy'; readonly detail: string }
  /** それ以外（I/O エラーなど）。 */
  | { readonly status: 'failed'; readonly detail: string }

export type CreateWorkspaceEntryOutcome =
  { readonly status: 'ok'; readonly entry: FileEntry } | WorkspaceMutationFailure

export type RenameWorkspaceEntryOutcome =
  | {
      readonly status: 'ok'
      readonly entry: FileEntry
      readonly fromRelativePath: string
    }
  | WorkspaceMutationFailure

/**
 * 移動の結末。
 *
 * 改名（RenameWorkspaceEntryOutcome）と同じ形にしてある。位置が変わったことを
 * 伝える相手（Files のツリー・Editor のタブ）にとって、名前が変わったのか
 * 場所が変わったのかで扱いが変わらないため。
 */
export type MoveWorkspaceEntryOutcome =
  | {
      readonly status: 'ok'
      readonly entry: FileEntry
      readonly fromRelativePath: string
    }
  | WorkspaceMutationFailure

/**
 * コピーの結末。
 *
 * 移動（MoveWorkspaceEntryOutcome）と形が違う。**コピーは元が動かない**ため
 * `fromRelativePath` を持たず、代わりにコピーだけに要るものが2つある。
 *
 *   skippedCount … 複製できずにとばした件数（リンクなど。copyTree.ts）
 *   partial      … 途中で失敗し、作りかけがコピー先に残っている
 *
 * `partial` を失敗の側に畳んでいないのは、**作られたものを伝える必要がある**ため。
 * 作りかけを消しに行かない（完全削除の経路を持たない）以上、それはツリーに
 * 現れるものとして扱うしかなく、伝えないと利用者から見て「失敗したのに何か増えた」
 * になる。
 */
export type CopyWorkspaceEntryOutcome =
  | {
      readonly status: 'ok'
      readonly entry: FileEntry
      readonly skippedCount: number
    }
  | {
      readonly status: 'partial'
      /** できかけのもの。位置を伝えるためだけに返す（中身は揃っていない）。 */
      readonly entry: FileEntry
      readonly skippedCount: number
      /** 何が止めたか。呼び出し側が IPC の失敗分類へ翻訳する。 */
      readonly failure: WorkspaceMutationFailure
    }
  | WorkspaceMutationFailure

export type DeleteWorkspaceEntryOutcome =
  | {
      readonly status: 'ok'
      readonly relativePath: string
      readonly entryType: FileEntryType
    }
  | WorkspaceMutationFailure

/* ------------------------------------------------------- fs の失敗の翻訳 */

function toFailure(cause: unknown): WorkspaceMutationFailure {
  switch (errnoCodeOf(cause)) {
    case 'ENOENT':
      return { status: 'not-found' }

    case 'EEXIST':
      return { status: 'already-exists' }

    case 'EACCES':
    case 'EPERM':
      return { status: 'permission-denied' }

    /*
      使用中は権限とは別に返す。同じ「使用中」が、どの API がそれを表に出したか
      （fs か、ごみ箱か）で違うコードになると、Renderer 側の文言が経路によって
      ぶれる。deleteObstacle.ts と読み替えを揃えておく。
    */
    case 'EBUSY':
    case 'ETXTBSY':
      return { status: 'busy', detail: String(cause) }

    case 'ELOOP':
    case 'ENAMETOOLONG':
    case 'EINVAL':
    case 'ENOTDIR':
      return { status: 'invalid-path' }

    /*
      フォルダの行き先が空でない（ENOTEMPTY）、ボリュームをまたいだ（EXDEV）。

      EXDEV は Workspace の中では滅多に起きない ── 中を指すことは realpath で
      確かめてあるため、残るのは「Workspace の中のフォルダに別のボリュームが
      マウントされている」場合だけ。**そのときに fs.rename を諦めて
      「コピーしてから消す」へ切り替えない。** 移動のつもりで始めた操作が、
      途中で失敗したときに元と先の両方に中途半端な状態を残す形になる。
    */
    case 'ENOTEMPTY':
    case 'EXDEV':
      return { status: 'failed', detail: String(cause) }

    default:
      return { status: 'failed', detail: String(cause) }
  }
}

/* ------------------------------------------------ 操作してよい場所の解決 */

/**
 * 操作が起きるフォルダ。境界（上のコメントの 1・3・4）を通した結果。
 *
 * 名前が絡む判断はここに入れない。作成・改名・削除で問いが違うのは名前の側だけで、
 * **境界の検証は3つとも同じものを通す**（分けた結果として検証が薄い経路が生まれない）。
 */
interface ResolvedParent {
  /** 正規化した親の相対位置。 */
  readonly parentRelativePath: string
  /** 親フォルダの realpath。 */
  readonly parentRealPath: string
}

/** 「このフォルダの中の、この名前」まで決まった状態。 */
interface ResolvedTarget extends ResolvedParent {
  /** 1階層ぶんの名前。 */
  readonly name: string
  /** 親の相対位置と名前をつないだもの（応答・イベントに載せる位置）。 */
  readonly relativePath: string
  /** 実際に fs へ渡す絶対パス（親の realpath の直下）。 */
  readonly absolutePath: string
}

type ResolveParentOutcome =
  { readonly status: 'ok'; readonly parent: ResolvedParent } | WorkspaceMutationFailure

type ResolveTargetOutcome =
  { readonly status: 'ok'; readonly target: ResolvedTarget } | WorkspaceMutationFailure

/**
 * 操作してよいフォルダを決める（1・3・4）。
 *
 * 作成・改名・削除のどれもここを通るため、境界の検証の抜けが操作ごとに生まれない。
 */
async function resolveParent(
  rootPath: string,
  rawParentRelativePath: unknown
): Promise<ResolveParentOutcome> {
  // 1. 親の相対位置を文字列として検証する。
  const parentRelativePath = normalizeWorkspaceRelativePath(rawParentRelativePath)

  if (parentRelativePath === null) {
    return { status: 'invalid-path' }
  }

  // 3-4. 親を realpath まで解決し、Workspace の中にあるか確かめる。
  const parentPath = resolveWorkspacePath(rootPath, parentRelativePath)

  if (parentPath === null) {
    return { status: 'outside-workspace' }
  }

  let realRootPath: string
  let parentRealPath: string

  try {
    realRootPath = await realpath(rootPath)
  } catch (cause) {
    // Workspace root ごと消えた / 外付けドライブが外れた。
    return toFailure(cause)
  }

  try {
    parentRealPath = await realpath(parentPath)
  } catch (cause) {
    return toFailure(cause)
  }

  if (!isInsideWorkspace(realRootPath, parentRealPath)) {
    return { status: 'outside-workspace' }
  }

  return { status: 'ok', parent: { parentRelativePath, parentRealPath } }
}

/** 確かめたフォルダと名前から、実際に触る場所を組み立てる（5）。 */
function targetIn(parent: ResolvedParent, name: string): ResolvedTarget {
  return {
    parentRelativePath: parent.parentRelativePath,
    parentRealPath: parent.parentRealPath,
    name,
    relativePath: joinRelativePath(parent.parentRelativePath, name),
    // 触るのは、確かめた realpath の直下だけ。
    absolutePath: join(parent.parentRealPath, name)
  }
}

/**
 * **これから付ける名前**を、そのフォルダの中の場所へ落とす（作成 / 改名の行き先）。
 *
 * 入力欄から来た文字列を受けるため、前後の空白はここで落とす（normalizeFileName）。
 * 検査は findFileNameProblem ── 区切り文字を弾くことが「1階層ぶん」の担保になり、
 * 予約デバイス名や末尾のドットは「作らせない」ために弾く。
 */
function newNameIn(parent: ResolvedParent, rawName: unknown): ResolveTargetOutcome {
  if (typeof rawName !== 'string') {
    return { status: 'invalid-name', problem: 'empty' }
  }

  const name = normalizeFileName(rawName)
  const problem = findFileNameProblem(name)

  if (problem !== null) {
    return { status: 'invalid-name', problem }
  }

  return { status: 'ok', target: targetIn(parent, name) }
}

/**
 * **既に在るもの**を指す相対位置を、操作してよい場所へ落とす（削除 / 改名の元）。
 *
 * 名前は正規化した相対位置から切り出したもので、**入力欄の文字列ではない。**
 * だから trim しない ── `notes.txt ` を trim すると別のファイルを指すことになる
 * （files/workspacePath.ts）。検査も findExistingNameProblem に限る。
 *
 * 実在するかどうかはここでは見ない。それは呼び出し側が lstat で確かめる
 * （改名では「元があること」と「行き先が無いこと」で見方が違うため）。
 */
async function resolveExisting(
  rootPath: string,
  rawRelativePath: unknown
): Promise<ResolveTargetOutcome> {
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  if (relativePath === null) {
    return { status: 'invalid-path' }
  }

  // root（空文字）は親を持たない ＝ 削除・改名の対象にならない。
  const split = splitRelativePath(relativePath)

  if (split === null) {
    return { status: 'invalid-path' }
  }

  /*
    正規化を通っていれば必ず満たすが、ここでも確かめる。
    「触るのは親の realpath の直下だけ」は名前が1階層ぶんであることに乗っており、
    その担保をこの関数の中で閉じておく（呼ぶ側の順序に依存させない）。
  */
  const problem = findExistingNameProblem(split.name)

  if (problem !== null) {
    return { status: 'invalid-name', problem }
  }

  const parent = await resolveParent(rootPath, split.parent)

  if (parent.status !== 'ok') {
    return parent
  }

  return { status: 'ok', target: targetIn(parent.parent, split.name) }
}

/**
 * 対象が今そこに在るか（と、ファイルかフォルダか）。
 *
 * **lstat を使う。** symlink / ジャンクションを指している場合、知りたいのは
 * 「リンクそのもの」の有無であって指し先ではない（削除・改名の対象はリンクの側）。
 */
async function lstatTarget(
  absolutePath: string
): Promise<
  { readonly status: 'ok'; readonly entryType: FileEntryType } | WorkspaceMutationFailure
> {
  try {
    const stats = await lstat(absolutePath)

    return { status: 'ok', entryType: stats.isDirectory() ? 'directory' : 'file' }
  } catch (cause) {
    return toFailure(cause)
  }
}

/* ------------------------------------------------------------------ 作成 */

/**
 * フォルダの中に新しいファイル / フォルダを作る。
 *
 * **存在の確認を別に行わない。** `writeFile` の `wx` と `mkdir`（recursive なし）は
 * どちらも既にあれば EEXIST で失敗する。先に確かめてから作ると、その隙間に
 * 同名のものが現れた場合に**中身を消して上書きする**ことになる。
 */
export async function createWorkspaceEntry(
  rootPath: string,
  rawParentRelativePath: unknown,
  rawName: unknown,
  rawType: unknown
): Promise<CreateWorkspaceEntryOutcome> {
  if (rawType !== 'file' && rawType !== 'directory') {
    return { status: 'invalid-path' }
  }

  const parent = await resolveParent(rootPath, rawParentRelativePath)

  if (parent.status !== 'ok') {
    return parent
  }

  const resolved = newNameIn(parent.parent, rawName)

  if (resolved.status !== 'ok') {
    return resolved
  }

  const { target } = resolved

  try {
    if (rawType === 'directory') {
      // recursive を付けない。付けると既存フォルダでも成功してしまい、
      // 「作った」と「既にあった」の区別が消える。
      await mkdir(target.absolutePath)
    } else {
      await writeFile(target.absolutePath, '', { flag: 'wx' })
    }
  } catch (cause) {
    return toFailure(cause)
  }

  return {
    status: 'ok',
    entry: toFileEntry(target.name, target.parentRelativePath, rawType)
  }
}

/* -------------------------------------------------------------- リネーム */

/**
 * 名前を変える（同じフォルダの中で完結する）。
 *
 * 移動は含まない。新しい名前に区切り文字を含められないため（findFileNameProblem）、
 * 行き先は必ず元と同じ親フォルダになる。移動は別の操作（moveWorkspaceEntry）で、
 * そちらは移動元と移動先の**両方**の親を境界に通す。
 *
 * ## 上書きしない
 *
 * `fs.rename` は Windows でも POSIX でも、行き先に既存のファイルがあれば
 * **黙って上書きする**。ここだけは事前に lstat で確かめてから実行する
 * （作成側と違い、上書きしない rename の指定が無いため）。
 * 確かめてから実行するまでの隙間は残るが、それは「同じ瞬間に外から同名のものが
 * 作られた場合」だけで、確かめないことによる上書きとは桁が違う。
 *
 * 大文字小文字だけを変える改名（`readme.md` → `README.md`）は、Windows では
 * 「行き先が既にある」と判定されてしまう。実体は同じものなので、
 * その組み合わせだけ存在確認を飛ばす。
 */
export async function renameWorkspaceEntry(
  rootPath: string,
  rawRelativePath: unknown,
  rawName: unknown
): Promise<RenameWorkspaceEntryOutcome> {
  /*
    元と行き先で、名前に対する問いが違う。

      元     … 既にそこに在るものを指せているか（`aux.ts` も指せる）
      行き先 … これから付ける名前として使えるか（`aux.ts` は受け付けない）

    行き先の親は元の親と同じ（新しい名前に区切り文字を含められないため）なので、
    境界の検証は resolveExisting の中で1回だけ通る。
  */
  const source = await resolveExisting(rootPath, rawRelativePath)

  if (source.status !== 'ok') {
    return source
  }

  const destination = newNameIn(source.target, rawName)

  if (destination.status !== 'ok') {
    return destination
  }

  const from = source.target
  const to = destination.target

  const existingSource = await lstatTarget(from.absolutePath)

  if (existingSource.status !== 'ok') {
    return existingSource
  }

  // 名前が変わらないなら何もしない（そのまま成功として返す）。
  if (from.name === to.name) {
    return {
      status: 'ok',
      entry: toFileEntry(to.name, to.parentRelativePath, existingSource.entryType),
      fromRelativePath: from.relativePath
    }
  }

  const isCaseOnlyChange = isWindows && from.name.toLowerCase() === to.name.toLowerCase()

  if (!isCaseOnlyChange) {
    const existing = await lstatTarget(to.absolutePath)

    if (existing.status === 'ok') {
      return { status: 'already-exists' }
    }

    // 「無い」以外の失敗（権限など）はそのまま返す。無いのが正常。
    if (existing.status !== 'not-found') {
      return existing
    }
  }

  try {
    await rename(from.absolutePath, to.absolutePath)
  } catch (cause) {
    return toFailure(cause)
  }

  return {
    status: 'ok',
    entry: toFileEntry(to.name, to.parentRelativePath, existingSource.entryType),
    fromRelativePath: from.relativePath
  }
}

/* ------------------------------------------------------------------ 移動 */

/**
 * 別のフォルダへ動かす（名前は変えない）。
 *
 * ## 改名と何が違うか
 *
 * fs から見れば同じ `fs.rename` だが、**確かめる相手の数が違う。**
 * 改名は行き先の親が元の親と必ず同じ（名前に区切り文字を含められない）ので、
 * 境界の検証は1回で済む。移動は元と先が別のフォルダなので、
 * `resolveExisting`（元）と `resolveParent`（先）で**両方**を通す。
 * 片方だけを通すと、通していない側から Workspace の外へ出られる。
 *
 * 元の側に `resolveExisting` を使うのは削除・改名と同じ理由で、
 * **既に在るものを指す名前**には作成向けの規則を当てないため
 * （他の OS で作られた `aux.ts` が「並んでいるのに動かせない」ものにならない）。
 * 名前は動かす前のものをそのまま使うので、行き先の名前の検査は要らない
 * ── 通ったことのある名前を、そのまま別のフォルダへ持っていくだけになる。
 *
 * ## 自分自身の中へは動かせない
 *
 * `src` を `src/lib` へ動かす要求は、パスとしても名前としても正しい。
 * fs に任せると OS が EINVAL で断るが、そこから「引数が変」以上のことは分からず、
 * 利用者に何を直せばよいかを伝えられない。**判断できる側で判断する**
 * （`invalid-destination`）。
 *
 * 比べるのは realpath どうし。相対位置の文字列で比べると、途中にジャンクションを
 * 挟んだ行き先（`link/sub` が実は `src/sub`）をすり抜けさせてしまう。
 *
 * ## 上書きしない
 *
 * 改名と同じく、`fs.rename` は行き先に既存のものがあれば黙って上書きする。
 * 移動では行き先が**別のフォルダ**にある分、利用者からは見えていないことも多い。
 * 事前に lstat で確かめ、在れば `already-exists` として断る。
 */
export async function moveWorkspaceEntry(
  rootPath: string,
  rawRelativePath: unknown,
  rawToParentRelativePath: unknown
): Promise<MoveWorkspaceEntryOutcome> {
  const source = await resolveExisting(rootPath, rawRelativePath)

  if (source.status !== 'ok') {
    return source
  }

  const destination = await resolveParent(rootPath, rawToParentRelativePath)

  if (destination.status !== 'ok') {
    return destination
  }

  const from = source.target
  const parent = destination.parent

  const existingSource = await lstatTarget(from.absolutePath)

  if (existingSource.status !== 'ok') {
    return existingSource
  }

  /*
    行き先がフォルダであること。

    resolveParent は realpath が取れれば通す（ファイルでも通る）。そのまま進むと
    `join(ファイル, 名前)` を rename に渡すことになり、失敗はするが
    ENOTDIR / ENOENT のどちらで返るかが OS 任せになる。ここで断っておく。
  */
  const destinationType = await lstatTarget(parent.parentRealPath)

  if (destinationType.status !== 'ok') {
    return destinationType
  }

  if (destinationType.entryType !== 'directory') {
    return { status: 'invalid-path' }
  }

  /*
    既にそのフォルダに居るなら、何もせずに成功として返す（改名で名前が変わらない
    場合と同じ扱い）。触らないのは、行き先の存在確認が**自分自身**を見つけて
    `already-exists` になるため ── 動かないという結果は同じでも、
    「同名のものがある」という理由は嘘になる。

    比べるのは realpath。別の相対位置が同じフォルダを指しうる。
  */
  if (isSamePath(parent.parentRealPath, from.parentRealPath)) {
    return {
      status: 'ok',
      entry: toFileEntry(from.name, from.parentRelativePath, existingSource.entryType),
      fromRelativePath: from.relativePath
    }
  }

  /*
    行き先が、動かすもの自身か、その中にある。

    種別で分岐しない。ファイルの中へは入れないので、この判定が真になるのは
    フォルダのときだけになる（判定する側で種別を持ち出すと、
    ジャンクションを lstat がどう答えるかに結果が依存し始める）。
  */
  if (isAtOrUnderPath(from.absolutePath, parent.parentRealPath)) {
    return { status: 'invalid-destination' }
  }

  const to = targetIn(parent, from.name)
  const existing = await lstatTarget(to.absolutePath)

  if (existing.status === 'ok') {
    return { status: 'already-exists' }
  }

  // 「無い」以外の失敗（権限など）はそのまま返す。無いのが正常。
  if (existing.status !== 'not-found') {
    return existing
  }

  try {
    await rename(from.absolutePath, to.absolutePath)
  } catch (cause) {
    return toFailure(cause)
  }

  return {
    status: 'ok',
    entry: toFileEntry(to.name, to.parentRelativePath, existingSource.entryType),
    fromRelativePath: from.relativePath
  }
}

/* ------------------------------------------------------------------ コピー */

/**
 * 別のフォルダへ複製する（元はそのまま残る）。
 *
 * ## 移動と何が違うか
 *
 * 境界の確かめ方は移動とまったく同じ ── `resolveExisting`（元）と
 * `resolveParent`（コピー先）の**両方**を通し、コピー先が複製するもの自身か
 * その中にあれば断る（そうしないと、複製の中へ複製を作り続けることになる）。
 * 違うのは次の4点で、どれもコピーが「中身を持ってくる操作」であることから来る。
 *
 * | | 移動 | コピー |
 * | --- | --- | --- |
 * | 同じフォルダが行き先 | 何もせず成功（位置が変わらない） | **成立する**（複製が1つ増える） |
 * | 同名のものがある | 断る（already-exists） | **名前を変えて作る**（下記） |
 * | 元がリンク | 通る（リンクを動かすだけ） | **断る**（指し先の中身を持ち込まない） |
 * | 1回の fs 操作で終わるか | 終わる（rename） | **終わらない**（途中で失敗しうる） |
 *
 * ## 名前は「作ってみて、既にあったら次の候補へ」で決める
 *
 * `example.txt` → `example copy.txt` → `example copy 2.txt`（shared/files/copyName.ts）。
 * 上書きしない点は作成・改名・移動と揃えてあり、コピーだけが**利用者に名前を
 * 訊き直さずに済ませている。** 複製は「同じものをもう1つ」であって、
 * 名前そのものに意味が無いため成立する。
 *
 * **先に一覧を読んで空き番号を探さない。** 読んでから作るまでの隙間に同名のものが
 * 現れると、そこで上書きが起きる。`COPYFILE_EXCL` と recursive なしの `mkdir` は
 * どちらも既にあれば EEXIST になるので、**作ってみて EEXIST なら次の候補**へ
 * 進めば、その隙間が無い（createWorkspaceEntry と同じ考え方）。
 *
 * ## 途中で失敗しても片付けない
 *
 * フォルダの再帰コピーは1回の fs 操作では終わらない。途中で権限や使用中に
 * 当たったら**そこで止め、作りかけはそのまま残す**（`partial`）。
 * 消しに行くと、Renderer から届いた要求で戻せない削除が起きる経路を1つ増やす
 * ことになる（このファイル冒頭の削除の方針）。残ったものはツリーに現れるので、
 * 利用者が見て消せる。
 *
 * 移動が EXDEV で「コピーしてから消す」へ切り替えないのと向きは違うが、
 * 拠りどころは同じ ── **アプリが黙って中途半端な状態を作らない / 消さない。**
 */
export async function copyWorkspaceEntry(
  rootPath: string,
  rawRelativePath: unknown,
  rawToParentRelativePath: unknown
): Promise<CopyWorkspaceEntryOutcome> {
  const source = await resolveExisting(rootPath, rawRelativePath)

  if (source.status !== 'ok') {
    return source
  }

  const destination = await resolveParent(rootPath, rawToParentRelativePath)

  if (destination.status !== 'ok') {
    return destination
  }

  const from = source.target
  const parent = destination.parent

  /*
    元の種別。lstatTarget ではなく lstat を直に呼ぶのは、**リンクかどうかを
    知る必要がある**ため（lstatTarget はリンクを指し先の種別に畳んでしまう）。
  */
  let sourceStats: Awaited<ReturnType<typeof lstat>>

  try {
    sourceStats = await lstat(from.absolutePath)
  } catch (cause) {
    return toFailure(cause)
  }

  if (sourceStats.isSymbolicLink()) {
    return { status: 'link-source' }
  }

  if (!sourceStats.isDirectory() && !sourceStats.isFile()) {
    // 名前付きパイプなど。中身を持ってくる手段が無い。
    return { status: 'invalid-path' }
  }

  const sourceType: FileEntryType = sourceStats.isDirectory() ? 'directory' : 'file'

  // 行き先がフォルダであること（移動と同じ理由。fs 任せにすると失敗の形が OS 任せになる）。
  const destinationType = await lstatTarget(parent.parentRealPath)

  if (destinationType.status !== 'ok') {
    return destinationType
  }

  if (destinationType.entryType !== 'directory') {
    return { status: 'invalid-path' }
  }

  /*
    コピー先が、複製するもの自身かその中。

    移動では「動かせない」だけだが、コピーでは**複製の中を複製し続ける**ことになる。
    比べるのは realpath どうし（相対位置の文字列で比べると、途中にジャンクションを
    挟んだ行き先をすり抜けさせてしまう）。元がリンクでないことは上で確かめてあるので、
    from.absolutePath はそのまま実体の位置になる。
  */
  if (isAtOrUnderPath(from.absolutePath, parent.parentRealPath)) {
    return { status: 'invalid-destination' }
  }

  for (let attempt = 0; attempt <= COPY_NAME_MAX_ATTEMPTS; attempt += 1) {
    const name = copyCandidateName(from.name, sourceType, attempt)

    // 連番と拡張子だけで名前の上限に達した。これ以上の候補は作れない。
    if (name === null) {
      return { status: 'invalid-name', problem: 'too-long' }
    }

    const to = targetIn(parent, name)

    /*
      Renderer へ渡す相対位置は、契約上の上限に収まっていること
      （FILES_RELATIVE_PATH_MAX_LENGTH）。コピー先が深いほど長くなるため、
      ここだけは組み立てた後に確かめる必要がある。
    */
    if (to.relativePath.length > FILES_RELATIVE_PATH_MAX_LENGTH) {
      return { status: 'invalid-path' }
    }

    try {
      if (sourceType === 'directory') {
        await mkdir(to.absolutePath)
      } else {
        await copyFile(from.absolutePath, to.absolutePath, constants.COPYFILE_EXCL)
      }
    } catch (cause) {
      // 既にあるなら次の候補へ。それ以外は失敗として返す。
      if (errnoCodeOf(cause) === 'EEXIST') {
        continue
      }

      return toFailure(cause)
    }

    const entry = toFileEntry(to.name, to.parentRelativePath, sourceType)

    if (sourceType === 'file') {
      return { status: 'ok', entry, skippedCount: 0 }
    }

    const copied = await copyDirectoryContents(from.absolutePath, to.absolutePath)

    if (copied.status === 'failed') {
      return {
        status: 'partial',
        entry,
        skippedCount: copied.skippedCount,
        failure: toFailure(copied.cause)
      }
    }

    return { status: 'ok', entry, skippedCount: copied.skippedCount }
  }

  /*
    候補を使い切った。名前を変えれば通る失敗なので already-exists として返す
    （利用者の次の一手は「コピー先の名前を整理する」になる）。
  */
  return { status: 'already-exists' }
}

/* ------------------------------------------------------------------ 削除 */

/**
 * OS のごみ箱へ送る。
 *
 * ## 完全削除の経路を持たない
 *
 * `fs.rm` を公開していない。Renderer から来た要求で戻せない削除が起きる状態を作らない
 * ため（誤操作の確認は UI 側にも入れているが、UI は迂回されうる）。
 * `shell.trashItem` は Electron が Windows の IFileOperation を呼ぶもので、
 * フォルダは中身ごとごみ箱へ入り、元の場所へ戻せる。
 *
 * ごみ箱へ送れない場合（ネットワークドライブ・ごみ箱を持たない場所・容量超過）は
 * **失敗として返し、完全削除に切り替えない。** 「ごみ箱に入ったつもりが消えていた」
 * が起きる方が、削除できないより悪い。
 *
 * ## 消すのは「リンクそのもの」
 *
 * 対象がジャンクション / symlink の場合、消えるのはリンクであって指し先ではない
 * （Windows のシェル削除は再解析ポイントを外す）。境界の検証を親フォルダに対して
 * 行っている（このファイルの冒頭）のと同じ理由で、これが意図した振る舞いになる。
 *
 * ## シェルに宛先を伝えられない名前は、消さずに断る
 *
 * `shell.trashItem` だけは fs と経路が違う。node は拡張表記（`\\?\`）でファイルシステムを
 * 叩くため `notes.txt ` を字義どおり扱えるが、**シェル側は Win32 のパス正規化を通し、
 * 末尾の空白とドットを落とす。** その結果 `notes.txt ` を渡すと、隣にある
 * **`notes.txt` の方がごみ箱へ入る**（この環境で確認済み。拡張表記を渡すと
 * `Failed to parse path` で受け付けられない）。
 *
 * 指したものと違うものが消えるのは、削除できないことより悪い。宛先を正しく伝えられない
 * 名前は**操作せずに失敗として返す**（`shell.trashItem` へ渡さない）。
 * `fs.rm` に切り替えないのは、完全削除の経路を持たない方針を曲げないため。
 *
 * 掛かるのは削除だけ。作成はこの形の名前を受け付けず（findFileNameProblem）、
 * 改名は `fs.rename` を使うので字義どおり動く（確認済み）── つまり
 * **この名前のものは、改名してから消せる。**
 */
export async function deleteWorkspaceEntry(
  rootPath: string,
  rawRelativePath: unknown
): Promise<DeleteWorkspaceEntryOutcome> {
  /*
    指すのは既に在るものなので、作成向けの名前の規則は当てない（resolveExisting）。
    当てると、他の OS で作られた `aux.ts` や末尾に空白を持つ名前が
    「ツリーには並ぶのに消せないもの」として残る。
    Workspace の境界・symlink の扱い・触る場所を親の realpath 直下に限ることは、
    作成 / 改名とまったく同じものを通る。
  */
  const resolved = await resolveExisting(rootPath, rawRelativePath)

  if (resolved.status !== 'ok') {
    return resolved
  }

  const { target } = resolved
  const existing = await lstatTarget(target.absolutePath)

  if (existing.status !== 'ok') {
    return existing
  }

  if (isUnreachableByShell(target.name)) {
    return {
      status: 'failed',
      detail:
        'the shell delete API cannot address a name ending with a space or a dot; rename it first.'
    }
  }

  try {
    await shell.trashItem(target.absolutePath)
  } catch (cause) {
    return await classifyTrashFailure(target.absolutePath, cause)
  }

  return { status: 'ok', relativePath: target.relativePath, entryType: existing.entryType }
}

/**
 * ごみ箱へ送れなかった理由を決める。
 *
 * `shell.trashItem` の Error には `code` が無く、message も原因と1対1にならない
 * （deleteObstacle.ts の冒頭に観測結果を残してある）。そのため**投げられた例外は
 * 分類に使わず**、ファイルシステムに訊き直した結果で決める。
 * 例外の message は detail に残す ── 分類には使えないが、診断には要る。
 */
async function classifyTrashFailure(
  absolutePath: string,
  cause: unknown
): Promise<WorkspaceMutationFailure> {
  const obstacle = await probeDeleteObstacle(absolutePath)
  const where = obstacle.at === null || obstacle.at === '' ? 'the target' : `"${obstacle.at}"`
  const detail = `${describeCause(cause)} (probe: ${obstacle.kind} at ${where})`

  switch (obstacle.kind) {
    case 'not-found':
      // 削除と行き違っただけ。利用者の見たいものは既に消えている。
      return { status: 'not-found' }

    case 'busy':
      return { status: 'busy', detail }

    case 'permission-denied':
      return { status: 'permission-denied' }

    case 'unknown':
      /*
        以前はここも含めて一律 permission-denied にしていた。分からないものを
        「権限が無い」と言い切ると、閉じれば消せる場合にも利用者を諦めさせる。
        分からないことは分からないまま返し、文言は Renderer 側で決める。
      */
      return { status: 'failed', detail }
  }
}

/** 例外を診断用の1行へ。分類には使わない（detail 専用）。 */
function describeCause(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
}

/**
 * その名前を `shell.trashItem` へ渡すと、**別のものを指してしまう**か。
 *
 * Windows のシェル API は末尾の空白とドットを落とすため、`notes.txt ` と `notes.`
 * は隣の `notes.txt` / `notes` に化ける。fs 側（node）は化けないので、
 * ここで初めて食い違いが出る。
 *
 * Windows でだけ見る。他の OS のごみ箱 API はこの正規化をしない。
 */
function isUnreachableByShell(name: string): boolean {
  return isWindows && (name.endsWith(' ') || name.endsWith('.'))
}
