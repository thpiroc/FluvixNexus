/**
 * system ドメインの IPC 契約。
 *
 * system は Files / Terminal / GitHub のような機能ドメインではなく、
 * 「IPC 基盤そのものが生きているか」を確認するための最小ドメインである。
 * ここを雛形として、今後 contracts/files.ts / contracts/terminal.ts などを追加していく。
 */

/** 疎通確認のリクエスト。往復で値が保たれることを確認するためのトークンを持つ。 */
export interface PingRequest {
  /** 呼び出し側が生成する任意の識別子。空文字は INVALID_REQUEST として扱う。 */
  readonly token: string
}

export interface PingResponse {
  /** リクエストで渡された token をそのまま返す。 */
  readonly token: string
  /** Main 側が受信した時刻（epoch ミリ秒）。 */
  readonly receivedAt: number
}

/** アプリ自身の情報。Main でしか取得できない値をまとめる。 */
export interface AppInfoResponse {
  readonly name: string
  readonly version: string
  readonly locale: string
  /** 開発ビルド（electron-vite dev）で動作しているか。 */
  readonly isDevelopment: boolean
}

export interface SystemIpcContract {
  'system:ping': {
    request: PingRequest
    response: PingResponse
  }
  'system:app-info': {
    request: void
    response: AppInfoResponse
  }
}
