/**
 * IPC のエラーハンドリング方針。
 *
 * Electron の ipcMain.handle は、ハンドラ内で throw された Error を
 * "Error occurred in handler for ..." という文字列に丸めて Renderer へ返す。
 * これでは Renderer 側でエラーの種類を判別できず、UI で出し分けもできない。
 *
 * そこで Fluvix Nexus では次の方針を取る。
 *  1. IPC の戻り値は必ず IpcResult でくるみ、成功も失敗も「正常な戻り値」として返す。
 *  2. Main 側で throw されたものは registry が捕捉し、IpcResult の失敗形へ変換する（IPC 境界を越えて例外を投げない）。
 *  3. 失敗は code で分類する。message は開発者向け、UI 文言は Renderer 側で code から決める。
 *
 * IpcResult は構造化クローンで安全に渡せる素の値のみで構成すること
 * （Error インスタンスや class は contextBridge を越えると壊れる）。
 */

/**
 * IPC 失敗の分類。
 * ドメインを追加する際も、まずはここに定義済みのコードで表現できないかを検討する。
 */
export type IpcErrorCode =
  /** リクエストの内容が不正（必須項目の欠落・値の範囲外など）。 */
  | 'INVALID_REQUEST'
  /** 対象のファイル・リポジトリ・セッションなどが存在しない。 */
  | 'NOT_FOUND'
  /**
   * 要求自体は正しいが、対象の現在の状態と衝突している。
   *
   * 同名のファイルが既にある、といった**利用者が直せる**失敗のための分類。
   * INVALID_REQUEST（入力が不正）と分けているのは、UI での次の一手が違うため
   * （前者は名前を変えれば通る、後者は入力そのものを直す必要がある）。
   * Git の非早送りマージなど、後続ドメインでも同じ性質の失敗が出てくる。
   */
  | 'CONFLICT'
  /**
   * 対象が他のプロセスに使われていて、今は手が出せない。
   *
   * CONFLICT と分けているのは、**直す相手がアプリの外にある**ため。
   * CONFLICT は要求を変えれば通る（別の名前にする）が、こちらは要求は正しく、
   * 使っている側を閉じて**同じ要求をやり直す**のが次の一手になる。
   * PERMISSION_DENIED とも分ける ── あちらは待っても直らない。
   *
   * ファイルを掴んだままのエディタ・ビルド中の生成物など、
   * Windows では日常的に起きる。Git のインデックスロックなど、
   * 後続ドメインでも同じ性質の失敗が出てくる。
   */
  | 'BUSY'
  /** OS 権限やアプリのポリシーにより拒否された。 */
  | 'PERMISSION_DENIED'
  /** 現在の環境では実行できない（未インストールの SDK、非対応 OS など）。 */
  | 'UNSUPPORTED'
  /** 利用者または上位処理によって中断された。 */
  | 'CANCELLED'
  /** 該当チャンネルのハンドラが Main 側に存在しない（実装漏れ・バージョン不整合）。 */
  | 'CHANNEL_UNAVAILABLE'
  /** 上記のいずれにも当てはまらない想定外の失敗。 */
  | 'INTERNAL'

/** IPC 失敗時に Renderer へ渡す内容。 */
export interface IpcErrorPayload {
  readonly code: IpcErrorCode
  /** 開発者向けの説明。UI にそのまま出す前提の文言にはしない。 */
  readonly message: string
  /** 原因の補足（元例外の message など）。UI には出さず、ログ・診断用に使う。 */
  readonly detail?: string
}

/** IPC 呼び出しの結果。成功と失敗を型で分岐できるようにする。 */
export type IpcResult<T> = IpcSuccess<T> | IpcFailure

export interface IpcSuccess<T> {
  readonly ok: true
  readonly data: T
}

export interface IpcFailure {
  readonly ok: false
  readonly error: IpcErrorPayload
}

export function ipcSuccess<T>(data: T): IpcSuccess<T> {
  return { ok: true, data }
}

export function ipcFailure(error: IpcErrorPayload): IpcFailure {
  return { ok: false, error }
}
