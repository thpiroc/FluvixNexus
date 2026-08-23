import { registerFilesHandlers } from './handlers/files'
import { registerGitHandlers } from './handlers/git'
import { registerSettingsHandlers } from './handlers/settings'
import { registerSystemHandlers } from './handlers/system'
import { registerTerminalHandlers } from './handlers/terminal'
import { registerWindowHandlers } from './handlers/window'
import { registerWorkspaceHandlers } from './handlers/workspace'
import { registerWorkspaceFolderHandlers } from './handlers/workspaceFolder'

/**
 * Main 側の IPC ハンドラ登録の入り口。
 *
 * Main が IPC を受け付ける唯一の場所。ドメインごとに handlers/<domain>.ts を作り、
 * その register<Domain>Handlers をこのリストへ追加していく。
 * Files / Terminal / GitHub を実装する際も、この構造を維持すること。
 */
const handlerRegistrations: readonly (() => void)[] = [
  registerSystemHandlers,
  registerWindowHandlers,
  registerWorkspaceHandlers,
  registerWorkspaceFolderHandlers,
  registerFilesHandlers,
  registerSettingsHandlers,
  registerTerminalHandlers,
  registerGitHandlers
]

export function registerIpcHandlers(): void {
  for (const register of handlerRegistrations) {
    register()
  }
}

export { IpcError, invalidRequest } from './errors'
export { emitIpcEvent } from './events'
export { handleIpc, resetIpcHandlers, type IpcContext, type IpcHandler } from './registry'
