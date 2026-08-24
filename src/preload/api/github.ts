import type { GitHubApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * github ドメインの Preload API（Session 3-8-10）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * `child_process` を持ち込まないのはもちろん、**gh の引数を組み立てる処理も
 * ここには置かない** ── 組み立ててよいのは Main だけで
 * （main/github/githubCommands.ts）、Preload が提供するのは経路になる。
 *
 * 名前の形を確かめるのもここではない。Renderer は入力中に shared の関数を
 * 使い、Main は受け取った後に同じ関数を通す（main/ipc/handlers/github.ts）──
 * **Preload は Renderer と同じ側から差し替えられうる**前提に立つため、
 * ここでの検証は境界にならない（files / git と同じ理由）。
 */
export const githubApi: GitHubApi = {
  getStatus: () => invokeIpc(IPC_CHANNELS.GITHUB_GET_STATUS),
  publish: (request) => invokeIpc(IPC_CHANNELS.GITHUB_PUBLISH, request)
}
