import { randomUUID } from 'crypto'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emitIpcEvent } from '../../ipc/events'
import { consumeApproval, requestApproval } from '../approval/currentApprovalManager'
import { resolveAgentWorkspaceTarget } from '../boundary/currentWorkspaceBoundary'
import { recheckWorkspaceTarget } from '../boundary/workspaceBoundary'
import { recordAuditEvent } from '../audit/currentAuditLog'
import { getCurrentSecurityPolicy } from '../policy/currentSecurityPolicy'
import { acquireSideEffect } from '../sideEffect/currentSideEffectLock'
import { createFileWriteGate, type FileWriteOutcome } from './fileWriteGate'
import { readCurrentFile, writeConfirmedFile } from './fileWriteIo'

/**
 * 今の File Write Gate（Security Core v1 の STEP7）。
 *
 * **Main の Security Core が持つ、Agent の書き込みの唯一の入口。** Policy は Main が
 * 保存から読み直したもの（STEP1）、Workspace root は Main が持つ正本（STEP2）、
 * 承認は Main の Approval Manager（STEP6）、記録先は Main の Audit Log（STEP4）で、
 * **どれも引数では差し替えられない** ── 差し替えられる形（`createFileWriteGate`）は
 * この folder の中だけにあり、入口（index.ts）からは公開しない。
 *
 * ## 使い方（将来の Agent Loop から）
 *
 * ```ts
 * const outcome = await writeAgentWorkspaceFile('src/app.ts', nextContent)
 *
 * if (!outcome.ok) {
 *   // outcome.reason は Audit へ載る語（'read-only-mode' / 'user-cancelled' …）
 * }
 * ```
 *
 * 受け取るのは**相対 Path の綴りと本文の2つだけ。** 「確認済み」「安全」「承認済み」に
 * あたる引数は無く、絶対パス・ハンドル・fingerprint を渡す口も無い。
 *
 * ## Renderer から呼べない
 *
 * この関数は IPC にも Preload にも出さない（fileWriteSurface.test.ts が見ている）。
 * Renderer へ出るのは、Main が送る提案の知らせ（`agent-file-write:proposed` /
 * `agent-file-write:settled`）と、STEP6 の承認の意思表示だけ。
 */

const gate = createFileWriteGate({
  readPolicy: getCurrentSecurityPolicy,
  recordEvent: recordAuditEvent,
  resolveTarget: (relativePath) => resolveAgentWorkspaceTarget(relativePath, 'write'),
  recheckTarget: (target) => recheckWorkspaceTarget(target),
  readCurrent: readCurrentFile,
  writeFile: writeConfirmedFile,
  requestApproval,
  consumeApproval,
  notifyProposed: (notice) => emitIpcEvent(IPC_EVENT_CHANNELS.AGENT_FILE_WRITE_PROPOSED, notice),
  notifySettled: (proposalId) =>
    emitIpcEvent(IPC_EVENT_CHANNELS.AGENT_FILE_WRITE_SETTLED, { proposalId }),
  createProposalId: () => randomUUID(),
  // Terminal（STEP8）と同じロック。副作用のある操作は種類をまたいで同時に1件だけ（STEP9）。
  acquireSideEffect
})

/** Workspace の中のファイル1件を、承認を通してから書き換える。 */
export function writeAgentWorkspaceFile(
  relativePath: unknown,
  content: unknown
): Promise<FileWriteOutcome> {
  return gate.write(relativePath, content)
}
