import type { DebugIpcContract } from './contracts/debug'
import type { FeedbackIpcContract } from './contracts/feedback'
import type { FilesIpcContract } from './contracts/files'
import type { GitIpcContract } from './contracts/git'
import type { GitHubIpcContract } from './contracts/github'
import type { LspIpcContract } from './contracts/lsp'
import type { McpIpcContract } from './contracts/mcp'
import type { SettingsIpcContract } from './contracts/settings'
import type { SystemIpcContract } from './contracts/system'
import type { TerminalIpcContract } from './contracts/terminal'
import type { WindowIpcContract } from './contracts/window'
import type { WorkspaceIpcContract } from './contracts/workspace'
import type { WorkspaceFolderIpcContract } from './contracts/workspaceFolder'
import type { IpcResult } from './result'

/**
 * Main と Renderer の間で交わされる IPC の全契約。
 *
 * ここが Main / Preload / Renderer の三者にとって唯一の真実になる。
 * チャンネル名・リクエスト型・レスポンス型をこの1箇所に集約することで、
 * 「Main の実装」「Preload のラッパ」「Renderer の呼び出し」が
 * 型レベルで必ず一致することを保証する。
 *
 * ドメインを追加するときの手順は次の4ステップだけに保つこと。
 *  1. shared/ipc/contracts/<domain>.ts に契約を定義する
 *  2. この IpcContract の extends に追加する
 *  3. shared/ipc/channels.ts にチャンネル名を追加する（漏れると型エラーになる）
 *  4. main/ipc/handlers/<domain>.ts で実装し、preload/api/<domain>.ts で公開する
 *
 * この契約が扱うのは Renderer → Main の「要求と応答」だけである。
 * Terminal の出力・ファイル変更の通知・LSP / DAP の通知のように
 * Main → Renderer へ一方的に流れるイベントは、対になる IpcEventContract（event.ts）が扱う。
 * 分けてある理由はそちらの冒頭。
 */
export interface IpcContract
  extends
    SystemIpcContract,
    WindowIpcContract,
    WorkspaceIpcContract,
    WorkspaceFolderIpcContract,
    FilesIpcContract,
    SettingsIpcContract,
    TerminalIpcContract,
    GitIpcContract,
    GitHubIpcContract,
    LspIpcContract,
    DebugIpcContract,
    FeedbackIpcContract,
    McpIpcContract {}

/** 有効な IPC チャンネル名。契約に定義されたものだけが存在しうる。 */
export type IpcChannel = keyof IpcContract & string

/** 指定チャンネルのリクエスト型。引数不要のチャンネルは void。 */
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']

/** 指定チャンネルのレスポンス型（成功時に data として返る値）。 */
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/**
 * 呼び出し側の引数リスト。
 * リクエストが void のチャンネルは引数なしで呼べるようにする。
 */
export type IpcInvokeArgs<C extends IpcChannel> =
  IpcRequest<C> extends void ? [] : [request: IpcRequest<C>]

/**
 * Preload が Renderer へ公開する IPC 呼び出しの戻り値。
 * 失敗も戻り値として表現するため、常に IpcResult でくるまれる。
 */
export type IpcInvokeResult<C extends IpcChannel> = Promise<IpcResult<IpcResponse<C>>>
