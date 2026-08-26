/**
 * Git 契約レイヤーの公開窓口。
 *
 * Main / Preload / Renderer はこのモジュール経由で Git の型を参照する。
 * shared 層のルールどおり、ここに実装は置かない ── Git を動かすのは Main だけで、
 * その表（実行ファイルの解決・引数・作業ディレクトリ）は main/git/ が持つ。
 *
 * 例外は commitMessage.ts（Commit メッセージの規則）と branchName.ts
 * （ブランチ名の規則）の2つだけになる。どちらも Main と Renderer が
 * **同じ答えを見る必要がある純粋な文字列の判断**で、files ドメインの
 * fileName.ts と同じ立ち位置にあたる（理由はそれぞれのファイルの冒頭）。
 */
export {
  GIT_COMMIT_MESSAGE_MAX_LENGTH,
  findGitCommitMessageProblem,
  normalizeGitCommitMessage,
  prepareGitCommitMessage
} from './commitMessage'
export type { GitCommitMessageProblem } from './commitMessage'

export {
  GIT_BRANCH_NAME_MAX_LENGTH,
  findGitBranchNameProblem,
  normalizeGitBranchName,
  prepareGitBranchName
} from './branchName'
export type { GitBranchNameProblem } from './branchName'

export { GIT_LOCAL_BRANCH_LIMIT } from './branch'
export type { GitBranchListing, GitLocalBranch } from './branch'

export { GIT_COMMIT_HISTORY_LIMIT } from './history'
export type { GitCommitHistory, GitCommitSummary } from './history'

export { GIT_COMMIT_FILE_LIMIT } from './commitDetail'
export type {
  GitCommitChangeKind,
  GitCommitDetail,
  GitCommitDetailUnavailableReason,
  GitCommitFileChange,
  GitCommitFileDiff
} from './commitDetail'

export type {
  GitDiscardTarget,
  GitOperationFailure,
  GitOperationFailureReason,
  GitOperationOutcome,
  GitPartialOperationStep,
  GitStageTarget,
  GitUnstageTarget
} from './operation'

export type { GitDiffGroup, GitDiffUnavailableReason, GitFileDiff } from './diff'

export type { GitFailureReason, GitHead, GitRepositoryState } from './repository'

export type {
  GitChangeKind,
  GitFileChange,
  GitUpstreamStatus,
  GitWorkingTreeChanges
} from './status'
