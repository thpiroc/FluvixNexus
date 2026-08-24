import type { GitOperationFailureReason } from '@shared/git'
import type { GitHubAvailability, GitHubRepositoryVisibility } from '@shared/github'
import { ghRepositoryPublisher } from './ghRepositoryPublisher'

/**
 * 「repository を作る相手」を差し替えられる境界（Session 3-8-10・設計判断 12）。
 *
 * ## なぜ境界にするのか
 *
 * 公開の一連（作る → remote を設定する → Push）のうち、**外の世界に触れるのは
 * 最初の1つだけ**になる。残りの2つは手元の git で、それは 3-8-1 から積み上げた
 * 仕組みがそのまま使える。
 *
 * その1つを差し替えられる形にしておくと、次の3つが同時に手に入る。
 *
 *   - **GitHub CLI が唯一の道ではなくなる。** OAuth を自前で持つ・GitHub の
 *     API を直接叩く・GitLab を相手にする、のどれになっても、
 *     入れ替わるのはこの実装1つだけで、git 側の手順は1行も変わらない
 *   - **公開の流れを、ネットワーク無しで確かめられる。** テストは
 *     「作った」と言って**同じ PC の bare リポジトリ**を返す実装に差し替える ──
 *     remote の設定と初回 Push は本物の git が動くので、確かめたい順序と
 *     再開の振る舞いが実物に対して固定できる（publishRepository.test.ts）
 *   - **gh の都合が publishRepository.ts に染み出さない。** 引数・出力の読み方・
 *     失敗の文言はすべて実装の内側にあり、外から見えるのは
 *     「作れた / 既にある / 作れなかった（分類つき）」の3つだけになる
 *
 * ## 差し替えは Main の中の話
 *
 * 選ぶ口（`setGitHubRepositoryPublisher`）は Main の中にしか無い。
 * **Renderer から実装を指す欄はどこにも無い** ── あれば、それは
 * 「どのプログラムに公開させるか」を外から選べる欄になる。
 */

/** repository を作った結果。 */
export type GitHubRepositoryCreation =
  /** 作れた。`remoteUrl` は `git remote add origin` にそのまま渡せる形（https）。 */
  | { readonly status: 'created'; readonly remoteUrl: string }
  /**
   * 作れなかった。
   *
   * `reason` は git の操作と同じ型（shared/git/operation.ts）にしてある ──
   * 公開の失敗は Push の失敗と同じ1行の場所に出るため、そこへ渡る値の型が
   * 2つあると、画面の側で束ねることになる。
   */
  | { readonly status: 'failed'; readonly reason: GitOperationFailureReason }

/** repository を作る要求（この境界を通る値はこれだけ）。 */
export interface GitHubRepositoryCreationRequest {
  /** 検証済みの repository 名（shared/github/repositoryName.ts）。 */
  readonly name: string
  readonly visibility: GitHubRepositoryVisibility
}

/**
 * 「GitHub に repository を作る」ことができる相手。
 *
 * 持たせているのは2つだけで、**どちらも repository を作ることの周辺**になる。
 * 一覧を出す・消す・設定を変える、といった口は無い ── 公開に要らないものを
 * 境界に置くと、差し替える側がそれを実装する義務を負う。
 */
export interface GitHubRepositoryPublisher {
  /** 今この相手を使える状態か（gh があるか・ログインしているか）。 */
  readonly checkAvailability: () => Promise<GitHubAvailability>
  /** 空の repository を1つ作る。 */
  readonly createRepository: (
    request: GitHubRepositoryCreationRequest
  ) => Promise<GitHubRepositoryCreation>
}

/**
 * 今使う実装。
 *
 * 既定は GitHub CLI（Session 3-8-10 の実装）。**アプリの起動時に選び直す
 * 仕組みは持たない** ── 選択肢が1つしか無い間に選ぶ仕組みだけ作ると、
 * その仕組みの側に「何を根拠に選ぶか」という決めごとが先に生まれる。
 */
let publisher: GitHubRepositoryPublisher = ghRepositoryPublisher

/** 今の実装を取り出す（呼ぶのは main/github/publishRepository.ts だけ）。 */
export function getGitHubRepositoryPublisher(): GitHubRepositoryPublisher {
  return publisher
}

/**
 * 実装を差し替える（テスト、あるいは将来の別の相手のため）。
 *
 * 戻り値は**元に戻すための関数**にしてある ── 差し替えっぱなしにすると、
 * 同じプロセスで走る次のテストがそれを引き継ぐ。
 */
export function setGitHubRepositoryPublisher(next: GitHubRepositoryPublisher): () => void {
  const previous = publisher
  publisher = next

  return () => {
    publisher = previous
  }
}
