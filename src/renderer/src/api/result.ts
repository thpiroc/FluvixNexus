import type { IpcErrorCode, IpcErrorPayload, IpcResult } from '@shared/ipc'
import type { TFunction, TranslationKey } from '../i18n/messages'

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
 *
 * 文言そのものではなく**翻訳キーの対応表**を持ち、`t` は呼び出し側から受け取る
 * （Session 4-5A の workspace/panels/panelLabels.ts と同じ形）。
 * 既定の言語を内側に持たないのは、`t` の渡し忘れが「English でも日本語が出る」
 * という**画面にしか現れない不具合**になるため ── 必須引数なら型が教えてくれる。
 */
const MESSAGE_KEY_BY_CODE = {
  INVALID_REQUEST: 'common.ipcError.invalidRequest',
  NOT_FOUND: 'common.ipcError.notFound',
  CONFLICT: 'common.ipcError.conflict',
  BUSY: 'common.ipcError.busy',
  PERMISSION_DENIED: 'common.ipcError.permissionDenied',
  UNSUPPORTED: 'common.ipcError.unsupported',
  CANCELLED: 'common.ipcError.cancelled',
  CHANNEL_UNAVAILABLE: 'common.ipcError.channelUnavailable',
  INTERNAL: 'common.ipcError.internal'
} as const satisfies Record<IpcErrorCode, TranslationKey>

export function describeIpcError(error: IpcErrorPayload, t: TFunction): string {
  return t(MESSAGE_KEY_BY_CODE[error.code])
}
