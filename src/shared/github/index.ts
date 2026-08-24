/**
 * GitHub 契約レイヤーの公開窓口（Session 3-8-10）。
 *
 * Main / Preload / Renderer はこのモジュール経由で GitHub の型を参照する。
 * shared 層のルールどおり、ここに実装は置かない ── `gh` を動かすのは Main だけで、
 * その表（実行ファイルの解決・引数・作業ディレクトリ）は main/github/ が持つ。
 *
 * 例外は repositoryName.ts だけになる。Main と Renderer が**同じ答えを見る
 * 必要がある純粋な文字列の判断**で、shared/git/branchName.ts と同じ立ち位置に
 * あたる（理由はそのファイルの冒頭）。
 */
export {
  GITHUB_REPOSITORY_NAME_MAX_LENGTH,
  findGitHubRepositoryNameProblem,
  normalizeGitHubRepositoryName,
  prepareGitHubRepositoryName
} from './repositoryName'
export type { GitHubRepositoryNameProblem } from './repositoryName'

export type { GitHubAvailability, GitHubRepositoryVisibility } from './publish'
