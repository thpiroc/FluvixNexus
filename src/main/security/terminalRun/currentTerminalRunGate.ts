import { randomUUID } from 'crypto'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emitIpcEvent } from '../../ipc/events'
import { currentPlatform } from '../../platform'
import { consumeApproval, requestApproval } from '../approval/currentApprovalManager'
import { recordAuditEvent } from '../audit/currentAuditLog'
import { resolveAgentWorkspaceTarget } from '../boundary/currentWorkspaceBoundary'
import { recheckWorkspaceTarget } from '../boundary/workspaceBoundary'
import { getCurrentSecurityPolicy } from '../policy/currentSecurityPolicy'
import { resolveTerminalExecutable } from './terminalExecutable'
import { buildTerminalLaunch } from './terminalLaunch'
import { createTerminalRunGate, type TerminalRunOutcome } from './terminalRunGate'
import {
  executableExists,
  inspectExecutable,
  isSameExecutable,
  runTerminalProcess
} from './terminalRunIo'

/**
 * 今の Terminal Command Runner（Security Core v1 の STEP8）。
 *
 * **Main の Security Core が持つ、Agent のコマンド実行の唯一の入口。** Policy は Main が
 * 保存から読み直したもの（STEP1）、Workspace root は Main が持つ正本（STEP2）、
 * 承認は Main の Approval Manager（STEP6）、記録先は Main の Audit Log（STEP4）、
 * PATH と環境変数は Main の process のもので、**どれも引数では差し替えられない** ──
 * 差し替えられる形（`createTerminalRunGate`）はこの folder の中だけにあり、
 * 入口（index.ts）からは公開しない。
 *
 * ## 使い方（将来の Agent Loop から）
 *
 * ```ts
 * const outcome = await runAgentTerminalCommand({ command: 'npm', args: ['test'], cwd: '' })
 *
 * if (outcome.ok) {
 *   // outcome.exitCode / outcome.output.text（Secret を伏せた後の出力）
 * } else {
 *   // outcome.reason は Audit へ載る語（'read-only-mode' / 'user-cancelled' …）
 * }
 * ```
 *
 * 受け取るのは **command / args / cwd の3つだけ。** 「確認済み」「安全」「承認済み」に
 * あたる欄は無く、実行ファイルの絶対パス・shell・環境変数を渡す口も無い。
 *
 * ## Renderer から呼べない
 *
 * この関数は IPC にも Preload にも出さない（terminalRunSurface.test.ts が見ている）。
 * Renderer へ出るのは、Main が送る提案の知らせ（`agent-terminal:proposed` /
 * `agent-terminal:settled`）と、STEP6 の承認の意思表示だけ。
 */

const gate = createTerminalRunGate({
  platform: currentPlatform,
  readPolicy: getCurrentSecurityPolicy,
  recordEvent: recordAuditEvent,
  resolveCwd: (relativePath) => resolveAgentWorkspaceTarget(relativePath, 'read'),
  recheckCwd: (target) => recheckWorkspaceTarget(target),
  resolveExecutable: (command, workspaceRoots) =>
    resolveTerminalExecutable(command, {
      platform: currentPlatform,
      env: process.env,
      exists: executableExists,
      workspaceRoots
    }),
  inspectExecutable,
  isSameExecutable,
  buildLaunch: (executable, args) => buildTerminalLaunch(executable, args, process.env),
  runProcess: (spec, cwd) => runTerminalProcess(spec, cwd),
  requestApproval,
  consumeApproval,
  notifyProposed: (notice) => emitIpcEvent(IPC_EVENT_CHANNELS.AGENT_TERMINAL_PROPOSED, notice),
  notifySettled: (proposalId, result) =>
    emitIpcEvent(IPC_EVENT_CHANNELS.AGENT_TERMINAL_SETTLED, { proposalId, result }),
  createProposalId: () => randomUUID()
})

/** コマンドを1つ、承認を通してから実行する。 */
export function runAgentTerminalCommand(request: unknown): Promise<TerminalRunOutcome> {
  return gate.run(request)
}
