import type { FluvixApi } from '@shared/api'
import { approvalApi } from './approval'
import { debugApi } from './debug'
import { envApi } from './env'
import { feedbackApi } from './feedback'
import { filesApi } from './files'
import { gitApi } from './git'
import { githubApi } from './github'
import { keybindingsApi } from './keybindings'
import { lspApi } from './lsp'
import { mcpApi } from './mcp'
import { settingsApi } from './settings'
import { systemApi } from './system'
import { terminalApi } from './terminal'
import { updatesApi } from './updates'
import { windowApi } from './window'
import { workspaceApi } from './workspace'
import { workspaceFolderApi } from './workspaceFolder'

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
  window: windowApi,
  workspace: workspaceApi,
  workspaceFolder: workspaceFolderApi,
  files: filesApi,
  terminal: terminalApi,
  git: gitApi,
  github: githubApi,
  updates: updatesApi,
  lsp: lspApi,
  debug: debugApi,
  settings: settingsApi,
  keybindings: keybindingsApi,
  feedback: feedbackApi,
  mcp: mcpApi,
  approval: approvalApi
}
