/**
 * Renderer に公開される API の型定義。
 *
 * この層は Main / Preload / Renderer のすべてから参照される「契約」であり、
 * OS 依存の型（NodeJS.* など）や Node.js の API を持ち込まないこと。
 * Renderer は DOM 環境、Main / Preload は Node 環境でコンパイルされるため、
 * ここに書けるのは純粋な型と定数のみとする。
 */

import type { IpcInvokeResult } from './ipc/contract'
import type { PingRequest } from './ipc/contracts/system'

/** サポート対象プラットフォーム。v1 は win32 のみを対象とするが、将来の Mac 対応を妨げない形で定義する。 */
export type PlatformId = 'win32' | 'darwin' | 'linux'

/** 実行環境のバージョン情報。 */
export interface RuntimeVersions {
  readonly electron: string
  readonly chrome: string
  readonly node: string
}

/**
 * 実行環境の情報を提供する API。
 * Preload の時点で同期的に確定する値のみを扱うため、IPC を必要としない。
 */
export interface EnvApi {
  readonly platform: PlatformId
  readonly versions: RuntimeVersions
}

/**
 * IPC 基盤の疎通と、Main でしか取得できないアプリ情報を提供する API。
 *
 * system は機能ドメインではなく基盤ドメインであり、
 * Files / Terminal / GitHub の各 API はこれと同じ形（IPC 契約に対応する薄いメソッド群）で追加する。
 */
export interface SystemApi {
  /** Main との疎通確認。渡した token がそのまま返る。 */
  readonly ping: (request: PingRequest) => IpcInvokeResult<'system:ping'>
  /** アプリ名・バージョンなど Main が保持する情報を取得する。 */
  readonly getAppInfo: () => IpcInvokeResult<'system:app-info'>
}

/**
 * `window.fluvix` として Renderer に公開される API 全体。
 *
 * Files / Terminal / GitHub / Workspace など OS に触れるドメイン API は、
 * ここにドメイン単位の名前空間として追加していく（例: `readonly files: FilesApi`）。
 * Renderer が OS へ直接触れないという原則を守るため、追加は必ずこの型経由で行うこと。
 */
export interface FluvixApi {
  readonly env: EnvApi
  readonly system: SystemApi
}

/** `window` に API を公開する際のキー。Preload と Renderer の双方から参照する。 */
export const FLUVIX_API_KEY = 'fluvix' as const
