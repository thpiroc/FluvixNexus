import type { AuditReason } from '../security/audit'
import type { FileWriteOutcome } from '../security/fileWrite'
import type {
  FileReadOutcome,
  WorkspaceListOutcome,
  WorkspaceSearchOutcome,
  WorkspaceStatusOutcome
} from '../security/readTools'
import type { SafeTerminalOutput, TerminalRunOutcome } from '../security/terminalRun'
import type { AgentAction } from './agentAction'
import type { AgentContextInput } from './agentContext'

/**
 * Action を Security Core の入口へつなぐ（Security Core v1 の STEP9。Electron にも fs にも
 * 依存しない ── 入口はすべて引数で受け取る）。
 *
 * ```
 * workspace_status  → describeAgentWorkspaceStatus   （Read Tool Gate）
 * workspace_list    → listAgentWorkspaceDirectory    （Read Tool Gate）
 * file_read         → readAgentWorkspaceFile         （Read Tool Gate）
 * file_search       → searchAgentWorkspace           （Read Tool Gate）
 * file_write        → writeAgentWorkspaceFile        （STEP7 File Write Gate・二段階承認）
 * terminal_run      → runAgentTerminalCommand        （STEP8 Terminal Command Runner・二段階承認）
 * ```
 *
 * **ここは Gate を選ぶだけで、Gate を飛ばす分岐は無い。** 各入口は「確認済み」「承認済み」に
 * あたる引数を持たず、渡すのは Action の欄だけ。
 *
 * 返すのは Context Manager へ入れる形（伏せた後の文字列）と、再試行の扱いを決めるための
 * 結末（ok / denied / failed ＋ 理由）。
 */

/** Security Core の入口（currentAgentLoop.ts が本物をつなぐ。テストは差し替える）。 */
export interface AgentToolbox {
  readonly describeStatus: () => Promise<WorkspaceStatusOutcome>
  readonly listDirectory: (relativePath: unknown) => Promise<WorkspaceListOutcome>
  readonly readFile: (relativePath: unknown, range?: unknown) => Promise<FileReadOutcome>
  readonly search: (query: unknown) => Promise<WorkspaceSearchOutcome>
  /** `signal` は作業の signal。止まった後は新しい承認を作らず、書かない。 */
  readonly writeFile: (
    relativePath: unknown,
    content: unknown,
    signal?: AbortSignal
  ) => Promise<FileWriteOutcome>
  /** `signal` は作業の signal。止まった後は新しい承認を作らず、起動しない。 */
  readonly runCommand: (request: unknown, signal?: AbortSignal) => Promise<TerminalRunOutcome>
}

/** Tool 1回の結末。 */
export interface AgentToolResult {
  readonly status: 'ok' | 'denied' | 'failed'
  /** 失敗・拒否の理由（Audit と同じ語）。成功なら `null`。 */
  readonly reason: AuditReason | null
  /** Context へ入れる形。 */
  readonly context: AgentContextInput
}

/** Terminal の要約に残す行の上限。 */
export const AGENT_TERMINAL_TAIL_LINES = 60
/** Terminal の要約に拾う、エラー・警告らしい行の上限。 */
export const AGENT_TERMINAL_NOTABLE_LINES = 20
/** Terminal の要約の1行の上限。 */
export const AGENT_TERMINAL_LINE_MAX_CHARS = 300

/**
 * Action を1つ実行する。
 *
 * `signal` は作業の signal（停止・Workspace の切り替えで abort される）。副作用のある
 * File Write / Terminal へだけ渡す ── Gate と Approval Manager が、止まった後に新しい承認・
 * 新しい副作用を始めないために見る（2026-09-24 の修正）。Read 系は読むだけで承認も無いため渡さない。
 */
export async function runAgentTool(
  toolbox: AgentToolbox,
  action: Exclude<AgentAction, { readonly type: 'complete' }>,
  signal?: AbortSignal
): Promise<AgentToolResult> {
  switch (action.type) {
    case 'workspace_status':
      return statusResult(await toolbox.describeStatus())

    case 'workspace_list':
      return listResult(action.path, await toolbox.listDirectory(action.path))

    case 'file_read':
      return readResult(
        action.path,
        await toolbox.readFile(
          action.path,
          action.startLine === null && action.endLine === null
            ? undefined
            : {
                ...(action.startLine === null ? {} : { startLine: action.startLine }),
                ...(action.endLine === null ? {} : { endLine: action.endLine })
              }
        )
      )

    case 'file_search':
      return searchResult(action.query, await toolbox.search(action.query))

    case 'file_write':
      return writeResult(
        action.path,
        action.content,
        await toolbox.writeFile(action.path, action.content, signal)
      )

    case 'terminal_run':
      return terminalResult(
        action,
        await toolbox.runCommand(
          { command: action.command, args: action.args, cwd: action.cwd },
          signal
        )
      )
  }
}

function statusResult(outcome: WorkspaceStatusOutcome): AgentToolResult {
  if (!outcome.ok) {
    return denied('workspace_status', '', outcome.reason)
  }

  const { git } = outcome
  const lines = [
    `workspace: ${outcome.workspaceName}`,
    `permission: ${outcome.permissionMode}`,
    `git: ${git.repository}`,
    ...(git.repository === 'ready'
      ? [
          `branch: ${git.branch ?? (git.detached ? '(detached HEAD)' : '(unknown)')}`,
          `changed files (${git.changedPaths.length}${git.changedPathsTruncated ? '+' : ''}):`,
          ...git.changedPaths.map((path) => `  ${path}`)
        ]
      : [])
  ]

  return {
    status: 'ok',
    reason: null,
    context: {
      category: 'status',
      label: 'workspace_status',
      header: 'action: workspace_status\nstatus: ok',
      detail: lines.join('\n'),
      key: 'workspace_status'
    }
  }
}

function listResult(path: string, outcome: WorkspaceListOutcome): AgentToolResult {
  if (!outcome.ok) {
    return denied('workspace_list', path, outcome.reason)
  }

  const lines = outcome.entries.map(
    (entry) =>
      `${entry.type === 'directory' ? 'dir ' : entry.type === 'file' ? 'file' : 'other'} ${entry.relativePath}${entry.secret ? '  (secret: not readable)' : ''}`
  )

  return {
    status: 'ok',
    reason: null,
    context: {
      category: 'list',
      label: `workspace_list ${outcome.workspacePath || '(root)'}`,
      header: `action: workspace_list\ntarget: ${outcome.workspacePath || '(root)'}\nstatus: ok`,
      detail: [
        ...(lines.length === 0 ? ['(empty folder)'] : lines),
        ...(outcome.truncated ? ['…(more entries not shown)'] : [])
      ].join('\n'),
      key: `workspace_list:${outcome.workspacePath}`
    }
  }
}

function readResult(path: string, outcome: FileReadOutcome): AgentToolResult {
  if (!outcome.ok) {
    return denied('file_read', path, outcome.reason)
  }

  const { excerpt } = outcome
  const range =
    excerpt.totalLines === 0
      ? 'empty file'
      : excerpt.startLine === 0
        ? `no lines in range (file has ${excerpt.totalLines} lines)`
        : `lines ${excerpt.startLine}-${excerpt.endLine} of ${excerpt.totalLines}`

  return {
    status: 'ok',
    reason: null,
    context: {
      category: 'read',
      label: `file_read ${outcome.workspacePath}`,
      header: [
        'action: file_read',
        `target: ${outcome.workspacePath}`,
        'status: ok',
        `range: ${range}${outcome.truncated ? ' (more lines exist; read the next range)' : ''}`,
        ...(excerpt.secretMasked ? ['note: values that look like secrets are masked'] : [])
      ].join('\n'),
      detail: '',
      file: outcome.item,
      key: `file:${outcome.workspacePath}`
    }
  }
}

function searchResult(query: string, outcome: WorkspaceSearchOutcome): AgentToolResult {
  if (!outcome.ok) {
    return denied('file_search', query, outcome.reason)
  }

  const lines = outcome.matches.map(
    (match) => `${match.relativePath}:${match.line}: ${match.preview}`
  )

  return {
    status: 'ok',
    reason: null,
    context: {
      category: 'search',
      label: 'file_search',
      header: [
        'action: file_search',
        `query: ${query}`,
        'status: ok',
        `matches: ${outcome.matches.length}${outcome.truncated ? '+ (truncated)' : ''}`,
        'note: secret files are not searched',
        // 位置も理由も出さない（STEP9.1。確かめられなかったものは読んでいない）。
        ...(outcome.unverifiedExcludedCount > 0
          ? [
              'note: some files were excluded from the search because they changed or could not be verified as safe'
            ]
          : [])
      ].join('\n'),
      detail: lines.length === 0 ? '(no matches)' : lines.join('\n'),
      key: `file_search:${query}`
    }
  }
}

function writeResult(path: string, content: string, outcome: FileWriteOutcome): AgentToolResult {
  if (!outcome.ok) {
    return denied('file_write', path, outcome.reason)
  }

  return {
    status: 'ok',
    reason: null,
    context: {
      category: 'write',
      label: `file_write ${outcome.workspacePath}`,
      header: [
        'action: file_write',
        `target: ${outcome.workspacePath}`,
        'status: ok',
        'note: the user approved and the file was written'
      ].join('\n'),
      detail: `wrote ${content.length} characters`,
      key: `file:${outcome.workspacePath}`
    }
  }
}

function terminalResult(
  action: Extract<AgentAction, { readonly type: 'terminal_run' }>,
  outcome: TerminalRunOutcome
): AgentToolResult {
  const commandLine = [action.command, ...action.args].join(' ')
  const target = `${commandLine} (cwd: ${action.cwd === '' ? '(root)' : action.cwd})`

  if (!outcome.ok) {
    const result = denied('terminal_run', target, outcome.reason, `terminal:${commandLine}`)

    // 時間切れのときは、それまでの出力（伏せた後）を添える。
    return outcome.output === null
      ? result
      : {
          ...result,
          context: {
            ...result.context,
            detail: `${result.context.detail}\n${digest(outcome.output)}`
          }
        }
  }

  return {
    status: 'ok',
    reason: null,
    context: {
      category: 'terminal',
      label: `terminal_run ${action.command}`,
      header: [
        'action: terminal_run',
        `target: ${target}`,
        'status: ok',
        `exit code: ${outcome.exitCode ?? 'unknown'}`,
        'note: the user approved and the command ran'
      ].join('\n'),
      detail: digest(outcome.output),
      key: `terminal:${commandLine}`
    }
  }
}

/**
 * Terminal の出力を、AI へ渡す分だけにする（最大 1,000,000 文字をそのまま送らない）。
 *
 * 受け取るのは STEP8 が**伏せた後**の全文。切るのは必ずその後になる。
 * 残すのは「エラー・警告らしい行（先頭から）」と「末尾の行」で、どちらも1行を切る。
 */
export function digest(output: SafeTerminalOutput): string {
  if (output.withheld) {
    return 'output: (withheld — it could not be checked for secrets)'
  }

  const lines = output.text.replace(/\r\n/g, '\n').split('\n')

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  const cut = (line: string): string =>
    line.length > AGENT_TERMINAL_LINE_MAX_CHARS
      ? `${line.slice(0, AGENT_TERMINAL_LINE_MAX_CHARS)}…`
      : line

  const tailStart = Math.max(0, lines.length - AGENT_TERMINAL_TAIL_LINES)
  const notable = lines
    .slice(0, tailStart)
    .filter((line) => /\b(error|warn(ing)?|fail(ed|ure)?|exception)\b|✖|✗/i.test(line))
    .slice(0, AGENT_TERMINAL_NOTABLE_LINES)
    .map(cut)
  const tail = lines.slice(tailStart).map(cut)

  return [
    `output: ${lines.length} lines${output.truncated ? ' (collection limit reached)' : ''}${output.secretMasked ? ', secrets masked' : ''}`,
    ...(notable.length > 0
      ? ['notable lines (errors / warnings before the tail):', ...notable]
      : []),
    ...(tailStart > 0 ? [`last ${tail.length} lines:`] : []),
    ...(tail.length > 0 ? tail : ['(no output)'])
  ].join('\n')
}

/** 拒否・失敗を Context の形へ。AI が次にどうすべきかを1行添える。 */
function denied(
  action: string,
  target: string,
  reason: AuditReason,
  key: string = action === 'file_read' || action === 'file_write'
    ? `file:${target}`
    : `${action}:${target}`
): AgentToolResult {
  const kind = retryClassOf(reason)
  const status = kind === 'retryable' ? 'failed' : 'denied'
  const advice =
    kind === 'blocked'
      ? 'Do not propose this same action again.'
      : kind === 'refresh'
        ? 'The target changed. Read it again and make a new proposal.'
        : 'This may be temporary. You may try again (at most 2 times).'

  return {
    status,
    reason,
    context: {
      category: 'error',
      label: `${action} ${target}`.trim(),
      header: [
        `action: ${action}`,
        ...(target === '' ? [] : [`target: ${target}`]),
        `status: ${status}`,
        `reason: ${reason}`
      ].join('\n'),
      detail: `advice: ${advice}`,
      key
    }
  }
}

/**
 * 理由ごとの再試行の扱い（2026-09-23 確定）。
 *
 * ```
 * blocked    利用者の拒否・Security Core の deny・Boundary / Secret の違反
 *            → 同じ Action を二度と実行しない（repeated-action）
 * refresh    ファイルの競合・対象の変化 → 読み直して新しい提案を作る
 * retryable  一時的な失敗 → 同じ Action を最大2回まで
 * ```
 *
 * **知らない理由は blocked**（再試行を許す側へ倒さない）。
 */
export type AgentRetryClass = 'blocked' | 'refresh' | 'retryable'

const RETRYABLE: ReadonlySet<AuditReason> = new Set<AuditReason>([
  'open-failed',
  'write-failed',
  'spawn-failed',
  'gate-failed',
  'window-unavailable',
  'dialog-failed',
  'write-in-progress',
  'run-in-progress',
  'side-effect-in-progress',
  'handle-unconfirmed',
  'unverifiable',
  'not-found',
  'no-workspace',
  'timed-out',
  'approval-not-found',
  'approval-state-invalid'
])

const REFRESH: ReadonlySet<AuditReason> = new Set<AuditReason>([
  'existing-file-changed',
  'target-changed',
  'target-exists',
  'executable-changed'
])

export function retryClassOf(reason: AuditReason | null): AgentRetryClass {
  if (reason === null) {
    return 'retryable'
  }

  if (REFRESH.has(reason)) {
    return 'refresh'
  }

  return RETRYABLE.has(reason) ? 'retryable' : 'blocked'
}
