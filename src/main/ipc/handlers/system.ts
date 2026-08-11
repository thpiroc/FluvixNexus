import { app } from 'electron'
import { IPC_CHANNELS, type AppInfoResponse, type PingResponse } from '@shared/ipc'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * system ドメインのハンドラ。
 *
 * IPC 基盤が Main → Preload → Renderer まで通っていることを確認するための最小実装であり、
 * Files / Terminal / GitHub のハンドラを追加する際の雛形も兼ねる。
 *
 * 各ドメインのファイルは次の形を守ること。
 *  - export するのは register<Domain>Handlers() の1つだけ
 *  - ハンドラ本体は成功時の値を return するだけにする
 *  - 想定内の失敗は IpcError（invalidRequest など）を throw する
 *  - IpcResult を自分で組み立てない（registry の責務）
 */
export function registerSystemHandlers(): void {
  handleIpc(IPC_CHANNELS.SYSTEM_PING, (request): PingResponse => {
    // リクエストの検証はハンドラの入口で行い、不正は IpcError として表明する。
    if (typeof request?.token !== 'string' || request.token.length === 0) {
      throw invalidRequest('ping requires a non-empty token.')
    }

    return {
      token: request.token,
      receivedAt: Date.now()
    }
  })

  handleIpc(IPC_CHANNELS.SYSTEM_APP_INFO, (): AppInfoResponse => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      locale: app.getLocale(),
      isDevelopment: !app.isPackaged
    }
  })
}
