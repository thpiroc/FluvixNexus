import type { FluvixApi } from '@shared/api'
import { envApi } from './env'
import { systemApi } from './system'
import { workspaceApi } from './workspace'

/**
 * Renderer へ公開する API の実体。
 *
 * Preload は「Main の機能を Renderer へ安全に橋渡しする層」であり、それ以上の責務を持たない。
 * したがってここに書いてよいのは次の2種類だけとする。
 *  1. Preload 時点で同期的に確定する安全な値（platform / versions など）
 *  2. IPC 呼び出しを型付きの関数に包んだだけの薄いラッパ
 *
 * ファイル I/O やプロセス起動といった実処理を Preload に書いてはならない。
 * それらは Main Process の責務であり、Preload は経路だけを提供する。
 *
 * ドメイン API を追加するときは api/<domain>.ts を作り、ここで束ねる。
 * このファイル自体は名前空間の組み立てだけを行い、ロジックを持たない。
 */
export const api: FluvixApi = {
  env: envApi,
  system: systemApi,
  workspace: workspaceApi
}
