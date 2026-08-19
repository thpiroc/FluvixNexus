import type { IpcErrorCode, IpcErrorPayload, IpcResult } from '@shared/ipc'

/**
 * Renderer 側での IPC 結果の扱い方。
 *
 * IPC は例外を投げず必ず IpcResult を返すため、呼び出し側には2つの選択肢がある。
 *  A. result.ok を見て分岐する  … 失敗を UI として表示したい箇所（通常はこちら）
 *  B. unwrapIpcResult で例外にする … 失敗を上位のエラーバウンダリに任せたい箇所
 *
 * 例外クラスを Renderer 側に置いているのは、contextBridge を越えると
 * class インスタンスが素のオブジェクトに落ちてしまうため。
 * 境界を越えるのは素の IpcResult、例外化するのは境界を越えたあと、という分担にする。
 */

/** IpcResult の失敗を例外として扱いたい場合に使う。 */
export class IpcCallError extends Error {
  readonly code: IpcErrorCode
  readonly detail: string | undefined

  constructor(error: IpcErrorPayload) {
    super(error.message)
    this.name = 'IpcCallError'
    this.code = error.code
    this.detail = error.detail
  }
}

/** 成功なら値を取り出し、失敗なら IpcCallError を投げる。 */
export function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok) {
    return result.data
  }

  throw new IpcCallError(result.error)
}

/**
 * エラーコードから利用者向けの文言を作る。
 *
 * Main から来る message は開発者向けのため、UI にはそのまま出さない。
 * 表示文言の決定は Renderer の責務とし、対応表をここに集約する。
 */
const MESSAGE_BY_CODE: Record<IpcErrorCode, string> = {
  INVALID_REQUEST: '入力内容が正しくありません。',
  NOT_FOUND: '対象が見つかりませんでした。',
  CONFLICT: '対象の現在の状態と競合しています。',
  BUSY: '対象が他のアプリで使用されている可能性があります。閉じてからもう一度お試しください。',
  PERMISSION_DENIED: 'この操作は許可されていません。',
  UNSUPPORTED: 'この環境では実行できません。',
  CANCELLED: '操作は中断されました。',
  CHANNEL_UNAVAILABLE: 'アプリ内部の通信に失敗しました。再起動をお試しください。',
  INTERNAL: '予期しないエラーが発生しました。'
}

export function describeIpcError(error: IpcErrorPayload): string {
  return MESSAGE_BY_CODE[error.code]
}
