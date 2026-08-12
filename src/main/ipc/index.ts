import { registerSystemHandlers } from './handlers/system'
import { registerWorkspaceHandlers } from './handlers/workspace'

/**
 * Main 側の IPC ハンドラ登録の入り口。
 *
 * Main が IPC を受け付ける唯一の場所。ドメインごとに handlers/<domain>.ts を作り、
 * その register<Domain>Handlers をこのリストへ追加していく。
 * Files / Terminal / GitHub を実装する際も、この構造を維持すること。
 */
const handlerRegistrations: readonly (() => void)[] = [
  registerSystemHandlers,
  registerWorkspaceHandlers
  // registerFilesHandlers,    ← STEP 3 で追加
  // registerTerminalHandlers,
  // registerGitHubHandlers,
]

export function registerIpcHandlers(): void {
  for (const register of handlerRegistrations) {
    register()
  }
}

export { IpcError, invalidRequest } from './errors'
export { handleIpc, resetIpcHandlers, type IpcContext, type IpcHandler } from './registry'
