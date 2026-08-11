import { ipcRenderer } from 'electron'
import {
  ipcFailure,
  type IpcChannel,
  type IpcInvokeArgs,
  type IpcResponse,
  type IpcResult
} from '@shared/ipc'

/**
 * Preload から Main を呼ぶ唯一の経路。
 *
 * ipcRenderer をそのまま Renderer へ渡すと任意チャンネルへ送信できてしまうため、
 * contextBridge で公開するのはこの invoke を包んだドメイン API だけにする。
 * ここが「Renderer は契約に定義されたチャンネルしか呼べない」という制約の実体になる。
 *
 * 呼び出しは常に IpcResult を返し、例外を Renderer へ投げない。
 * Main が落ちている・ハンドラ未登録といった基盤側の失敗も IpcResult の失敗形へ正規化する。
 */
export async function invokeIpc<C extends IpcChannel>(
  channel: C,
  ...args: IpcInvokeArgs<C>
): Promise<IpcResult<IpcResponse<C>>> {
  try {
    const result: unknown = await ipcRenderer.invoke(channel, ...args)

    // Main 側は registry を通る限り必ず IpcResult を返す。
    // 形が違う場合は基盤の不整合なので、握り潰さず失敗として扱う。
    if (!isIpcResult(result)) {
      return ipcFailure({
        code: 'INTERNAL',
        message: `Malformed IPC response from "${channel}".`
      })
    }

    return result as IpcResult<IpcResponse<C>>
  } catch (cause) {
    return ipcFailure(toTransportError(channel, cause))
  }
}

function isIpcResult(value: unknown): value is IpcResult<unknown> {
  return typeof value === 'object' && value !== null && 'ok' in value
}

/**
 * IPC の経路自体が失敗した場合の分類。
 * ハンドラ未登録は実装漏れなので、想定外の INTERNAL とは分けて扱う。
 */
function toTransportError(
  channel: string,
  cause: unknown
): {
  code: 'CHANNEL_UNAVAILABLE' | 'INTERNAL'
  message: string
  detail: string
} {
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
  const isMissingHandler = detail.includes('No handler registered')

  return {
    code: isMissingHandler ? 'CHANNEL_UNAVAILABLE' : 'INTERNAL',
    message: isMissingHandler
      ? `No main-process handler is registered for "${channel}".`
      : `IPC call to "${channel}" failed.`,
    detail
  }
}
