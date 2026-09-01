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

import type { GitInProgressOperation } from './inProgress'
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
   * Session 3-8-1 では**検出と案内だけ**を行い、`git init` は実行しなかった
   * （設計判断 1）。Session 3-8-10 で、ここから抜け出す口（`git:init`）を
   * 足してある ── ただし**初期化はそれだけで完結する1つの操作**で、
   * 初回 Commit も GitHub への公開も続けて行わない（main/git/gitInit.ts）。
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
      /**
       * remote が1つでも設定されているか（Session 3-8-10）。
       *
       * ## 名前も URL も載せず、有無だけを載せる
       *
       * `origin` という名前も、その先の URL も渡さない ── リポジトリ root の
       * 絶対パスを渡していない（このファイルの冒頭）のと同じ線で、**渡せば
       * Renderer がそれを指して何かを頼みたくなる**。remote を指せる欄は
       * Push / Pull にも作っていない（相手を決めるのはリポジトリの設定で、
       * それを読むのは Main になる。shared/ipc/contracts/git.ts）。
       *
       * ## なぜ `ready` の中なのか
       *
       * ブランチの一覧を `ready` に入れなかった（shared/git/branch.ts）のとは
       * 逆の判断になる。基準は同じ**「見られている時間」**で、この値は
       * Git パネルが開いている間ずっと画面を決めている ──
       *
       *   remote が無い … 「GitHub に公開」の入口を出す（Session 3-8-10）
       *   remote がある … Push / Pull の並びだけを出す
       *
       * 別の問い合わせに分けると、一覧やブランチ名と**別の瞬間の写し**になり、
       * 「公開の入口と Push が同時に出ている」画面がありうる。
       *
       * 代償は、状態を読むたびに git が1回増えること（`git remote`）。その1回は
       * Push が押される前に払っていたもの（`listRemotes`）をそのまま前へ
       * 移しただけで、合計は増えていない（main/git/gitSync.ts）。
       */
      readonly hasRemote: boolean
      /**
       * 途中で止まっている Git 操作。何も途中でなければ null
       * （Session 3-8-20 の `merging` を 3-8-22A で広げたもの）。
       *
       * ## `merging: boolean` から置き換えた理由
       *
       * 3-8-20 が読んでいたのは `MERGE_HEAD` 1つで、それ以外の途中の状態
       * （rebase / cherry-pick / revert）は**存在しないのと同じ扱い**だった。
       * 端末で rebase を始めて競合させた状態でこのパネルを開くと、
       * 帯も出ず、Stage も Commit も素通りする ── アプリは自分が扱えない
       * 状態の上で、扱えるふりをしていたことになる。
       *
       * `boolean` を1つ足す形（`rebasing` / `cherryPicking` / …）にしなかった
       * のは、**同時に2つ在ることが無い**ため。4つの真偽値にすると、
       * 「どれも false」と「2つ true」という**起こりえない組み合わせ**を
       * 受け手が扱えることになり、そのぶんの分岐がどこかに書かれる。
       *
       * ## Renderer 側で推測しない（3-8-20 のまま）
       *
       * 「競合しているファイルが1件以上ある」から導けそうに見えるが、**導けない。**
       *
       *   競合が無くても途中 … 解決し終えた直後（Commit / `--continue` まで ref は残る）
       *   途中でなくても競合 … `stash pop` が作る競合（Session 3-8-15）
       *
       * 前者を取り違えると「解決し終えた瞬間に中止の口が消える」ことになり、
       * 後者では**マージしていないのに `merge --abort` を出す**ことになる。
       * どちらの間違いも、利用者が見ている画面と Git の実際の状態が食い違う。
       *
       * したがって読むのは Git で（`rev-parse --verify --quiet <REF>`。
       * main/git/gitRepository.ts）、Renderer へはその答えだけが渡る。
       *
       * ## なぜ `ready` の中なのか
       *
       * 基準は `hasRemote` と同じ**「見られている時間」**になる。途中の間は
       * その間ずっと画面を決めている ── 上のバーの下に帯が出て、
       * マージならそこにだけ中止の口が在る（renderer/src/git/GitView.tsx）。
       * 別の問い合わせに分けると、変更ファイルの一覧と**別の瞬間の写し**になり、
       * 「競合の行は消えているのに帯だけ残っている」画面がありうる。
       *
       * 何を禁止するかを決めるのは shared/git/inProgress.ts の表で、
       * **Main と Renderer が同じものを読む。**
       *
       * 代償は、状態を読むたびに git が最大4回増えること（`rev-parse` ×4）。
       * どれも ref を1つ確かめるだけで、作業ツリーにもネットワークにも触らない。
       */
      readonly inProgress: GitInProgressOperation | null
    }
  /** Git を動かせたが、答えが得られなかった。 */
  | { readonly status: 'failed'; readonly reason: GitFailureReason }
