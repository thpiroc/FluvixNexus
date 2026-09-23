import type { GitRepositoryState } from '@shared/git'
import { isAgentPermissionMode, type AgentPermissionMode } from '@shared/security'
import type {
  SearchWorkspaceFileContentsOutcome,
  WorkspaceContentSearchOptions
} from '../../files/searchWorkspaceFileContents'
import type { ReadWorkspaceDirectoryOutcome } from '../../files/readWorkspaceDirectory'
import type { AuditEvent, AuditReason } from '../audit/auditEvent'
import { fileReadTargetFacts } from '../boundary/boundaryFacts'
import {
  isVerifiedWorkspaceTarget,
  type VerifiedWorkspaceTarget,
  type WorkspaceBoundaryResult
} from '../boundary/workspaceBoundary'
import type { RawExternalContextItem } from '../externalSend/externalSendContext'
import type { ExternalSendDenial } from '../externalSend/externalSendDecision'
import {
  workspaceFileContext,
  type WorkspaceFileExcerpt
} from '../externalSend/workspaceFileContext'
import { decideSecurityAction } from '../policy/securityDecision'
import { FAIL_CLOSED_SECURITY_POLICY, type SecurityPolicy } from '../policy/securityPolicy'
import { agentFileReadFacts, isSecretWorkspaceTarget } from '../secret/secretFileFacts'
import { maskSecretText, redactSecretText, SECRET_MASK } from '../secret/secretMasking'
import { classifySecretPath } from '../secret/secretPaths'
import { readToolDeniedEvent, type ReadToolName } from './readToolsAudit'
import type { ReadFileBytesResult } from './readToolsIo'

/**
 * FN Agent の読み取り系 Tool の Gate（Security Core v1 の STEP9。Electron にも fs にも
 * 依存しない ── 実際に読む部分はすべて引数で受け取る）。
 *
 * **「Read だから無制限に読める」にはしない。** 4つの読み取りは、どれも Security Core を
 * 通ってから Agent へ返る。
 *
 * ```
 * file_read         Boundary（STEP2）→ Secret ファイル（STEP3）→ Policy（STEP1）
 *                   → 確かめたハンドル越しに読む → 全体で Mask して範囲を切り出す
 *                     （workspaceFileContext。External Send Gate がもう一度判定する）
 * workspace_list    Boundary → Secret の置き場所でない → Policy → 1階層だけ
 *                   → Secret ファイルは「ある」とだけ示す（中身は読まない）
 * file_search       Secret ファイルは開きもしない → 一致した行は Mask して返す
 * workspace_status  Workspace 名（絶対パスは出さない）・Permission・Git の状態・
 *                   変更ファイルの相対パス（Git diff は後続の Read Tool。STEP11 候補）
 * ```
 *
 * ## 返すのは伏せた後のものだけ
 *
 * Agent の Context Manager（main/agent/）へ渡る文字列は、**ここで Mask を通した後の
 * もの**だけにする（2026-09-23 確定: Secret Mask 前の情報を Context Manager へ渡さない）。
 * Context へ入れた後、Provider へ送る直前には External Send Gate（STEP5）がもう一度伏せる。
 *
 * ## Audit は拒否だけ
 *
 * 許可した読み取りは記録しない（readToolsAudit.ts）。
 */

/** 1回の file_read で返す行の上限。 */
export const READ_TOOL_MAX_LINES = 400
/** 1回の file_read で返す文字数の上限（伏せた後で数える）。 */
export const READ_TOOL_MAX_EXCERPT_CHARS = 60_000
/** 1行の長さの上限（1行が巨大なファイル・minify 済みの JavaScript）。 */
export const READ_TOOL_MAX_LINE_CHARS = 2_000
/** workspace_list で返す件数の上限。 */
export const READ_TOOL_MAX_LIST_ENTRIES = 300
/** file_search で返す一致の上限。 */
export const READ_TOOL_MAX_SEARCH_MATCHES = 100
/** file_search で1ファイルから返す一致の上限。 */
export const READ_TOOL_MAX_SEARCH_MATCHES_PER_FILE = 10
/** file_search の検索語の上限。 */
export const READ_TOOL_MAX_QUERY_LENGTH = 200
/** workspace_status で返す変更ファイルの上限。 */
export const READ_TOOL_MAX_CHANGED_PATHS = 200

export type FileReadOutcome =
  | {
      readonly ok: true
      readonly workspacePath: string
      /** Context へそのまま入れる1件（`workspace-file`・Boundary の対象付き・伏せた後）。 */
      readonly item: RawExternalContextItem
      readonly excerpt: WorkspaceFileExcerpt
      /** 行数・文字数の上限で、範囲の途中までしか返していないか。 */
      readonly truncated: boolean
    }
  | { readonly ok: false; readonly reason: AuditReason }

export interface WorkspaceListEntry {
  /** 伏せた後の名前。 */
  readonly name: string
  /** 伏せた後の Workspace 相対の位置。 */
  readonly relativePath: string
  readonly type: 'file' | 'directory' | 'other'
  /** Secret ファイル / Secret の置き場所（Agent は読めない）。 */
  readonly secret: boolean
}

export type WorkspaceListOutcome =
  | {
      readonly ok: true
      readonly workspacePath: string
      readonly entries: readonly WorkspaceListEntry[]
      readonly truncated: boolean
    }
  | { readonly ok: false; readonly reason: AuditReason }

export interface WorkspaceSearchMatch {
  readonly relativePath: string
  readonly line: number
  /** 伏せた後の、一致した行（先頭・末尾は切ってある）。 */
  readonly preview: string
}

export type WorkspaceSearchOutcome =
  | {
      readonly ok: true
      readonly matches: readonly WorkspaceSearchMatch[]
      readonly truncated: boolean
      /** Secret ファイルを検索の対象から外したか（外した位置は数えない）。 */
      readonly secretFilesSkipped: true
    }
  | { readonly ok: false; readonly reason: AuditReason }

export interface WorkspaceGitStatus {
  readonly repository:
    'ready' | 'not-a-repository' | 'git-unavailable' | 'nested' | 'no-workspace' | 'failed'
  /** ブランチの名前（detached・不明・リポジトリでないなら `null`）。 */
  readonly branch: string | null
  readonly detached: boolean
  /** 変更のあるファイルの Workspace 相対の位置（伏せた後・名前順・重複なし）。 */
  readonly changedPaths: readonly string[]
  readonly changedPathsTruncated: boolean
}

export type WorkspaceStatusOutcome =
  | {
      readonly ok: true
      /** Workspace の表示名（フォルダ名。**絶対パスは出さない**）。 */
      readonly workspaceName: string
      readonly permissionMode: AgentPermissionMode
      readonly git: WorkspaceGitStatus
    }
  | { readonly ok: false; readonly reason: AuditReason }

/** Gate が使う、Main 側の道具。 */
export interface ReadToolsDependencies {
  /** 今効いている Policy（STEP1）。要求のたびに読み直す。 */
  readonly readPolicy: () => SecurityPolicy
  /** Audit Event を1件記録する（STEP4）。成否は返さない。 */
  readonly recordEvent: (event: AuditEvent) => void
  /** Workspace Boundary（STEP2）で、**読み取りとして**確かめる。 */
  readonly resolveTarget: (relativePath: unknown) => Promise<WorkspaceBoundaryResult>
  /** 確かめたファイルを、確かめたハンドル越しに読む。 */
  readonly readBytes: (target: VerifiedWorkspaceTarget) => Promise<ReadFileBytesResult>
  /** フォルダの1階層を読む（main/files/readWorkspaceDirectory.ts）。 */
  readonly readDirectory: (
    rootPath: string,
    relativePath: string
  ) => Promise<ReadWorkspaceDirectoryOutcome>
  /** 中身で探す（main/files/searchWorkspaceFileContents.ts）。 */
  readonly searchContents: (
    rootPath: string,
    query: string,
    options: WorkspaceContentSearchOptions
  ) => Promise<SearchWorkspaceFileContentsOutcome>
  /** 今の Workspace の表示名（開いていなければ `null`）。 */
  readonly readWorkspaceName: () => string | null
  /** 今の Workspace の Git の状態（main/git/gitRepository.ts）。 */
  readonly readGitRepository: () => Promise<GitRepositoryState>
}

export interface ReadToolsGate {
  readonly readFile: (relativePath: unknown, range?: unknown) => Promise<FileReadOutcome>
  readonly listDirectory: (relativePath: unknown) => Promise<WorkspaceListOutcome>
  readonly search: (query: unknown) => Promise<WorkspaceSearchOutcome>
  readonly describeStatus: () => Promise<WorkspaceStatusOutcome>
}

export function createReadToolsGate(deps: ReadToolsDependencies): ReadToolsGate {
  function record(event: AuditEvent): void {
    try {
      deps.recordEvent(event)
    } catch {
      // 記録できなかったことで allow / deny が変わってはいけない。
    }
  }

  function deny<T extends { readonly ok: false; readonly reason: AuditReason }>(
    tool: ReadToolName,
    reason: AuditReason,
    workspacePath: string | null,
    mode: AgentPermissionMode
  ): T {
    record(readToolDeniedEvent(tool, reason, workspacePath, mode))

    return Object.freeze({ ok: false as const, reason }) as T
  }

  async function readFile(relativePath: unknown, range?: unknown): Promise<FileReadOutcome> {
    const mode = readPolicy(deps).permissionMode

    try {
      return await readFileChecked(relativePath, range)
    } catch {
      return deny('file_read', 'gate-failed', null, mode)
    }
  }

  async function readFileChecked(relativePath: unknown, range: unknown): Promise<FileReadOutcome> {
    const policy = readPolicy(deps)
    const mode = policy.permissionMode
    const lines = readRange(range)

    if (lines === null) {
      return deny('file_read', 'invalid-request', null, mode)
    }

    const resolved = await deps.resolveTarget(relativePath)

    if (!resolved.ok) {
      return deny('file_read', resolved.denial, null, mode)
    }

    const target = resolved.target

    if (!isVerifiedWorkspaceTarget(target) || target.access !== 'read') {
      return deny('file_read', 'invalid-request', null, mode)
    }

    const workspacePath = target.canonicalRelativePath

    if (target.state.kind !== 'file') {
      return deny('file_read', 'not-a-file', workspacePath, mode)
    }

    // Secret ファイル（STEP3）・Workspace の外は、ここで deny（Mask して読むのではない）。
    const decision = decideSecurityAction(policy, {
      kind: 'file.read',
      target: agentFileReadFacts(target)
    })

    if (decision.verdict !== 'allow') {
      return deny('file_read', decision.reason, workspacePath, mode)
    }

    const read = await deps.readBytes(target)

    if (!read.ok) {
      return deny('file_read', read.denial, workspacePath, mode)
    }

    const context = workspaceFileContext(target, read.bytes, lines)

    if (!context.ok) {
      return deny('file_read', fromContextDenial(context.reason), workspacePath, mode)
    }

    const excerpt = context.excerpt

    if (excerpt === undefined) {
      return deny('file_read', 'gate-failed', workspacePath, mode)
    }

    const bounded = boundExcerpt(context.item.text)
    const returned = bounded.cut
      ? Object.freeze({ ...excerpt, endLine: excerpt.startLine + bounded.lineCount - 1 })
      : excerpt

    return Object.freeze({
      ok: true as const,
      workspacePath,
      item: bounded.cut ? Object.freeze({ ...context.item, text: bounded.text }) : context.item,
      excerpt: returned,
      // 頼まれた範囲（ファイルの終わりまで）のうち、返していない行があるか。
      truncated:
        bounded.cut ||
        (returned.totalLines > 0 &&
          returned.endLine < Math.min(lines.requestedEnd, returned.totalLines))
    })
  }

  async function listDirectory(relativePath: unknown): Promise<WorkspaceListOutcome> {
    const mode = readPolicy(deps).permissionMode

    try {
      return await listDirectoryChecked(relativePath)
    } catch {
      return deny('workspace_list', 'gate-failed', null, mode)
    }
  }

  async function listDirectoryChecked(relativePath: unknown): Promise<WorkspaceListOutcome> {
    const policy = readPolicy(deps)
    const mode = policy.permissionMode
    const resolved = await deps.resolveTarget(relativePath ?? '')

    if (!resolved.ok) {
      return deny('workspace_list', resolved.denial, null, mode)
    }

    const target = resolved.target

    if (!isVerifiedWorkspaceTarget(target) || target.access !== 'read') {
      return deny('workspace_list', 'invalid-request', null, mode)
    }

    const workspacePath = target.canonicalRelativePath

    if (target.state.kind !== 'directory') {
      return deny('workspace_list', 'invalid-request', workspacePath, mode)
    }

    /*
      フォルダも STEP1 の読み取りの判定を通す。Secret の置き場所（`.ssh` など）の中は
      一覧も返さない。Workspace root は Secret の置き場所ではない（STEP8 の作業ディレクトリと
      同じ読み方）。
    */
    const secretDirectory = workspacePath === '' ? false : isSecretWorkspaceTarget(target)
    const decision = decideSecurityAction(policy, {
      kind: 'file.read',
      target: fileReadTargetFacts(target, secretDirectory)
    })

    if (decision.verdict !== 'allow') {
      return deny('workspace_list', decision.reason, workspacePath, mode)
    }

    const listed = await deps.readDirectory(target.rootPath, workspacePath)

    if (listed.status !== 'ok') {
      return deny('workspace_list', fromDirectoryStatus(listed.status), workspacePath, mode)
    }

    const entries = listed.entries.slice(0, READ_TOOL_MAX_LIST_ENTRIES).map((entry) =>
      Object.freeze({
        name: redactSecretText(entry.name),
        relativePath: redactSecretText(entry.relativePath),
        type: entryType(entry.type),
        secret: isSecretPath(entry.relativePath)
      })
    )

    return Object.freeze({
      ok: true as const,
      workspacePath,
      entries: Object.freeze(entries),
      truncated: listed.truncated || listed.entries.length > READ_TOOL_MAX_LIST_ENTRIES
    })
  }

  async function search(query: unknown): Promise<WorkspaceSearchOutcome> {
    const mode = readPolicy(deps).permissionMode

    try {
      return await searchChecked(query)
    } catch {
      return deny('file_search', 'gate-failed', null, mode)
    }
  }

  async function searchChecked(query: unknown): Promise<WorkspaceSearchOutcome> {
    const mode = readPolicy(deps).permissionMode

    if (
      typeof query !== 'string' ||
      query.trim().length === 0 ||
      query.length > READ_TOOL_MAX_QUERY_LENGTH
    ) {
      return deny('file_search', 'invalid-request', null, mode)
    }

    // 検索の起点も Boundary で確かめる（Workspace root を Agent から受け取らない）。
    const resolved = await deps.resolveTarget('')

    if (!resolved.ok) {
      return deny('file_search', resolved.denial, null, mode)
    }

    const root = resolved.target

    if (!isVerifiedWorkspaceTarget(root) || root.state.kind !== 'directory') {
      return deny('file_search', 'invalid-request', null, mode)
    }

    const searched = await deps.searchContents(root.rootPath, query, {
      maxMatches: READ_TOOL_MAX_SEARCH_MATCHES,
      maxMatchesPerFile: READ_TOOL_MAX_SEARCH_MATCHES_PER_FILE,
      // Secret ファイル・Secret の置き場所は、開きもしない。
      excludePath: isSecretPath
    })

    if (searched.status !== 'ok') {
      return deny(
        'file_search',
        searched.status === 'invalid-query' ? 'invalid-request' : 'unverifiable',
        null,
        mode
      )
    }

    const matches: WorkspaceSearchMatch[] = []

    for (const file of searched.files) {
      // 検索側が除外を守ったかを、返ってきた位置でもう一度確かめる（二重に見る）。
      if (isSecretPath(file.relativePath)) {
        continue
      }

      for (const match of file.matches) {
        matches.push(
          Object.freeze({
            relativePath: redactSecretText(file.relativePath),
            line: match.line,
            preview: safePreview(match.preview)
          })
        )
      }
    }

    return Object.freeze({
      ok: true as const,
      matches: Object.freeze(matches.slice(0, READ_TOOL_MAX_SEARCH_MATCHES)),
      truncated: searched.truncated || matches.length > READ_TOOL_MAX_SEARCH_MATCHES,
      secretFilesSkipped: true as const
    })
  }

  async function describeStatus(): Promise<WorkspaceStatusOutcome> {
    const mode = readPolicy(deps).permissionMode

    try {
      const name = deps.readWorkspaceName()

      if (name === null) {
        return deny('workspace_status', 'no-workspace', null, mode)
      }

      return Object.freeze({
        ok: true as const,
        workspaceName: redactSecretText(name),
        permissionMode: mode,
        git: await readGitStatus()
      })
    } catch {
      return deny('workspace_status', 'gate-failed', null, mode)
    }
  }

  async function readGitStatus(): Promise<WorkspaceGitStatus> {
    let state: GitRepositoryState

    try {
      state = await deps.readGitRepository()
    } catch {
      return gitStatus('failed')
    }

    if (state.status !== 'ready') {
      return gitStatus(state.status)
    }

    const paths = new Set<string>()

    for (const group of [
      state.changes.staged,
      state.changes.unstaged,
      state.changes.untracked,
      state.changes.conflicted
    ]) {
      for (const change of group) {
        paths.add(redactSecretText(change.relativePath))
      }
    }

    const sorted = [...paths].sort()

    return Object.freeze({
      repository: 'ready' as const,
      branch: state.head.kind === 'branch' ? redactSecretText(state.head.name) : null,
      detached: state.head.kind === 'detached',
      changedPaths: Object.freeze(sorted.slice(0, READ_TOOL_MAX_CHANGED_PATHS)),
      changedPathsTruncated: sorted.length > READ_TOOL_MAX_CHANGED_PATHS
    })
  }

  return Object.freeze({ readFile, listDirectory, search, describeStatus })
}

/**
 * 読む範囲（無ければ先頭から上限まで）。
 *
 * `requestedEnd` は頼まれた最後の行（省いたらファイルの終わり）で、上限で切ったことを
 * `truncated` として Agent へ知らせるために持つ。
 */
function readRange(
  range: unknown
): { readonly startLine: number; readonly endLine: number; readonly requestedEnd: number } | null {
  if (range === undefined || range === null) {
    return { startLine: 1, endLine: READ_TOOL_MAX_LINES, requestedEnd: Number.MAX_SAFE_INTEGER }
  }

  if (typeof range !== 'object') {
    return null
  }

  const { startLine, endLine } = range as {
    readonly startLine?: unknown
    readonly endLine?: unknown
  }
  const start = startLine === undefined ? 1 : startLine

  if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 1) {
    return null
  }

  const requested = endLine === undefined ? Number.MAX_SAFE_INTEGER : endLine

  if (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested < start) {
    return null
  }

  return {
    startLine: start,
    endLine: Math.min(requested, start + READ_TOOL_MAX_LINES - 1),
    requestedEnd: requested
  }
}

/** 伏せた後の本文を、1行と全体の文字数で切る（切るのは必ず伏せた後）。 */
function boundExcerpt(text: string): {
  readonly text: string
  readonly cut: boolean
  readonly lineCount: number
} {
  if (text === '') {
    return { text, cut: false, lineCount: 0 }
  }

  const lines = text.split('\n')
  const kept: string[] = []
  let total = 0
  let cut = false

  for (const line of lines) {
    const bounded =
      line.length > READ_TOOL_MAX_LINE_CHARS ? `${line.slice(0, READ_TOOL_MAX_LINE_CHARS)}…` : line

    cut ||= bounded !== line

    if (total + bounded.length > READ_TOOL_MAX_EXCERPT_CHARS && kept.length > 0) {
      cut = true
      break
    }

    kept.push(bounded)
    total += bounded.length + 1
  }

  return { text: kept.join('\n'), cut, lineCount: kept.length }
}

/** Secret ファイル・Secret の置き場所か（名前だけで決める。STEP3 / STEP8 と同じ読み方）。 */
function isSecretPath(relativePath: string): boolean {
  try {
    return relativePath !== '' && classifySecretPath(relativePath) === 'secret-file'
  } catch {
    return true
  }
}

/**
 * 一致した行を、伏せてから返す。
 *
 * 1行だけを伏せるため、**複数行にまたがる Private Key の本体の行**は `maskSecretText` では
 * 見つからない。Base64 だけでできた長い行は、それだけで伏せる（鍵の本体の形）。
 * 行の中身が要るなら、Agent は file_read で読み直す（全体で探してから行ごとに伏せる）。
 */
function safePreview(preview: string): string {
  const masked = maskSecretText(preview)

  if (masked.truncated || masked.categories.includes('unscanned')) {
    return SECRET_MASK
  }

  return /^[A-Za-z0-9+/=]{40,}$/.test(masked.text.trim()) ? SECRET_MASK : masked.text
}

function entryType(type: string): WorkspaceListEntry['type'] {
  return type === 'file' || type === 'directory' ? type : 'other'
}

function fromDirectoryStatus(status: string): AuditReason {
  switch (status) {
    case 'invalid-path':
      return 'invalid-path'
    case 'outside-workspace':
      return 'outside-workspace'
    case 'not-found':
      return 'not-found'
    case 'not-a-directory':
      return 'invalid-request'
    default:
      return 'unverifiable'
  }
}

function fromContextDenial(reason: ExternalSendDenial): AuditReason {
  switch (reason) {
    case 'unsupported-context':
      return 'unsupported-content'
    case 'context-too-large':
      return 'content-too-large'
    default:
      return reason
  }
}

function gitStatus(repository: WorkspaceGitStatus['repository']): WorkspaceGitStatus {
  return Object.freeze({
    repository,
    branch: null,
    detached: false,
    changedPaths: Object.freeze([]),
    changedPathsTruncated: false
  })
}

/** Policy が読めなければ、最も厳しい Policy として扱う（STEP1 / STEP5〜8 と同じ倒し方）。 */
function readPolicy(deps: ReadToolsDependencies): SecurityPolicy {
  try {
    const policy: unknown = deps.readPolicy()

    if (typeof policy !== 'object' || policy === null) {
      return FAIL_CLOSED_SECURITY_POLICY
    }

    const mode = (policy as { readonly permissionMode?: unknown }).permissionMode

    return isAgentPermissionMode(mode) ? (policy as SecurityPolicy) : FAIL_CLOSED_SECURITY_POLICY
  } catch {
    return FAIL_CLOSED_SECURITY_POLICY
  }
}
