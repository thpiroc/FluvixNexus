import type { BigIntStats } from 'fs'
import { lstat, realpath, type FileHandle } from 'fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'path'
import { errnoCodeOf } from '../../files/errno'
import { isInsideWorkspace, isSamePath, resolveWorkspacePath } from '../../files/workspacePath'
import { normalizeAgentRelativePath } from './agentPathSyntax'

/**
 * Workspace Boundary（Security Core v1 の STEP2）。
 *
 * FN Agent が指したパス1件を、**Main がディスクを見て**確かめる。Security Decision
 * （STEP1 の decideSecurityAction）へ渡す「Workspace の中か」「hard link か」は、
 * LLM・Renderer・Agent の申告ではなく、ここが返した結果からだけ作る（boundaryFacts.ts）。
 *
 * ## 確かめる順番
 *
 * ```
 * 1. 文字列      agentPathSyntax.ts（既存の normalizeWorkspaceRelativePath ＋ Agent 用の条件）
 * 2. root        realpath → lstat でディレクトリか。取れなければ拒否（no-workspace）
 * 3. 対象        realpath → realpath した root の中か（isInsideWorkspace。区切りまで含めて比べる）
 *                → lstat で種別・identity（dev / ino）・リンク数
 * 4. 無い対象    いちばん近い既存の祖先を realpath → root の中か・ディレクトリか
 *                → 最初の欠けている要素を lstat して「本当に無い」ことを確かめる
 * ```
 *
 * 既存の Files（readWorkspaceFile.ts / writeWorkspaceFile.ts）と同じく、
 * **文字列の検査と実体の検査の両方**を通す。どちらか一方では足りない
 * （文字列だけでは symlink / ジャンクションが分からず、実体だけでは `C:foo` のような
 * 形の読み替えに判断が乗る）。
 *
 * ## 操作に使うのは realPath
 *
 * 結果の `realPath` は確かめた実体の絶対パスで、後の Gate はこれ（か、これを開いたハンドル）
 * だけを操作する。Agent の渡した文字列から組み直すと、確かめた対象と操作する対象が
 * 別物になる。
 *
 * ## 失敗は拒否（fail closed）
 *
 * root が取れない・realpath / lstat が失敗する・種別が分からない・引数の形が違う、の
 * どれも「中」には倒さない。ENOENT だけは「まだ無い」という事実として扱い、
 * それ以外の errno（EACCES・ELOOP・EPERM …）は `unverifiable` にする。
 *
 * ## TOCTOU（確かめてから操作するまでの差し替え）
 *
 * この層が保証するのは「**確かめた時点で**、realPath の実体は Workspace の中にあり、
 * identity とリンク数はこうだった」まで。その後の差し替えに対しては、Gate が使う
 * 2つの確認を用意する。
 *
 *   - recheckWorkspaceTarget()      操作の直前にもう一度解決し、root・実体・identity・
 *                                   リンク数が変わっていないか
 *   - confirmOpenedWorkspaceFile()  **開いたハンドル**が確かめた実体そのものか
 *                                   （fstat の identity・リンク数、開いた後のパスの状態）
 *
 * ハンドルを開いて確認し、以後はハンドル越しにだけ書く ── が File Write Gate（STEP7）の
 * 形になる。Node はディレクトリのハンドルを基点に開く手段（openat / O_NOFOLLOW）を
 * 持たないため、**開く瞬間**の差し替えを原理的に塞ぐことはできない。残る穴と Gate が
 * 負う対策は DESIGN.md §6.4 に書く。
 *
 * ## ここに無いもの
 *
 * Secret ファイルかどうか（STEP3）・書き込み（STEP7）・承認（STEP6）。
 * 判定を上書きする・確認を飛ばす引数は持たない。
 */

/** 何のために確かめるか。書き込みは対象がファイルであることと、リンク数を見る。 */
export type WorkspaceAccess = 'read' | 'write'

/** 拒否した理由（Audit Log に載せる想定。パスそのものは含めない）。 */
export type WorkspaceBoundaryDenial =
  /** 引数の形が違う（access が read / write でない）。 */
  | 'invalid-request'
  /** Workspace root が無い・取れない・ディレクトリでない。 */
  | 'no-workspace'
  /** パス文字列として受け付けない形。 */
  | 'invalid-path'
  /** 実体が Workspace の外にある。 */
  | 'outside-workspace'
  /** 読もうとした対象が無い。 */
  | 'not-found'
  /** 書こうとした対象がファイルではない（ディレクトリ・root）。 */
  | 'not-a-file'
  /** 途中の要素がディレクトリではない（`file.txt/new.txt`）。 */
  | 'parent-not-directory'
  /** ファイルでもディレクトリでもない（FIFO・socket・デバイス）。 */
  | 'unsupported-type'
  /** 無いはずの位置に、辿れないリンク（指し先の無い symlink / ジャンクション）がある。 */
  | 'dangling-link'
  /** realpath / lstat が ENOENT 以外で失敗した。 */
  | 'unverifiable'
  /** 確かめた後で、対象が変わっていた。 */
  | 'target-changed'

/** ファイルの実体を識別するもの（同じボリュームの同じ inode / ファイル ID）。 */
export interface FileIdentity {
  readonly dev: bigint
  readonly ino: bigint
}

/** 実体の状態。 */
export type WorkspaceTargetState =
  | {
      readonly kind: 'file'
      readonly identity: FileIdentity
      /** リンク数。1 より大きければ hard link（同じ中身を別の名前でも指している）。 */
      readonly linkCount: bigint
    }
  | { readonly kind: 'directory'; readonly identity: FileIdentity }
  | {
      /** まだ無い（書き込みでだけ現れる）。 */
      readonly kind: 'missing'
      /** いちばん近い既存の祖先（realpath 済み・Workspace の中・ディレクトリ）。 */
      readonly anchorRealPath: string
      readonly anchorIdentity: FileIdentity
      /**
       * anchor から先の、まだ無い要素（最後が対象の名前）。
       * 2 つ以上なら途中のディレクトリも無い。**v1 の File Write Gate はこれを拒否する**
       * （途中のディレクトリは作らない。DESIGN.md §6.4）。
       */
      readonly missingSegments: readonly string[]
    }

/**
 * Boundary が確かめた対象。**この module が作ったものだけ**が有効
 * （isVerifiedWorkspaceTarget。同じ形のオブジェクトを外で組んでも通らない）。
 */
export interface VerifiedWorkspaceTarget {
  readonly access: WorkspaceAccess
  /** 確かめたときに使った Workspace root（呼び出し側から受け取ったまま）。 */
  readonly rootPath: string
  /** root の実体。 */
  readonly realRootPath: string
  readonly rootIdentity: FileIdentity
  /** Agent が指した相対位置（正規化済み・区切りは `/`）。 */
  readonly requestedRelativePath: string
  /** 操作してよい絶対パス（実体。無い対象は anchor の実体の下に欠けている要素をつないだもの）。 */
  readonly realPath: string
  /**
   * realPath の root からの相対位置（区切りは `/`）。ディスク上の綴りそのもので、
   * symlink / ジャンクション・8.3 の短い名前・大文字小文字の違いを解いた後の名前。
   * Secret の判定（STEP3）はこちらも見る。
   */
  readonly canonicalRelativePath: string
  /**
   * 指した場所と実体の場所が違う（途中に symlink / ジャンクション・8.3 の短い名前がある）。
   * 大文字小文字だけの違いは、Windows では同じ場所として比べるため含めない
   * （実体の綴りは canonicalRelativePath に出る）。
   * **v1 の File Write Gate は、書き込みでこれが true なら拒否する**
   * （symlink / ジャンクションを通した書き込みは v2 以降で再検討。DESIGN.md §6.4）。
   * 読み取りは、実体が Workspace の中なら true でも許可してよい。
   */
  readonly aliased: boolean
  readonly state: WorkspaceTargetState
}

export type WorkspaceBoundaryResult =
  | { readonly ok: true; readonly target: VerifiedWorkspaceTarget }
  | { readonly ok: false; readonly denial: WorkspaceBoundaryDenial }

/** この module が返した対象。凍結してあり、ここに無いものは「確かめていない」。 */
const issuedTargets = new WeakSet<object>()

/** そのオブジェクトが、この module が確かめて返した対象か。 */
export function isVerifiedWorkspaceTarget(value: unknown): value is VerifiedWorkspaceTarget {
  return typeof value === 'object' && value !== null && issuedTargets.has(value)
}

/**
 * Agent が指したパス1件を、Workspace root に対して確かめる。
 *
 * `rootPath` は **Main が持つ今の Workspace**（currentWorkspaceBoundary.ts が渡す）。
 * Agent や Renderer から受け取った root を渡してはいけない。
 */
export async function resolveWorkspaceTarget(
  rootPath: unknown,
  rawRelativePath: unknown,
  access: unknown
): Promise<WorkspaceBoundaryResult> {
  try {
    return await resolve(rootPath, rawRelativePath, access)
  } catch {
    // 想定していない例外も「中」には倒さない。
    return DENIALS.unverifiable
  }
}

async function resolve(
  rootPath: unknown,
  rawRelativePath: unknown,
  access: unknown
): Promise<WorkspaceBoundaryResult> {
  if (access !== 'read' && access !== 'write') {
    return DENIALS['invalid-request']
  }

  if (!isUsableRootPath(rootPath)) {
    return DENIALS['no-workspace']
  }

  const relativePath = normalizeAgentRelativePath(rawRelativePath)

  if (relativePath === null) {
    return DENIALS['invalid-path']
  }

  // 2. root の実体。Workspace が symlink / ジャンクションの下にあっても、境界は実体で引く。
  const root = await inspectRoot(rootPath)

  if (root === null) {
    return DENIALS['no-workspace']
  }

  const lexicalPath = resolveWorkspacePath(root.realPath, relativePath)

  if (lexicalPath === null) {
    return DENIALS['outside-workspace']
  }

  // 3. 対象の実体。
  let realTargetPath: string | null

  try {
    realTargetPath = await realpath(lexicalPath)
  } catch (cause) {
    if (errnoCodeOf(cause) !== 'ENOENT') {
      return DENIALS.unverifiable
    }

    realTargetPath = null
  }

  let state: WorkspaceTargetState
  let realPath: string

  if (realTargetPath === null) {
    // 4. まだ無い対象。
    if (access === 'read') {
      return DENIALS['not-found']
    }

    const missing = await inspectMissing(root.realPath, relativePath)

    if (!missing.ok) {
      return missing
    }

    state = missing.state
    realPath = missing.realPath
  } else {
    if (!isInsideWorkspace(root.realPath, realTargetPath)) {
      return DENIALS['outside-workspace']
    }

    const existing = await inspectExisting(realTargetPath)

    if (!existing.ok) {
      return existing
    }

    state = existing.state
    realPath = realTargetPath
  }

  if (access === 'write' && state.kind === 'directory') {
    return DENIALS['not-a-file']
  }

  const target: VerifiedWorkspaceTarget = Object.freeze({
    access,
    rootPath,
    realRootPath: root.realPath,
    rootIdentity: root.identity,
    requestedRelativePath: relativePath,
    realPath,
    canonicalRelativePath: toRelativePath(root.realPath, realPath),
    aliased: !isSamePath(lexicalPath, realPath),
    state
  })

  issuedTargets.add(target)

  return Object.freeze({ ok: true, target })
}

function isUsableRootPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value)
}

async function inspectRoot(
  rootPath: string
): Promise<{ readonly realPath: string; readonly identity: FileIdentity } | null> {
  try {
    const realRootPath = await realpath(rootPath)
    const stats = await lstat(realRootPath, { bigint: true })

    // realpath 済みのものがリンクなら、解いた直後に差し替えられている。
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return null
    }

    return { realPath: realRootPath, identity: identityOf(stats) }
  } catch {
    return null
  }
}

type Inspection =
  | { readonly ok: true; readonly state: WorkspaceTargetState; readonly realPath: string }
  | { readonly ok: false; readonly denial: WorkspaceBoundaryDenial }

async function inspectExisting(realTargetPath: string): Promise<Inspection> {
  let stats: BigIntStats

  try {
    stats = await lstat(realTargetPath, { bigint: true })
  } catch {
    return DENIALS.unverifiable
  }

  // realpath は最後までリンクを解いている。ここでリンクに見えるなら、その間に差し替えられた。
  if (stats.isSymbolicLink()) {
    return DENIALS['target-changed']
  }

  if (stats.isFile()) {
    return {
      ok: true,
      realPath: realTargetPath,
      state: Object.freeze({
        kind: 'file',
        identity: identityOf(stats),
        linkCount: stats.nlink
      })
    }
  }

  if (stats.isDirectory()) {
    return {
      ok: true,
      realPath: realTargetPath,
      state: Object.freeze({ kind: 'directory', identity: identityOf(stats) })
    }
  }

  return DENIALS['unsupported-type']
}

/**
 * まだ無い対象を、いちばん近い既存の祖先から確かめる。
 *
 * 対象そのものは realpath できないため、祖先を realpath して境界を見る。
 * 見るのは祖先だけでは足りない ── **最初の欠けている要素が「指し先の無いリンク」だと**、
 * realpath は ENOENT を返すのに、そこへ書けばリンクを辿って外にファイルができる。
 * だからその要素を lstat し、本当に何も無い（ENOENT）ことまで確かめる。
 *
 * 途中のディレクトリが無い形（`a/b/new.txt` で `b` が無い）も解決はし、欠けている要素を
 * すべて返す（事実を落とさないため）。**v1 の File Write Gate は、要素が 2 つ以上なら拒否する。**
 */
async function inspectMissing(realRootPath: string, relativePath: string): Promise<Inspection> {
  // root（空文字）は realpath できているはずで、ここへは来ない。
  if (relativePath === '') {
    return DENIALS['target-changed']
  }

  const segments = relativePath.split('/')

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const candidate = join(realRootPath, ...segments.slice(0, index))
    let anchorRealPath: string

    try {
      anchorRealPath = await realpath(candidate)
    } catch (cause) {
      if (errnoCodeOf(cause) === 'ENOENT' && index > 0) {
        continue
      }

      // root 自身が消えた、または ENOENT 以外の失敗。
      return DENIALS.unverifiable
    }

    if (!isInsideWorkspace(realRootPath, anchorRealPath)) {
      return DENIALS['outside-workspace']
    }

    let anchorStats: BigIntStats

    try {
      anchorStats = await lstat(anchorRealPath, { bigint: true })
    } catch {
      return DENIALS.unverifiable
    }

    if (anchorStats.isSymbolicLink()) {
      return DENIALS['target-changed']
    }

    // `file.txt/new.txt` のように、既存のファイルの下を指している
    // （Windows の realpath はこれを ENOTDIR ではなく ENOENT で返す）。
    if (!anchorStats.isDirectory()) {
      return DENIALS['parent-not-directory']
    }

    const missingSegments = segments.slice(index)
    const firstMissing = join(anchorRealPath, missingSegments[0])

    try {
      const entry = await lstat(firstMissing, { bigint: true })

      return entry.isSymbolicLink() ? DENIALS['dangling-link'] : DENIALS['target-changed']
    } catch (cause) {
      if (errnoCodeOf(cause) !== 'ENOENT') {
        return DENIALS.unverifiable
      }
    }

    return {
      ok: true,
      realPath: join(anchorRealPath, ...missingSegments),
      state: Object.freeze({
        kind: 'missing',
        anchorRealPath,
        anchorIdentity: identityOf(anchorStats),
        missingSegments: Object.freeze([...missingSegments])
      })
    }
  }

  return DENIALS.unverifiable
}

/**
 * 操作の直前に、同じ対象をもう一度確かめる。
 *
 * 同じ root・同じ相対位置・同じ access で解決し直し、次のどれかが変わっていれば
 * `target-changed` で拒否する。
 *
 *   - root の実体と identity（root のジャンクションが差し替えられた）
 *   - 対象の実体のパス（途中のディレクトリがリンクに差し替えられた）
 *   - 種別・identity（ファイルが別のファイルに置き換えられた）
 *   - リンク数（後から hard link が張られた / 外された）
 *   - 無い対象の anchor と、欠けている要素
 *
 * 解決し直した結果が拒否なら、その理由をそのまま返す。
 */
export async function recheckWorkspaceTarget(target: unknown): Promise<WorkspaceBoundaryResult> {
  if (!isVerifiedWorkspaceTarget(target)) {
    return DENIALS['invalid-request']
  }

  const current = await resolveWorkspaceTarget(
    target.rootPath,
    target.requestedRelativePath,
    target.access
  )

  if (!current.ok) {
    return current
  }

  return isSameTarget(target, current.target) ? current : DENIALS['target-changed']
}

function isSameTarget(before: VerifiedWorkspaceTarget, after: VerifiedWorkspaceTarget): boolean {
  if (
    !isSamePath(before.realRootPath, after.realRootPath) ||
    !isSameIdentity(before.rootIdentity, after.rootIdentity) ||
    !isSamePath(before.realPath, after.realPath)
  ) {
    return false
  }

  const a = before.state
  const b = after.state

  switch (a.kind) {
    case 'file':
      return (
        b.kind === 'file' && isSameIdentity(a.identity, b.identity) && a.linkCount === b.linkCount
      )

    case 'directory':
      return b.kind === 'directory' && isSameIdentity(a.identity, b.identity)

    case 'missing':
      return (
        b.kind === 'missing' &&
        isSamePath(a.anchorRealPath, b.anchorRealPath) &&
        isSameIdentity(a.anchorIdentity, b.anchorIdentity) &&
        a.missingSegments.join('/') === b.missingSegments.join('/')
      )
  }
}

/**
 * 開いたハンドルが、確かめた対象そのものか。
 *
 * File Write Gate は realPath を開いた**後で**これを呼び、true のときだけ
 * そのハンドル越しに読み書きする。見るのは次のすべて。
 *
 *   - ハンドルの実体がファイルで、書き込みならリンク数が 1
 *   - 既存の対象なら、ハンドルの identity が確かめたときと同じ
 *   - realPath を今 lstat した実体がリンクではなく、ハンドルと同じ identity
 *     （開いたのが realPath の位置にあるものだった）
 *   - realPath の親を今 realpath しても同じ場所で、Workspace の中
 *     （途中がリンクに差し替えられていない）
 *
 * 新しく作ったファイル（state が missing）は、作った後のハンドルを渡す。
 * どれか1つでも確かめられなければ false（失敗は「同じ」に倒さない）。
 */
export async function confirmOpenedWorkspaceFile(
  target: unknown,
  handle: FileHandle
): Promise<boolean> {
  if (!isVerifiedWorkspaceTarget(target) || target.state.kind === 'directory') {
    return false
  }

  try {
    const opened = await handle.stat({ bigint: true })

    if (!opened.isFile()) {
      return false
    }

    if (target.access === 'write' && opened.nlink !== 1n) {
      return false
    }

    const openedIdentity = identityOf(opened)

    if (target.state.kind === 'file' && !isSameIdentity(target.state.identity, openedIdentity)) {
      return false
    }

    const atPath = await lstat(target.realPath, { bigint: true })

    if (atPath.isSymbolicLink() || !isSameIdentity(identityOf(atPath), openedIdentity)) {
      return false
    }

    const expectedParent = dirname(target.realPath)
    const realParent = await realpath(expectedParent)

    return (
      isSamePath(realParent, expectedParent) && isInsideWorkspace(target.realRootPath, realParent)
    )
  } catch {
    return false
  }
}

function identityOf(stats: BigIntStats): FileIdentity {
  return Object.freeze({ dev: stats.dev, ino: stats.ino })
}

function isSameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

/** root からの相対位置を、契約の表記（区切りは `/`・root は空文字）で返す。 */
function toRelativePath(realRootPath: string, realPath: string): string {
  return relative(realRootPath, realPath).split(sep).join('/')
}

function denial(reason: WorkspaceBoundaryDenial): {
  readonly ok: false
  readonly denial: WorkspaceBoundaryDenial
} {
  return Object.freeze({ ok: false, denial: reason })
}

const DENIALS = Object.freeze({
  'invalid-request': denial('invalid-request'),
  'no-workspace': denial('no-workspace'),
  'invalid-path': denial('invalid-path'),
  'outside-workspace': denial('outside-workspace'),
  'not-found': denial('not-found'),
  'not-a-file': denial('not-a-file'),
  'parent-not-directory': denial('parent-not-directory'),
  'unsupported-type': denial('unsupported-type'),
  'dangling-link': denial('dangling-link'),
  unverifiable: denial('unverifiable'),
  'target-changed': denial('target-changed')
})
