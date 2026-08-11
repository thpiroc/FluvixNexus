import type { IpcErrorCode, IpcErrorPayload } from '@shared/ipc'

/**
 * Main 側のハンドラが「想定内の失敗」を表明するための例外。
 *
 * ハンドラは IpcResult を自分で組み立てず、失敗時はこの例外を throw する。
 * registry がこれを捕捉して IpcResult の失敗形へ変換するため、
 * ハンドラ本体は「成功したら値を return する」だけの素直なコードに保てる。
 *
 * この例外が IPC 境界を越えることはない（registry が必ず捕捉する）。
 */
export class IpcError extends Error {
  readonly code: IpcErrorCode
  readonly detail: string | undefined

  constructor(code: IpcErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'IpcError'
    this.code = code
    this.detail = detail
  }
}

/** リクエスト内容が不正なときの定型。バリデーション失敗はこれで表明する。 */
export function invalidRequest(message: string, detail?: string): IpcError {
  return new IpcError('INVALID_REQUEST', message, detail)
}

/**
 * ハンドラから飛んできた任意の値を、Renderer へ渡せる形へ正規化する。
 *
 * IpcError 以外（想定外の例外）は INTERNAL に丸める。
 * 内部の詳細は detail に留め、message は呼び出し側が扱いやすい粒度に保つ。
 */
export function toIpcErrorPayload(cause: unknown): IpcErrorPayload {
  if (cause instanceof IpcError) {
    return cause.detail === undefined
      ? { code: cause.code, message: cause.message }
      : { code: cause.code, message: cause.message, detail: cause.detail }
  }

  if (cause instanceof Error) {
    return {
      code: 'INTERNAL',
      message: 'Unexpected error in IPC handler.',
      detail: `${cause.name}: ${cause.message}`
    }
  }

  return {
    code: 'INTERNAL',
    message: 'Unexpected error in IPC handler.',
    detail: String(cause)
  }
}
