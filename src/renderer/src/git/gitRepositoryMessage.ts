import type { GitFailureReason, GitHead, GitRepositoryState } from '@shared/git'

/**
 * Git リポジトリの状態 → 画面に出す文言（React / DOM 非依存・テスト対象）。
 *
 * files/filesError.ts・terminal/terminalError.ts と同じ役どころにあたる。
 * 文言の決定を分けておくと、**どの状態でも「次に何をすればよいか」が
 * 書かれているか**をテストで確かめられる。
 *
 * ## Main の言葉をそのまま出さない
 *
 * Main から届くのは分類だけで（shared/git/repository.ts）、git の生の stderr は
 * 渡ってこない（設計判断 3）。UI の文言を決めるのは Renderer の責務という、
 * IPC の失敗コードと同じ分担になる（api/result.ts）。
 *
 * ## 「できません」で終わらせない
 *
 * Git パネルが出す案内は、ほとんどが**利用者が直せる状態**を指している
 * （Git が入っていない／リポジトリではない／開くフォルダが違う）。
 * どの文言にも、次の一手を1文で添える。
 *
 * ## Session 3-8-1 で「やらないこと」だったものが、3-8-10 で口になった
 *
 * 未初期化のフォルダに対して、3-8-1 は**案内だけ**を出していた（設計判断 1）──
 * 「途中まで自動でやって止まる」形を作らないためで、当時は初期化から公開までを
 * 一続きにする前提だったことによる。
 *
 * 3-8-10 でその前提が変わった ── **初期化と公開を別の操作にした**ので、
 * `git init` は「押せば終わる1つの操作」になる。したがってここには
 * ボタンが付く（`action`）。文言が説明するのは**その1回で何が起きるか**までで、
 * その先（Commit / 公開）は促さない。
 */

/** 中身の代わりに出す案内1つ分。 */
export interface GitRepositoryNotice {
  readonly title: string
  /** 次の一手。無い状態は作らない（title だけで終わるのは Workspace 未選択のみ）。 */
  readonly description: string | null
  /**
   * 「もう一度調べる」を出すか。
   *
   * 出すのは**待てば / 直せば変わりうる**状態だけにする。Workspace が
   * 開かれていない状態で出しても、押した結果は必ず同じになる
   * （そこで要るのは「フォルダを開く」の方）。
   */
  readonly retryable: boolean
  /**
   * その状態から抜け出す操作の名前。無ければ null（Session 3-8-10）。
   *
   * 今のところ `not-a-repository`（`git init`）の1つだけになる。
   *
   * **ボタンを出すかどうかを、案内を決める場所で一緒に決める。** 画面の側の
   * if で「この状態のときだけボタンを足す」と書くと、文言と押せるものが
   * 別々の場所で決まることになり、片方だけ直された日に
   * 「案内は『リポジトリにできます』なのにボタンが無い」が生まれる。
   *
   * 文字列を持つのは、押したときに何が呼ばれるかは**画面が決める**ため
   * （ここは React 非依存の層で、関数は持てない。GitView.tsx）。
   */
  readonly action: string | null
}

/**
 * 案内を出すべき状態か。`ready` なら null（案内ではなくリポジトリの中身を出す）。
 */
export function describeGitRepositoryNotice(state: GitRepositoryState): GitRepositoryNotice | null {
  switch (state.status) {
    case 'ready':
      return null

    case 'no-workspace':
      return {
        title: 'Workspace が開かれていません。',
        description: null,
        retryable: false,
        action: null
      }

    case 'git-unavailable':
      return {
        title: 'Git が見つかりませんでした。',
        description:
          'この PC に Git がインストールされていないか、見つけられない場所にあります。Git をインストールしてから、もう一度お試しください。',
        retryable: true,
        action: null
      }

    case 'not-a-repository':
      return {
        title: 'このフォルダはまだ Git リポジトリではありません。',
        /*
          Session 3-8-10 で、ここから抜け出す口（`git:init`）が画面に付いた。
          文言が説明するのは**その1回で何が起きるか**だけで、その先
          （Commit / GitHub への公開）は促さない ── 初期化と公開は
          完全に別の操作にしてある（main/git/gitInit.ts）。
        */
        description:
          'Git リポジトリにすると、変更の記録（Commit）やブランチの操作ができるようになります。GitHub への公開は、リポジトリにした後でいつでも選べます。',
        retryable: true,
        action: 'Git リポジトリにする'
      }

    case 'nested':
      return {
        title: `このフォルダは Git リポジトリ「${state.repositoryName}」の一部です。`,
        /*
          リポジトリ root の絶対パスは届かない（渡していない。設計判断 10）。
          名前だけで「どれを開き直せばよいか」は伝わる。
        */
        description:
          'リポジトリの一部だけを開いている状態では、画面に見えていないファイルまで Commit の対象になってしまうため、Git 操作は行いません。リポジトリのフォルダそのものを Workspace として開き直してください。',
        retryable: true,
        action: null
      }

    case 'failed':
      return describeGitFailure(state.reason)
  }
}

/** 失敗の分類ごとの案内。 */
function describeGitFailure(reason: GitFailureReason): GitRepositoryNotice {
  switch (reason) {
    case 'no-work-tree':
      return {
        title: 'このフォルダには作業ツリーがありません。',
        description:
          '編集するファイルを持たないリポジトリ（bare リポジトリ）です。clone した作業用のフォルダを Workspace として開いてください。',
        retryable: true,
        action: null
      }

    case 'dubious-ownership':
      return {
        title: 'Git がこのフォルダの所有者を信頼していません。',
        description:
          '別のユーザーや管理者権限で作られたフォルダで起こります。Terminal パネルで git config --global --add safe.directory を実行して、このフォルダを信頼する設定を追加してください。',
        retryable: true,
        action: null
      }

    case 'permission-denied':
      return {
        title: 'このフォルダを読み取る権限がありません。',
        description: 'フォルダのアクセス許可を確認してから、もう一度お試しください。',
        retryable: true,
        action: null
      }

    case 'timeout':
      return {
        title: 'Git の応答がありませんでした。',
        description:
          'ネットワークドライブ上のリポジトリや、非常に大きなリポジトリで起こることがあります。もう一度お試しください。',
        retryable: true,
        action: null
      }

    case 'unreadable-output':
    case 'unknown':
      return {
        title: 'Git の状態を取得できませんでした。',
        description: 'もう一度お試しください。詳しい内容はアプリのログに記録されています。',
        retryable: true,
        action: null
      }
  }
}

/**
 * HEAD の表示。
 *
 * detached を「ブランチ名の欄に commit を出す」形にしないのは、
 * **利用者が次に取る行動が違う**ため（shared/git/repository.ts）。
 * 用語をそのまま出しているのは、これが git 側の状態そのものを指す言葉で、
 * 言い換えると調べようがなくなるから。
 */
export function describeGitHead(head: GitHead): string {
  switch (head.kind) {
    case 'branch':
      return head.name

    case 'detached':
      return `detached HEAD（${head.commit}）`

    case 'unknown':
      return 'ブランチ不明'
  }
}
