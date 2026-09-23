import type { AgentTaskContinueDecision, AgentTaskStartResult, AgentTaskState } from '@shared/agent'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { isDevelopment } from '../app/runtime'
import { emitIpcEvent } from '../ipc/events'
import { cancelPendingApprovals } from '../security/approval'
import { recordAuditEvent } from '../security/audit'
import { sendThroughExternalGate } from '../security/externalSend'
import { writeAgentWorkspaceFile } from '../security/fileWrite'
import { getCurrentSecurityPolicy, isFnAgentEnabled } from '../security/policy'
import {
  describeAgentWorkspaceStatus,
  listAgentWorkspaceDirectory,
  readAgentWorkspaceFile,
  searchAgentWorkspace
} from '../security/readTools'
import { isSideEffectInProgress } from '../security/sideEffect'
import { runAgentTerminalCommand } from '../security/terminalRun'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../workspaceFolder/currentWorkspaceFolder'
import { createAgentLoop } from './agentLoop'
import { createScriptedProvider } from './scriptedProvider'

/**
 * 今の Agent Loop（Security Core v1 の STEP9）。
 *
 * **Main の process に1つだけ。** Agent Loop が使う道具はすべて Main の Security Core の
 * 入口で、どれも引数では差し替えられない（差し替えられる形 `createAgentLoop` は
 * agentLoop.ts にあり、Renderer からは届かない）。
 *
 * ```
 * Provider へ送る      sendThroughExternalGate（STEP5）
 * 読み取り             Read Tool Gate（STEP9。readTools/）
 * 書き込み             writeAgentWorkspaceFile（STEP7）
 * コマンド             runAgentTerminalCommand（STEP8）
 * 副作用ロック         isSideEffectInProgress（STEP9。sideEffect/）
 * 停止                 cancelPendingApprovals（STEP6 に STEP9 で足した取り消し）
 * ON / OFF・Permission Main が設定から毎回読み直す（STEP1 / STEP9）
 * ```
 *
 * ## Provider（STEP9）
 *
 * **開発ビルドだけ**、Scripted Provider（scriptedProvider.ts）を使う。配布ビルドには
 * Provider が無く、作業は `provider-unavailable` で始まらない。実 Provider と
 * Credential Store は STEP10。
 *
 * ## Workspace が変わったら止める
 *
 * 作業は始めたときの Workspace のもの。切り替え・閉じる、のどちらでも止める
 * （次の Action を別のフォルダで実行しない）。承認待ちも取り消す。
 */

const loop = createAgentLoop({
  createProvider: () => (isDevelopment ? createScriptedProvider() : null),
  isProviderAvailable: () => isDevelopment,
  isAgentEnabled: isFnAgentEnabled,
  hasWorkspace: () => getCurrentWorkspaceFolder() !== null,
  readPermissionMode: () => getCurrentSecurityPolicy().permissionMode,
  sendToProvider: (request, deliver) => sendThroughExternalGate(request, deliver),
  toolbox: {
    describeStatus: describeAgentWorkspaceStatus,
    listDirectory: listAgentWorkspaceDirectory,
    readFile: readAgentWorkspaceFile,
    search: searchAgentWorkspace,
    writeFile: writeAgentWorkspaceFile,
    runCommand: runAgentTerminalCommand
  },
  isSideEffectInProgress,
  cancelPendingApprovals,
  recordEvent: recordAuditEvent,
  emitState: (state) => emitIpcEvent(IPC_EVENT_CHANNELS.AGENT_TASK_STATE_CHANGED, state)
})

/** 利用者の指示で作業を始める（IPC の handler から）。 */
export function startAgentTask(prompt: unknown): AgentTaskStartResult {
  return loop.start(prompt)
}

/** 利用者の停止（IPC の handler から）。 */
export function stopAgentTask(): void {
  loop.stop()
}

/** Loop の上限での利用者の返事（IPC の handler から）。 */
export function continueAgentTask(decision: AgentTaskContinueDecision | unknown): void {
  loop.continueTask(decision)
}

export function getAgentTaskState(): AgentTaskState {
  return loop.getState()
}

/** Workspace の切り替えで、動いている作業を止める（起動時に1度だけ張る）。 */
export function startAgentTaskHosting(): void {
  onWorkspaceFolderChange(() => {
    loop.halt('workspace-changed')
  })
}
