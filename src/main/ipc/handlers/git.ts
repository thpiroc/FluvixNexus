import {
  normalizeGitBranchName,
  normalizeGitCommitMessage,
  normalizeGitRemoteName,
  normalizeGitRemoteUrl,
  type GitDiffGroup,
  type GitDiscardTarget,
  type GitStageTarget
} from '@shared/git'
import { GIT_STASH_LIMIT } from '@shared/git'
import {
  IPC_CHANNELS,
  type GetGitCommitDetailResponse,
  type GetGitCommitFileDiffResponse,
  type GetGitFileDiffResponse,
  type GetGitRepositoryResponse,
  type GitOperationResponse,
  type ListGitBranchesResponse,
  type ListGitCommitsResponse,
  type ListGitRemoteBranchesResponse,
  type ListGitRemotesResponse,
  type ListGitStashesResponse
} from '@shared/ipc'
import {
  applyGitCreateBranch,
  applyGitDeleteBranch,
  applyGitRenameBranch,
  applyGitSwitchBranch,
  listGitBranches
} from '../../git/gitBranches'
import { applyGitCommit } from '../../git/gitCommit'
import { readGitCommitDetail, readGitCommitFileDiff } from '../../git/gitCommitDetail'
import { normalizeGitCommitHash } from '../../git/gitCommitHash'
import { readGitFileDiff } from '../../git/gitDiff'
import { applyGitResolveConflict } from '../../git/gitConflict'
import { applyGitDiscard } from '../../git/gitDiscard'
import { listGitCommits } from '../../git/gitHistory'
import { applyGitInit } from '../../git/gitInit'
import { applyGitAbortMerge, applyGitMergeBranch } from '../../git/gitMerge'
import { normalizeGitPathspec } from '../../git/gitPathspec'
import { applyGitCreateTrackingBranch, listGitRemoteBranches } from '../../git/gitRemoteBranches'
import {
  applyGitAddRemote,
  applyGitRemoveRemote,
  applyGitRenameRemote,
  applyGitSetRemoteUrl,
  listGitRemotes
} from '../../git/gitRemotes'
import { describeGitRepository } from '../../git/gitRepository'
import { applyGitStage, applyGitUnstage } from '../../git/gitStage'
import {
  applyGitStashDrop,
  applyGitStashPop,
  applyGitStashPush,
  listGitStashes
} from '../../git/gitStash'
import { applyGitCommitAndPush, applyGitPull, applyGitPush } from '../../git/gitSync'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * git ドメインのハンドラ（Session 3-8-1 / 3-8-3 / 3-8-4 / 3-8-5 / 3-8-6 / 3-8-9 /
 * 3-8-10 / 3-8-11 / 3-8-12 / 3-8-13 / 3-8-14 / 3-8-15 / 3-8-16）。
 *
 * ## 3-8-1 では確かめる値が無かった
 *
 * `git:get-repository` の要求は `void` で、確かめるべき値そのものが届かない。
 * 実行するコマンドも、その引数も、作業ディレクトリも Renderer からは渡せず、
 * Main が自分の持っている正本と表から決める（main/git/）。
 *
 * ## 3-8-3 で初めて値が届く
 *
 * Stage / Unstage の対象は Renderer から来る。ここが**その値を確かめる場所**になり、
 * 通すのは次の2つだけになる。
 *
 *   相対位置1つ … `normalizeGitPathspec` を通った形（main/git/gitPathspec.ts）
 *   グループ    … `unstaged` / `untracked` という閉じた集合の値
 *
 * ## 3-8-4 で増えたのはメッセージ1つ
 *
 * Commit の要求に載るのは利用者が書いた文章だけで、**何を Commit するかは
 * 載らない**（対象は index の中身そのもの）。文章は `normalizeGitCommitMessage` を
 * 通してから Main の domain へ渡り、git へは引数ではなく標準入力から渡る
 * （main/git/gitCommands.ts）── つまりこの値も、git の引数になる経路が無い。
 *
 * ## 3-8-6 で確かめるのは、名前の**形**だけ
 *
 * ブランチの切り替え / 作成で届くのは名前1つで、通すのは
 * `normalizeGitBranchName`（Renderer が入力中に使うのと同じ関数）になる。
 * ここを通った値だけが、`--end-of-options` の後ろの引数として git へ渡る
 * （main/git/gitCommands.ts）。
 *
 * **形しか見ない**のが要点にあたる ── 「そのブランチが実在するか」も
 * 「同じ名前が既にあるか」も確かめない。どちらもリポジトリの中身を見ないと
 * 決まらないことで、答えるのは git になる（応答の `outcome` に載る）。
 *
 * ## 3-8-5 では、確かめる値がまた減る
 *
 * Push / Pull の要求は **`void`** にしてある ── remote 名もブランチ名も
 * refspec も渡す欄が無く、3-8-1 の `git:get-repository` と同じく
 * 確かめるべき値そのものが届かない。Commit & Push で届くのは
 * Commit と同じメッセージ1つだけで、Push の側に足した欄は無い。
 *
 * git のコマンド名・引数・作業ディレクトリ・実行ファイル・シェルは、
 * 3-8-1 のときと同じく**要求に欄そのものが無い**（shared/ipc/contracts/git.ts）。
 * チャンネルも操作ごとに1本ずつで、汎用の実行 API は作らない。
 *
 * ## 値が通せないことだけを IpcError にする
 *
 * 契約の上では `target` は必ず正しい形で届くが、境界の外から来た値として
 * 素直に信じない（files ドメインのハンドラと同じ構え）。通せない値は
 * **INVALID_REQUEST**、つまり「Renderer 側の不具合」として返す ──
 * 利用者に起こることではないため、Git パネルの案内には出さない。
 *
 * 逆に、**利用者に起こること**（ファイルが消えていた・index が握られていた・
 * リポジトリでなくなった）は失敗として返さず、応答の中の `outcome` に載せる。
 * 汎用のエラー文言に丸めると「次に何をすればよいか」を出せなくなるのは
 * 3-8-1 と同じ理由になる（shared/git/repository.ts）。
 */

/** 契約上は必ず入っているが、境界の外から来た値として素直に信じない。 */
function field(request: unknown, key: string): unknown {
  return typeof request === 'object' && request !== null
    ? (request as Record<string, unknown>)[key]
    : undefined
}

/**
 * Stage の対象を読み取る。
 *
 * `kind` を先に見て、その形に必要な欄だけを確かめる。**`relativePath` が
 * 付いていても、グループの指定なら使わない** ── 使う形にすると
 * 「グループのつもりで送った要求に、無視されるはずの path が効く」余地ができる。
 */
function stageTargetField(request: unknown): GitStageTarget {
  const target = field(request, 'target')
  const kind = field(target, 'kind')

  if (kind === 'unstaged' || kind === 'untracked') {
    return { kind }
  }

  if (kind !== 'file') {
    throw invalidRequest('the stage target is missing or not a known kind.')
  }

  return { kind: 'file', relativePath: pathspecField(target) }
}

/** Unstage の対象（ファイル単位だけ。shared/git/operation.ts）。 */
function unstageTargetField(request: unknown): string {
  return pathspecField(field(request, 'target'))
}

/**
 * pathspec として通してよい相対位置。
 *
 * ここを通らない値が git の引数になることは無い。**正規化した値を使う**
 * （受け取った生の文字列ではなく）── 区切りが `\` の形で届いても、
 * git へ渡るのは `/` に揃った1つの形だけになる。
 */
function pathspecField(target: unknown): string {
  const pathspec = normalizeGitPathspec(field(target, 'relativePath'))

  if (pathspec === null) {
    throw invalidRequest('the requested path is not usable as a git pathspec.')
  }

  return pathspec
}

/**
 * Commit メッセージ（Session 3-8-4）。
 *
 * 通すのは `normalizeGitCommitMessage`（shared/git/commitMessage.ts）で、
 * **Renderer が入力中に使うのと同じ関数**になる。同じ規則を2箇所に書くと、
 * 片方だけ直された日に「ボタンは押せるのに Main が弾く」が生まれる。
 *
 * 同じ関数を使うことと、検証を Renderer へ委譲することは別の話にあたる ──
 * ここを通らない文字列が git へ渡ることは無い。
 *
 * **通せない値を INVALID_REQUEST にする**のは pathspec と同じ扱いで、
 * 空・空白だけ・長すぎ・NUL 入りのメッセージでは Renderer 側がそもそも
 * ボタンを押せなくしてある（renderer/src/git/GitView.tsx）。つまりここへ
 * 届くのは Renderer 側の不具合であって、利用者に起こることではない ──
 * 利用者に起こること（名乗りが無い・hook が止めた・競合が残っている）の方は
 * 失敗にせず、応答の `outcome` に分類として載る。
 */
function commitMessageField(request: unknown): string {
  const message = normalizeGitCommitMessage(field(request, 'message'))

  if (message === null) {
    throw invalidRequest('the commit message is empty, too long, or contains control characters.')
  }

  return message
}

/**
 * ブランチ名（Session 3-8-6）。
 *
 * 通すのは `normalizeGitBranchName`（shared/git/branchName.ts）で、
 * **Renderer が入力中に使うのと同じ関数**になる ── Commit メッセージと
 * まったく同じ分担で、同じ規則を2箇所に書くと、片方だけ直された日に
 * 「ボタンは押せるのに Main が弾く」が生まれる。
 *
 * **ここを通らない文字列が git の引数になることは無い。** ブランチ名は
 * pathspec と違い、`--` ではなく `--end-of-options` の後ろに置かれる
 * （main/git/gitCommands.ts）── 置き方と形の検証の両方でようやく
 * 「値は値でしかない」と言える。
 *
 * 通せない値を INVALID_REQUEST にするのは pathspec / Commit メッセージと同じ扱いで、
 * 空・長すぎ・使えない文字・使えない形の名前では Renderer 側がそもそもボタンを
 * 押せなくしてある（renderer/src/git/GitBranchMenu.tsx）。切り替えの側では、
 * そもそも**一覧から選んだ名前**しか送られない。
 *
 * 逆に、**利用者に起こること**（同じ名前が既にある・切り替え先が消えていた・
 * 書きかけが邪魔をした）は失敗にせず、応答の `outcome` に分類として載る。
 */
/**
 * 差分の対象（Session 3-8-9）。
 *
 * 確かめるのは2つだけ ── グループが**知っている値か**（閉じた集合）と、
 * 位置が pathspec として通せる形か。どちらも Stage の対象を確かめているのと
 * 同じ形で、rev も diff のオプションも要求に欄そのものが無い。
 *
 * `conflicted` を通さないのは型の上でも同じだが、**ここでも弾く** ──
 * 届いた文字列が型どおりであることは、Main の側では何も保証されていない。
 */
function diffGroupField(request: unknown): GitDiffGroup {
  const group = field(request, 'group')

  if (group !== 'staged' && group !== 'unstaged' && group !== 'untracked') {
    throw invalidRequest('the diff group is missing or not a known group.')
  }

  return group
}

/**
 * 破棄の対象（Session 3-8-9）。
 *
 * 通すグループは `unstaged` / `untracked` の2つだけ。**`staged` と
 * `conflicted` はここで断る** ── 型の上で渡せないものが、実際にも
 * 通らないことを入口で確かめておく（shared/git/operation.ts）。
 *
 * 断るのは `IpcResult` の失敗（INVALID_REQUEST）にあたる。利用者に起こる
 * ことではなく、Renderer 側の不具合になる（`GitOperationResponse` に載る
 * 失敗は「リポジトリは見えているのに通らなかった」の側だけ）。
 */
function discardTargetField(request: unknown): GitDiscardTarget {
  const target = field(request, 'target')
  const group = field(target, 'group')

  if (group !== 'unstaged' && group !== 'untracked') {
    throw invalidRequest('the discard target is missing or not a discardable group.')
  }

  return { group, relativePath: pathspecField(target) }
}

/**
 * 開く commit の短い hash（Session 3-8-12）。
 *
 * 通すのは `normalizeGitCommitHash`（main/git/gitCommitHash.ts）で、
 * **16進 4〜40 桁だけ**になる ── `HEAD~5` も `main@{1}` も `:/要約` も
 * `<hash>:<path>` も、ここを通らない。pathspec / Commit メッセージ /
 * ブランチ名と同じく、**ここを通らない文字列が git の引数になることは無い。**
 *
 * ブランチ名と違い、Renderer 側に同じ関数を置いていない ── 利用者が
 * hash を打ち込む欄がそもそも無く、渡るのは履歴の行がそのまま持っていた
 * 文字列だけになる（打てる欄が無いので、入力中に確かめる相手も居ない）。
 *
 * 通せない値を INVALID_REQUEST にするのは他の値と同じ扱いで、Renderer 側の
 * 不具合にあたる。逆に、**利用者に起こること**（その commit がもう解けない・
 * マージ commit だった）は失敗にせず、応答の `detail` に分類として載る。
 */
function commitHashField(request: unknown): string {
  const hash = normalizeGitCommitHash(field(request, 'shortHash'))

  if (hash === null) {
    throw invalidRequest('the commit hash is missing or not a short git object name.')
  }

  return hash
}

function branchNameField(request: unknown): string {
  const name = normalizeGitBranchName(field(request, 'name'))

  if (name === null) {
    throw invalidRequest('the branch name is empty, too long, or not usable as a git branch name.')
  }

  return name
}

/**
 * rename の行き先の名前（Session 3-8-14）。
 *
 * 通すのは `branchNameField` とまったく同じ `normalizeGitBranchName` で、
 * **欄の名前だけが違う。** 別の関数にしてあるのは読む欄が違うからで、
 * 規則を分けているわけではない ── 分けると「元の名前としては通るが
 * 新しい名前としては通らない（あるいはその逆）」形が生まれ、
 * git の引数に載る2つの値に別々の備えが掛かることになる。
 *
 * ここを通った2つだけが、`--end-of-options` の後ろに並ぶ
 * （main/git/gitCommands.ts）。
 */
function branchNewNameField(request: unknown): string {
  const name = normalizeGitBranchName(field(request, 'newName'))

  if (name === null) {
    throw invalidRequest(
      'the new branch name is empty, too long, or not usable as a git branch name.'
    )
  }

  return name
}

/**
 * 追う相手の remote-tracking branch 名（Session 3-8-19）。
 *
 * ## 通すのは `branchNameField` と同じ `normalizeGitBranchName`
 *
 * `origin/feature/x` はブランチ名の規則をそのまま通る（`/` は形として
 * 認められており、位置だけが見られる。shared/git/branchName.ts）── つまり
 * **新しい規則を1つも足していない。** 足すと「remote-tracking branch 名としては
 * 通るがブランチ名としては通らない」形が生まれ、git の引数に載る2つの値に
 * 別々の備えが掛かることになる（`branchNewNameField` を分けたのと同じ判断）。
 *
 * ## 「`/` を含むこと」をここで求めない
 *
 * remote-tracking branch は必ず `<remote>/<branch>` の形をしているので、
 * `/` を求める検証は書ける。**書かないのは、それが何も守らないから**になる ──
 * `origin/x` の形をした**ローカル**ブランチ名も同じ検証を通り、
 * 守りたいのはその区別の方にあたる。
 *
 * 区別を付けられるのは**手元のリポジトリを見た側**だけなので、そこは Main が
 * git に確かめる（`refs/remotes/` の下に在るか。main/git/gitRemoteBranches.ts）──
 * 名前の形の話ではないものを、名前の形の検証で守ったつもりにしない
 * （shared/git/branchName.ts が「既にある名前か」を git に答えさせているのと
 * 同じ線）。
 */
function branchStartRefField(request: unknown): string {
  const name = normalizeGitBranchName(field(request, 'startPoint'))

  if (name === null) {
    throw invalidRequest(
      'the remote-tracking branch name is empty, too long, or not usable as a git branch name.'
    )
  }

  return name
}

/**
 * 新しいブランチの始点（Session 3-8-13）。
 *
 * 通すのは `commitHashField` とまったく同じ `normalizeGitCommitHash` で、
 * **入口を2つに分けない** ── 履歴の行を指す値はどの操作から届いても同じ形で、
 * ここだけ緩めると「詳細では開けないが、ブランチの始点にはできる」hash が
 * 生まれる。
 *
 * 違うのは `null` を通すことだけになる。**`null` は「値が無い」ではなく
 * 「HEAD から作る」という答え**で、バーの「＋」から来る要求がそれにあたる
 * （main/git/gitCommands.ts）。欄そのものが届かなかった場合も同じ側へ倒す ──
 * 3-8-6 の時点で作られた要求（`startPoint` を持たない）が届いても、
 * それは「今の場所から」という意味にしかなりえない。
 *
 * 逆に、**文字列として届いたのに形が通らない**なら断る。空文字も
 * `HEAD~1` も `main@{1}` もここで止まり、git の引数になることは無い。
 */
function branchStartPointField(request: unknown): string | null {
  const raw = field(request, 'startPoint')

  if (raw === null || raw === undefined) {
    return null
  }

  const hash = normalizeGitCommitHash(raw)

  if (hash === null) {
    throw invalidRequest('the branch start point is not a short git object name.')
  }

  return hash
}

/**
 * 退避1件の位置（Session 3-8-15）。
 *
 * ## ここだけ、数を確かめる
 *
 * ここまで確かめてきたのは全部**文字列の形**だった（pathspec・メッセージ・
 * ブランチ名・hash）。退避の位置は数で届く ── `stash@{N}` を組み立てるのは
 * Main の表で（main/git/gitCommands.ts）、その N がここを通る。
 *
 * 見るのは3つ。
 *
 *   数であること   … 文字列の `'0'` も、`NaN` も通さない
 *   安全な整数     … 小数も、桁あふれした数も通さない
 *   0 以上・上限未満 … 一覧に出せる範囲（`GIT_STASH_LIMIT`）を超えた位置は、
 *                      そもそも画面に出ていない
 *
 * この3つを通れば、`stash@{N}` に**10進の数字以外の文字が入る余地が無い** ──
 * それが「値を他の文字と繋いで引数にしない」という線（§14.20）に対して、
 * ここだけ組み立てを許している根拠になる。
 *
 * ## 位置だけでは足りない
 *
 * `stash@{1}` は名前ではなく上から数えた位置で、次の瞬間には別のものを
 * 指しうる（shared/git/stash.ts）── したがって要求には hash も載り、
 * Main が押された瞬間に突き合わせる（main/git/gitStash.ts）。
 * ここで確かめるのは形だけで、**そこに何が居るかは確かめない**（それは
 * リポジトリの中身を見ないと決まらない、という 3-8-6 からの分担のまま）。
 */
/**
 * remote 名（Session 3-8-16）。
 *
 * 通すのは `normalizeGitRemoteName`（shared/git/remoteName.ts）で、
 * **Renderer が入力中に使うのと同じ関数**になる ── Commit メッセージ・
 * ブランチ名とまったく同じ分担で、同じ規則を2箇所に書くと、片方だけ
 * 直された日に「ボタンは押せるのに Main が弾く」が生まれる。
 *
 * **ここを通らない文字列が git の引数になることは無い。** remote 名は
 * ブランチ名と同じく `--end-of-options` の後ろに置かれる
 * （main/git/gitCommands.ts）が、そこでも足りない ── `git remote add
 * --end-of-options -x <url>` は git が受け取ってしまい、以降その remote は
 * アプリからも端末からも消しにくくなる（実物で確かめた）。
 * **置き方と形の検証の両方が要る**のは、pathspec と同じ構えになる。
 *
 * 追加の側も削除の側も同じ関数を通す ── 入口を分けると
 * 「足せるが消せない名前」が生まれる（`branchNameField` /
 * `branchNewNameField` と同じ判断）。3-8-17 で増えた2本（URL の変更 /
 * rename）が指す側も、まったく同じこの関数を通る。
 */
function remoteNameField(request: unknown): string {
  const name = normalizeGitRemoteName(field(request, 'name'))

  if (name === null) {
    throw invalidRequest('the remote name is empty, too long, or not usable as a git remote name.')
  }

  return name
}

/**
 * remote の URL（Session 3-8-16）。
 *
 * ## ここが、この境界でいちばん危ない値になる
 *
 * 3-8-1 から「git の引数を渡せる欄を作らない」を守ってきたが、URL は
 * **その欄を作らないと機能そのものが成り立たない**唯一の値にあたる。
 * しかも素通しにすると、時間差で任意のコマンドが走る形になる ──
 * `git remote add evil "ext::sh -c whoami"` は今の git がそのまま受け取り、
 * 以降の fetch / push でその文字列がシェルとして走る（実物で確かめた）。
 *
 * したがって通すのは `normalizeGitRemoteUrl`（shared/git/remoteUrl.ts）で、
 * **形の列挙を通ったものだけ**になる（`https://…` / `ssh://…` /
 * `user@host:path` の3つ）。認証情報を含む URL もここで断る ── 通すと
 * アプリが利用者の token を `.git/config` へ平文で書くことになる。
 *
 * ## 往復しない値
 *
 * 名前と違い、URL は Renderer → Main の一方向にしか流れない。一覧に載るのは
 * ラベルだけで（shared/git/remote.ts）、削除の要求にも URL の欄は無い。
 *
 * 通せない値を INVALID_REQUEST にするのは他の値と同じ扱いで、Renderer 側でも
 * そもそもボタンを押せなくしてある（renderer/src/git/GitRemoteOverlay.tsx）。
 * 逆に、**利用者に起こること**（同じ名前が既にある）は失敗にせず、
 * 応答の `outcome` に分類として載る。
 */
function remoteUrlField(request: unknown): string {
  const url = normalizeGitRemoteUrl(field(request, 'url'))

  if (url === null) {
    throw invalidRequest('the remote url is empty, too long, or not an accepted git remote url.')
  }

  return url
}

/**
 * rename の行き先の remote 名（Session 3-8-17）。
 *
 * 通すのは `remoteNameField` とまったく同じ `normalizeGitRemoteName` で、
 * **読む欄だけが違う**（`branchNameField` / `branchNewNameField` と同じ形）──
 * 規則を分けると「元の名前としては通るが、新しい名前としては通らない」形が
 * 生まれ、`--end-of-options` の後ろに並ぶ2つの値に別々の備えが掛かる。
 *
 * ここが要るのは形の話だけではない ── `git remote rename --end-of-options
 * up2 -x` は git が**受け取ってしまい**、`-x` という名前の remote が
 * 生まれる（実物で確かめた。main/git/gitRemoteRepository.test.ts）。
 * 追加のときとまったく同じ穴が、行き先の側にも開いている。
 *
 * **大文字小文字だけの改名はここでは断らない。** それは2つの値の
 * 「組み合わせ」で決まるもので、1つの値の形の話ではない ── 見るのは
 * git を動かす直前になる（main/git/gitRemotes.ts の `applyGitRenameRemote`）。
 */
function remoteNewNameField(request: unknown): string {
  const name = normalizeGitRemoteName(field(request, 'newName'))

  if (name === null) {
    throw invalidRequest(
      'the new remote name is empty, too long, or not usable as a git remote name.'
    )
  }

  return name
}

function stashIndexField(request: unknown): number {
  const index = field(request, 'index')

  if (
    typeof index !== 'number' ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= GIT_STASH_LIMIT
  ) {
    throw invalidRequest('the stash index is missing or not a listable position.')
  }

  return index
}

export function registerGitHandlers(): void {
  handleIpc(IPC_CHANNELS.GIT_GET_REPOSITORY, async (): Promise<GetGitRepositoryResponse> => {
    return await describeGitRepository()
  })

  /*
    初期化（Session 3-8-10）。

    要求は `void` ── どこを初期化するかも、初期ブランチ名も渡せないため、
    ここで確かめるべき値そのものが届かない（3-8-1 の `git:get-repository` と
    同じ形）。対象は常に「今の Workspace」で、それを持っているのは Main になる。

    **GitHub への公開（`github:*`）とは別の口**にしてある。初期化した後に
    公開を続けて呼ぶことも、促すこともしない（main/git/gitInit.ts）。
  */
  handleIpc(IPC_CHANNELS.GIT_INIT, async (): Promise<GitOperationResponse> => {
    return await applyGitInit()
  })

  handleIpc(IPC_CHANNELS.GIT_STAGE, async (request): Promise<GitOperationResponse> => {
    return await applyGitStage(stageTargetField(request))
  })

  handleIpc(IPC_CHANNELS.GIT_UNSTAGE, async (request): Promise<GitOperationResponse> => {
    return await applyGitUnstage({ relativePath: unstageTargetField(request) })
  })

  handleIpc(IPC_CHANNELS.GIT_COMMIT, async (request): Promise<GitOperationResponse> => {
    return await applyGitCommit(commitMessageField(request))
  })

  /*
    Push / Pull（Session 3-8-5）。

    **要求が `void` に戻る。** remote 名・ブランチ名・refspec のどれも
    渡す欄が無いため、ここで確かめるべき値そのものが届かない
    （3-8-1 の `git:get-repository` と同じ形）。送り先を決めるのは
    リポジトリの設定で、それを読むのは Main になる（main/git/gitSync.ts）。
  */
  handleIpc(IPC_CHANNELS.GIT_PUSH, async (): Promise<GitOperationResponse> => {
    return await applyGitPush()
  })

  handleIpc(IPC_CHANNELS.GIT_PULL, async (): Promise<GitOperationResponse> => {
    return await applyGitPull()
  })

  /*
    Commit & Push（Session 3-8-5）。

    確かめるのは Commit と同じメッセージ1つだけで、**Push の側に足す値は無い。**
    通す関数も `git:commit` とまったく同じ（`normalizeGitCommitMessage`）──
    2つの入口で違う規則が効くと、片方からだけ通るメッセージが生まれる。
  */
  handleIpc(IPC_CHANNELS.GIT_COMMIT_AND_PUSH, async (request): Promise<GitOperationResponse> => {
    return await applyGitCommitAndPush(commitMessageField(request))
  })

  /*
    ブランチの一覧（Session 3-8-6）。

    要求は `void`。どの ref を、どう並べて、いくつ、という指定は1つも無く、
    答えるのは常に「今の Workspace のローカルブランチ」だけになる
    （shared/git/branch.ts）。読み取りだが `git:get-repository` と別の1本なのは、
    見られている時間が違うため（shared/ipc/contracts/git.ts）。
  */
  handleIpc(IPC_CHANNELS.GIT_LIST_BRANCHES, async (): Promise<ListGitBranchesResponse> => {
    return await listGitBranches()
  })

  /*
    commit の履歴（Session 3-8-11）。

    要求は `void`。**rev も件数も並べ替えも絞り込みも届かない**ため、
    ここで確かめるべき値そのものが無い（`git:list-branches` と同じ形）。
    答えるのは常に「今の HEAD からさかのぼった 100 件」だけになる
    （shared/git/history.ts）。

    書き込みの口はこのドメインに1つも足していない ── 履歴の面から
    revert も reset も amend も動かせない（docs/ARCHITECTURE.md §14.19）。
  */
  handleIpc(IPC_CHANNELS.GIT_LIST_COMMITS, async (): Promise<ListGitCommitsResponse> => {
    return await listGitCommits()
  })

  /*
    commit 1件の詳細と、その中の1ファイルの差分（Session 3-8-12）。

    **3-8-11 まで `void` だった履歴の系統に、初めて値が1つ載る。** 載るのは
    履歴の行が持っていた短い hash だけで、確かめるのは形（16進 4〜40 桁）に
    なる ── `HEAD~5` も pathspec も `--stat` も欄そのものが無い。

    差分の側で確かめる位置は、Stage / Unstage / 3-8-9 の差分とまったく同じ関数を
    通る（`pathspecField`）── 4つめの入口で違う規則が効くと、
    そこからだけ通る位置が生まれる。

    書き込みの口はここでも1つも足していない。動く git は `show --no-patch` /
    `diff-tree` / `cat-file` の3種で、どれも読み取りになる。
  */
  handleIpc(
    IPC_CHANNELS.GIT_GET_COMMIT_DETAIL,
    async (request): Promise<GetGitCommitDetailResponse> => {
      return await readGitCommitDetail({ shortHash: commitHashField(request) })
    }
  )

  handleIpc(
    IPC_CHANNELS.GIT_GET_COMMIT_FILE_DIFF,
    async (request): Promise<GetGitCommitFileDiffResponse> => {
      return await readGitCommitFileDiff({
        shortHash: commitHashField(request),
        relativePath: pathspecField(request)
      })
    }
  )

  /*
    ブランチの切り替え / 作成（Session 3-8-6）。

    確かめるのは名前1つだけで、**2本とも同じ関数**を通す（`branchNameField`）──
    2つの入口で違う規則が効くと、片方からだけ通る名前が生まれる
    （`git:commit` と `git:commit-and-push` で同じ判断をしている）。

    チャンネルを分けてあるのは「無ければ作る」を作らないため。1本にすると、
    名前を打ち間違えたときに、切り替えたつもりで新しいブランチが増える。
  */
  handleIpc(IPC_CHANNELS.GIT_SWITCH_BRANCH, async (request): Promise<GitOperationResponse> => {
    return await applyGitSwitchBranch(branchNameField(request))
  })

  /*
    作成では、3-8-13 で始点が1つ増えた（切り替えの側は 3-8-6 のまま）。

    確かめる関数は commit の詳細とまったく同じ（`normalizeGitCommitHash`）で、
    **履歴の行を指す値の入口は1つだけ**という形をここでも保つ。
    始点が無い（＝ HEAD から作る）ことは `null` として通り、
    「欄が足りない要求」としては断らない（上記）。
  */
  handleIpc(IPC_CHANNELS.GIT_CREATE_BRANCH, async (request): Promise<GitOperationResponse> => {
    return await applyGitCreateBranch(branchNameField(request), branchStartPointField(request))
  })

  /*
    削除と rename（Session 3-8-14）。

    どちらも動かすのは `git branch` で、切り替え / 作成（`git switch`）とは
    別のコマンドになる ── それでも**ここで確かめる値は名前だけ**で、
    通す関数も 3-8-6 から1つも変わらない。

    削除の要求に `--force`（`-D`）の欄は無く、rename の要求に `-M` の欄も無い。
    「確認したか」の欄も無い ── 確認を通した証を引数に載せると、
    載せなければ確認を飛ばせる形になる（shared/ipc/contracts/git.ts）。

    rename だけが**1つの要求で2つの外来の値**を運ぶ。2つとも同じ
    `normalizeGitBranchName` を通る（`branchNameField` / `branchNewNameField`）──
    入口を2つに分けると、片方からだけ通る名前が生まれる。
  */
  handleIpc(IPC_CHANNELS.GIT_DELETE_BRANCH, async (request): Promise<GitOperationResponse> => {
    return await applyGitDeleteBranch(branchNameField(request))
  })

  handleIpc(IPC_CHANNELS.GIT_RENAME_BRANCH, async (request): Promise<GitOperationResponse> => {
    return await applyGitRenameBranch(branchNameField(request), branchNewNameField(request))
  })

  /*
    ブランチのマージの開始 / 中止（Session 3-8-20）。

    ## 開始の要求も、確かめるのは名前1つだけ

    通すのは切り替え / 削除 / rename とまったく同じ `branchNameField`
    （`normalizeGitBranchName`）── ここまでの4本と同じ規則にしてあるのは、
    入口ごとに違う規則が効くと「切り替えられるがマージできない名前」が
    生まれるため（3-8-14 / 3-8-19 と同じ判断）。

    **ただし、形が通ることと「それがローカルブランチである」ことは別**に
    なる ── `v1.0` は tag として、`3d0574a` は commit hash として解ける
    名前でもあり、`git merge` はどちらも受け取る。そこは
    `branch --list` で確かめてから動かす（main/git/gitMerge.ts）。

    取り込み**先**の欄は無い（常に今のブランチ）。戦略も `--no-ff` も
    `--squash` も渡す欄が無く、動く引数は Main の表に固定してある
    （main/git/gitCommands.ts）。

    ## 中止の要求は `void`

    どのマージを中止するかは届かない ── 途中のマージは常に高々1つで、
    それは MERGE_HEAD が指す。マージ中でなければ git を1回も動かさずに
    `nothing-to-do` として返る。

    どちらの要求にも「確認したか」の欄は無い（3-8-14 以降と同じ）。
  */
  handleIpc(IPC_CHANNELS.GIT_MERGE_BRANCH, async (request): Promise<GitOperationResponse> => {
    return await applyGitMergeBranch(branchNameField(request))
  })

  handleIpc(IPC_CHANNELS.GIT_ABORT_MERGE, async (): Promise<GitOperationResponse> => {
    return await applyGitAbortMerge()
  })

  /*
    remote-tracking branch の一覧と、そこからの作成（Session 3-8-19）。

    一覧の要求は `void` ── remote 名で絞る欄も並べ替えも件数も、
    **fetch するかどうか**も届かない（`git:list-branches` と同じ形）。
    ローカルの一覧と別の1本にしてあるのは、動かす git が違い・上限が
    別々に効き・押したときに起きることが違うため（shared/ipc/contracts/git.ts）。

    作成の要求には**外来の名前が2つ**載る（rename に続いて2つめの形）。
    どちらも `normalizeGitBranchName` を通り、通す関数は 3-8-6 から
    1つも変わらない ── 増えたのは「その名前が本当に remote-tracking branch か」
    という**リポジトリを見ないと決まらない問い**で、それは名前の形の検証では
    なく Main が git に確かめる（main/git/gitRemoteBranches.ts）。

    `--no-track` の欄も `--force` の欄も無い。同じ名前のローカルブランチが
    あれば git を動かす前に断り、上書きも削除も自動切替も行わない。
  */
  handleIpc(
    IPC_CHANNELS.GIT_LIST_REMOTE_BRANCHES,
    async (): Promise<ListGitRemoteBranchesResponse> => {
      return await listGitRemoteBranches()
    }
  )

  handleIpc(
    IPC_CHANNELS.GIT_CREATE_TRACKING_BRANCH,
    async (request): Promise<GitOperationResponse> => {
      return await applyGitCreateTrackingBranch(
        branchNameField(request),
        branchStartRefField(request)
      )
    }
  )

  /*
    remote の一覧 / 追加 / 削除（Session 3-8-16）。

    一覧の要求は `void` ── 並べ替えも絞り込みも件数も届かないため、
    ここで確かめるべき値そのものが無い（`git:list-branches` /
    `git:list-commits` / `git:list-stashes` と同じ形）。

    値が載るのは追加と削除で、**追加だけが1要求で2つの外来の値**を運ぶ。
    2つは規則が別のファイルになる（3-8-14 の rename が2つとも同じ
    `normalizeGitBranchName` を通ったのとは、そこが違う）── 名前は
    境界を往復する値、URL は Renderer → Main へ一方向にしか流れない値で、
    後者は **git に任意のプログラムを起動させうる**唯一の値にあたる
    （`remoteUrlField`）。

    名前を通す関数は追加と削除で**同じ**にしてある ── 入口を分けると
    「足せるが消せない名前」が生まれる。

    削除の要求に「確認したか」の欄は無い ── 確認を通した証を引数に載せると、
    載せなければ確認を飛ばせる形になる（3-8-14 / 3-8-15 と同じ）。

    **`github:publish` とは別の口のまま。** あちらが動かす `git remote add` は
    名前が固定（`origin`）で、URL は GitHub が返したものになる ──
    Renderer 由来の値が1つも入らない、という 3-8-10 の保証をここで崩さない
    （main/git/gitCommands.ts の `addOriginRemote` / `addRemote`）。
  */
  handleIpc(IPC_CHANNELS.GIT_LIST_REMOTES, async (): Promise<ListGitRemotesResponse> => {
    return await listGitRemotes()
  })

  handleIpc(IPC_CHANNELS.GIT_ADD_REMOTE, async (request): Promise<GitOperationResponse> => {
    return await applyGitAddRemote(remoteNameField(request), remoteUrlField(request))
  })

  handleIpc(IPC_CHANNELS.GIT_REMOVE_REMOTE, async (request): Promise<GitOperationResponse> => {
    return await applyGitRemoveRemote(remoteNameField(request))
  })

  /*
    remote の URL の変更 / rename（Session 3-8-17）。

    増えたのは**登録簿に書いてある値を書き換える口**が2本で、送り先を
    選ぶ口ではない ── `git:push` / `git:pull` の要求は今も `void` のまま
    になる（3-8-5 の判断は 3-8-17 でも撤回していない）。

    URL の変更は追加と**まったく同じ2つの関数**を通る（`remoteNameField` /
    `remoteUrlField`）── 入口を分けると「追加では通らないが変更では通る
    URL」が生まれ、`ext::sh -c …` を断っている根拠がその日に半分になる。
    `git remote set-url x "ext::sh -c whoami"` も git はそのまま受け取る
    （実物で確かめてある。main/git/gitRemoteRepository.test.ts）。

    rename は名前を2つ運び、**2つとも同じ規則**を通る（`remoteNameField` /
    `remoteNewNameField`）── 3-8-14 のブランチの rename と同じ形になる。

    どちらの要求にも「確認したか」の欄は無い。URL の変更には押す前の確認が
    あるが（Git で5つめ）、確認は Renderer の中の話で、証を引数に載せると
    載せなければ飛ばせる形になる（3-8-14 / 3-8-15 / 3-8-16 と同じ）。

    **大文字小文字だけの rename は、ここでは断らない** ── 1つの値の形の
    話ではなく2つの値の組み合わせで決まるため、見るのは git を動かす直前に
    なる（main/git/gitRemotes.ts）。
  */
  handleIpc(IPC_CHANNELS.GIT_SET_REMOTE_URL, async (request): Promise<GitOperationResponse> => {
    return await applyGitSetRemoteUrl(remoteNameField(request), remoteUrlField(request))
  })

  handleIpc(IPC_CHANNELS.GIT_RENAME_REMOTE, async (request): Promise<GitOperationResponse> => {
    return await applyGitRenameRemote(remoteNameField(request), remoteNewNameField(request))
  })

  /*
    退避（Session 3-8-15）。

    一覧の要求は `void` ── 並べ替えも絞り込みも件数も届かないため、
    ここで確かめるべき値そのものが無い（`git:list-branches` /
    `git:list-commits` と同じ形）。退避そのものの要求も `void` で、
    名前（`-m`）も `-u` も pathspec も欄を作っていない。

    値が載るのは pop / drop の2本だけで、載るのは**位置と hash の2つ**になる。
    hash を通すのは commit の詳細・ブランチの始点とまったく同じ
    `commitHashField`（`normalizeGitCommitHash`）── **退避も commit** で、
    入口を分けると「詳細では開けないが、退避としては指せる」hash が生まれる。

    位置の側は初めて**数**を確かめる欄になる（`stashIndexField`）。
    その2つを突き合わせるのは Main の domain で、ここは形だけを見る ──
    「そこに何が居るか」はリポジトリの中身を見ないと決まらない
    （3-8-6 からの分担のまま）。

    drop の要求に「確認したか」の欄は無い ── 確認を通した証を引数に載せると、
    載せなければ確認を飛ばせる形になる（3-8-14 と同じ）。
  */
  handleIpc(IPC_CHANNELS.GIT_LIST_STASHES, async (): Promise<ListGitStashesResponse> => {
    return await listGitStashes()
  })

  handleIpc(IPC_CHANNELS.GIT_STASH_PUSH, async (): Promise<GitOperationResponse> => {
    return await applyGitStashPush()
  })

  handleIpc(IPC_CHANNELS.GIT_STASH_POP, async (request): Promise<GitOperationResponse> => {
    return await applyGitStashPop(stashIndexField(request), commitHashField(request))
  })

  handleIpc(IPC_CHANNELS.GIT_STASH_DROP, async (request): Promise<GitOperationResponse> => {
    return await applyGitStashDrop(stashIndexField(request), commitHashField(request))
  })

  /*
    差分と破棄（Session 3-8-9）。

    差分は読み取りだが `git:get-repository` と別の1本にしてある（見られている
    時間が違う。shared/ipc/contracts/git.ts）。破棄は `git:unstage` の説明に
    書いてあった「作業ツリーごと戻すもの」で、**同じチャンネルに区別を
    引数として持たせず**、別の1本として切ってある。

    位置を確かめる関数は Stage / Unstage とまったく同じ（`pathspecField`）──
    3つの入口で違う規則が効くと、片方からだけ通る位置が生まれる。
  */
  handleIpc(IPC_CHANNELS.GIT_GET_FILE_DIFF, async (request): Promise<GetGitFileDiffResponse> => {
    return await readGitFileDiff({
      group: diffGroupField(request),
      relativePath: pathspecField(request)
    })
  })

  handleIpc(IPC_CHANNELS.GIT_DISCARD, async (request): Promise<GitOperationResponse> => {
    return await applyGitDiscard(discardTargetField(request))
  })

  /*
    競合の解決（Session 3-8-18）。

    載るのは位置1つだけで、確かめる関数は Stage / Unstage / 差分 / 破棄と
    **まったく同じ**になる（`pathspecField`）── 5つめの入口で違う規則が
    効くと、そこからだけ通る位置が生まれる。

    グループは載らない ── 対象は必ず競合のグループの行で、他のグループから
    押せる場所がそのものが無い（破棄が `group` を要求するのとは違う。
    あちらは同じ位置が2つのグループに並びうるため）。

    **`git:stage` と別の1本にしてある。** 動かす git は同じ `git add` だが、
    こちらは index の3段を1段に畳む操作で意味が違う ── 1本にすると、
    競合の行に出したボタンが「Stage」と名乗ることになる
    （main/git/gitConflict.ts）。

    「確認したか」の欄も、マーカーが残っているかの欄も無い ── 後者を
    Renderer から渡せる形にすると、**渡さなければ確かめを飛ばせる**ことに
    なる。確かめるのは Main で、押す前に git を1回動かす。
  */
  handleIpc(IPC_CHANNELS.GIT_RESOLVE_CONFLICT, async (request): Promise<GitOperationResponse> => {
    return await applyGitResolveConflict(pathspecField(request))
  })
}
