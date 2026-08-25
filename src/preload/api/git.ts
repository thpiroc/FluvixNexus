import type { GitApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * git ドメインの Preload API（Session 3-8-1）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * `child_process` を持ち込まないのはもちろん、**git の引数を組み立てる処理も
 * ここには置かない** ── 組み立ててよいのは Main だけで
 * （main/git/gitCommands.ts）、Preload が提供するのは経路になる。
 *
 * `terminal` API が「渡す欄そのものが無い」ことで境界を作っているのに対し、
 * 3-8-1 の時点ではさらに徹底していて、**要求が `void`** ＝ 渡せる値が1つも無かった。
 *
 * ## Session 3-8-6 でブランチ名が載っても、同じ形のまま
 *
 * 切り替え / 作成の要求には利用者が選んだ（打った）ブランチ名が載る。
 * それでも**ここは素通しの経路のまま**で、名前の形を確かめるのは Main の
 * ハンドラ（`normalizeGitBranchName`）、引数として組み立てるのは Main の表になる。
 * 一覧（`listBranches`）は要求が `void` に戻る ── 並べ替えも絞り込みも
 * 渡す欄が無い。
 *
 * ## Session 3-8-3 / 3-8-4 で値が載っても、線は動かない
 *
 * Stage / Unstage の要求には対象（相対位置1つ、またはグループの区別）が、
 * Commit の要求には利用者が書いたメッセージが載る。
 * Session 3-8-5 の Push / Pull では**また `void` に戻る** ── ネットワークへ
 * 出る操作でこそ相手の名前を渡したくなるが、remote 名もブランチ名も
 * refspec も欄そのものを作っていない（shared/ipc/contracts/git.ts）。
 * それでもここが**素通しの経路のまま**であることは変わらない ── 値を確かめるのは
 * Main のハンドラで（main/ipc/handlers/git.ts）、git の引数を組み立てるのは
 * Main の表になる（main/git/gitCommands.ts）。
 *
 * Preload で確かめない理由は Files と同じで、**Preload は Renderer と同じ側から
 * 差し替えられうる**前提に立つため。ここでの検証は境界にならない。
 *
 * ## Session 3-8-11 で足した `listCommits` も、要求は `void`
 *
 * 履歴の要求には rev も件数も絞り込みも載らない ── 一覧（`listBranches`）と
 * まったく同じ形で、Renderer が言えるのは「今の HEAD からさかのぼって」だけに
 * なる（shared/ipc/contracts/git.ts）。
 *
 * ## Session 3-8-10 で足した `init` も、渡す値が1つも無い
 *
 * 初期化の要求は `void` ── どこを初期化するかも初期ブランチ名も渡せない。
 * GitHub への公開は**別のドメイン**（preload/api/github.ts）で、gh を動かすのも
 * その名前を確かめるのも Main になる。
 *
 * ## Session 3-8-8 で購読が1本増えても、同じ形のまま
 *
 * `onChanged` は `files.onChanged` とまったく同じ作りで、チャンネル名を
 * 当てはめるだけになる。**Renderer に filesystem の監視 API は公開しない** ──
 * 見張るのは Main（main/git/gitWatcher.ts）で、Renderer が受け取るのは
 * 「そのリポジトリで何かが変わった」という合図1つだけになる。
 */
export const gitApi: GitApi = {
  getRepository: () => invokeIpc(IPC_CHANNELS.GIT_GET_REPOSITORY),
  init: () => invokeIpc(IPC_CHANNELS.GIT_INIT),
  stage: (request) => invokeIpc(IPC_CHANNELS.GIT_STAGE, request),
  unstage: (request) => invokeIpc(IPC_CHANNELS.GIT_UNSTAGE, request),
  commit: (request) => invokeIpc(IPC_CHANNELS.GIT_COMMIT, request),
  push: () => invokeIpc(IPC_CHANNELS.GIT_PUSH),
  pull: () => invokeIpc(IPC_CHANNELS.GIT_PULL),
  commitAndPush: (request) => invokeIpc(IPC_CHANNELS.GIT_COMMIT_AND_PUSH, request),
  listBranches: () => invokeIpc(IPC_CHANNELS.GIT_LIST_BRANCHES),
  listCommits: () => invokeIpc(IPC_CHANNELS.GIT_LIST_COMMITS),
  switchBranch: (request) => invokeIpc(IPC_CHANNELS.GIT_SWITCH_BRANCH, request),
  createBranch: (request) => invokeIpc(IPC_CHANNELS.GIT_CREATE_BRANCH, request),
  getFileDiff: (request) => invokeIpc(IPC_CHANNELS.GIT_GET_FILE_DIFF, request),
  discard: (request) => invokeIpc(IPC_CHANNELS.GIT_DISCARD, request),
  onChanged: (listener) => subscribeIpcEvent(IPC_EVENT_CHANNELS.GIT_CHANGED, listener)
}
