/**
 * Git リポジトリの「今どうなっているか」（Session 3-8-1 / 3-8-2）。
 *
 * ## このファイルが答えるのは1つの問いだけ
 *
 * **「今開いている Workspace で、Git 操作を始められるか」**。
 * 始められないなら、その理由は何か。それだけを型にしてある。
 *
 * Stage・Commit・Push / Pull・ブランチ操作は、どれもこの問いに「始められる」と
 * 答えられて初めて意味を持つ（Session 3-8-3 以降）。土台と、その上に載るものを
 * 分けてある。Session 3-8-2 で足した**変更ファイルの一覧**（status.ts）は
 * その最初の1つで、`ready` の中にだけ存在する。
 *
 * ## Renderer へ渡すものに、OS の場所を混ぜない
 *
 * Files が絶対パスを渡さない（ARCHITECTURE.md §9.2）のと、Terminal が
 * 実行ファイルのパスを渡さない（shared/terminal/session.ts）のと同じ線を、
 * ここにも引く。
 *
 *   渡す   … 状態の分類・ブランチ名・リポジトリの**表示名**
 *   渡さない … git の実行ファイルのパス・.git の場所・リポジトリ root の絶対パス
 *
 * とくに `nested`（Workspace がリポジトリの一部でしかない）でリポジトリ root の
 * 絶対パスを渡していないのは、**渡せば Renderer がそれを指して何かを頼みたくなる**
 * ため。Session 3-8 の設計判断のとおり、Workspace root 自身がリポジトリ root で
 * ないときに Git 操作は行わない ── 指せる形を作らないことでそれを担保する。
 *
 * ## 失敗も「状態」として持つ
 *
 * Git が入っていない・リポジトリではない・root が食い違う。どれも
 * IpcResult の失敗（＝例外的な結末）ではなく、**Git パネルが平常時に出す表示**にあたる。
 * 失敗として返すと、Renderer 側の対応表（renderer/src/api/result.ts）が持つ
 * 汎用の文言に丸められ、「何をすればよいか」を出せなくなる
 * （`workspace-folder:open` の取り消しを失敗にしていないのと同じ理由）。
 *
 * shared 層のルールどおり、このファイルは型と定数だけを持つ。
 */

import type { GitUpstreamStatus, GitWorkingTreeChanges } from './status'

/**
 * HEAD が今どこを指しているか。
 *
 * `detached` を分けているのは、**利用者が次に取る行動が違う**ため。
 * ブランチの上に居れば Commit はそのブランチに積まれるが、detached では
 * どこにも属さない commit になる。同じ「ブランチ名の欄」に `abc1234` と
 * 出すだけでは、その違いが伝わらない。
 */
export type GitHead =
  /** ブランチの上に居る。まだ1つも commit が無い（unborn）場合もここに入る。 */
  | { readonly kind: 'branch'; readonly name: string }
  /** 特定の commit を直接指している。 */
  | { readonly kind: 'detached'; readonly commit: string }
  /**
   * どちらとも読めなかった。
   *
   * リポジトリとしては開けたのに HEAD が読めない、という壊れた状態でだけ現れる。
   * 「ブランチ名が空文字」で表さないのは、それが**読めた結果の空**と
   * 区別できなくなるため。
   */
  | { readonly kind: 'unknown' }

/**
 * Git を動かしたが、答えが得られなかったときの分類。
 *
 * ## 生の stderr を Renderer へ渡さない
 *
 * Git の stderr は開発者向けの文章で、複数行にわたり、環境によって言語も変わる。
 * そのまま UI に出すと「英語のエラーが1行出るだけ」になり、利用者は次に何を
 * すればよいか分からない。**分類するのは Main**（main/git/gitFailure.ts）で、
 * ここへ来るのは分類の結果だけになる。詳細は Main のログに残る
 * （IpcErrorPayload の detail と同じ分担）。
 *
 * 分類の粒度は「**利用者の次の一手が変わるか**」で決める。次の一手が同じものを
 * 分けても、UI には同じ文言が2つ並ぶだけになる。
 */
export type GitFailureReason =
  /**
   * 作業ツリーが無い（bare リポジトリ）。
   *
   * `.git` だけのフォルダを Workspace として開いた場合に出る。リポジトリでは
   * あるのでファイルを編集する対象が無く、Fluvix Nexus の Git パネルが
   * 想定している使い方から外れる。
   */
  | 'no-work-tree'
  /**
   * Git がこのフォルダの持ち主を信用しなかった（dubious ownership）。
   *
   * Windows では珍しくない ── 別のユーザーが作ったフォルダ・管理者権限で
   * 作られたフォルダ・ネットワークドライブなどで出る。**直し方が具体的に決まっている**
   * （`git config --global --add safe.directory <path>`）ため、他の失敗と分けている。
   */
  | 'dubious-ownership'
  /** OS の権限で読めなかった。 */
  | 'permission-denied'
  /**
   * 待ち時間の上限を過ぎた。
   *
   * ネットワークドライブ上のリポジトリや、巨大なリポジトリで起こりうる。
   * 「もう一度試す」が次の一手になるため、他と分けている。
   */
  | 'timeout'
  /** Git は答えたが、その出力を読めなかった（想定と違う形）。 */
  | 'unreadable-output'
  /** 上記のいずれにも当てはまらない。 */
  | 'unknown'

/**
 * Workspace と Git リポジトリの関係。
 *
 * Git パネルは、まずこの値を見て**何を出す画面か**を決める
 * （renderer/src/git/gitRepositoryMessage.ts）。
 */
export type GitRepositoryState =
  /**
   * Workspace が開かれていない。
   *
   * Files / Terminal と同じく、Git も「今開いているフォルダ」を対象にする
   * （DESIGN.md §3）。対象が無ければ調べる先も無い。
   */
  | { readonly status: 'no-workspace' }
  /**
   * この PC で git を見つけられなかった。
   *
   * **落ちる理由にしない。** Git が入っていない PC で Fluvix Nexus が
   * 使えなくなるわけではなく、使えないのは Git パネルだけになる
   * （Session 3-8 の設計判断 6）。
   */
  | { readonly status: 'git-unavailable' }
  /**
   * Workspace はあるが、Git リポジトリではない（未初期化）。
   *
   * Session 3-8-1 では**検出と案内だけ**を行い、`git init` は実行しない
   * （設計判断 1）。初期化は DESIGN.md §3 の「GitHub に公開」の一部として、
   * remote 作成・初回 Commit・Push と一続きで設計する。
   */
  | { readonly status: 'not-a-repository' }
  /**
   * リポジトリの中ではあるが、Workspace root がその root ではない。
   *
   * リポジトリの一部だけを開いている状態にあたる。ここで Git 操作を許すと、
   * **画面に見えていないファイルまで Commit / Push の対象になる** ── Files に
   * 出ていない変更が「変更ファイル一覧」に並ぶことになり、利用者から見て
   * 何を送ったのか分からなくなる。だから操作しない（設計判断 10）。
   *
   * サブフォルダ側のリポジトリを勝手に選ぶこともしない。
   */
  | {
      readonly status: 'nested'
      /**
       * リポジトリ root の**フォルダ名**（絶対パスではない）。
       *
       * 「どれを開き直せばよいか」を伝えるために要る。名前だけにしてあるのは
       * このファイルの冒頭のとおりで、Renderer がそれを指して何かを頼めないようにするため
       * （開き直すのは利用者がフォルダ選択ダイアログで行う）。
       */
      readonly repositoryName: string
    }
  /**
   * Git 操作を始められる（Workspace root ＝ リポジトリ root）。
   *
   * Session 3-8-3 以降が足す Stage / Commit / Push / Pull・ブランチ操作は、
   * すべてこの状態を前提にする。
   *
   * **変更ファイルの一覧をこの中に入れてある**（Session 3-8-2）。別の問い合わせに
   * 分けると、ブランチ名と変更一覧が別の瞬間の写しになり、画面の上下で
   * 食い違ったものが並びうる ── 利用者から見て1つの画面なら、答えも1回で返す。
   */
  | {
      readonly status: 'ready'
      readonly head: GitHead
      /** 作業ツリーの変更（shared/git/status.ts）。 */
      readonly changes: GitWorkingTreeChanges
      /** 追跡先との進み具合。upstream が無ければ null。 */
      readonly upstream: GitUpstreamStatus | null
    }
  /** Git を動かせたが、答えが得られなかった。 */
  | { readonly status: 'failed'; readonly reason: GitFailureReason }
