import type { GitFailureReason, GitHead, GitRepositoryState } from '@shared/git'
import { createTranslator, type TFunction } from '../i18n/messages'

const DEFAULT_T = createTranslator('ja')

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
export function describeGitRepositoryNotice(
  state: GitRepositoryState,
  t: TFunction = DEFAULT_T
): GitRepositoryNotice | null {
  switch (state.status) {
    case 'ready':
      return null

    case 'no-workspace':
      return {
        title: t('git.repository.noWorkspaceTitle'),
        description: null,
        retryable: false,
        action: null
      }

    case 'git-unavailable':
      return {
        title: t('git.repository.gitUnavailableTitle'),
        description: t('git.repository.gitUnavailableDescription'),
        retryable: true,
        action: null
      }

    case 'not-a-repository':
      return {
        title: t('git.repository.notRepositoryTitle'),
        /*
          Session 3-8-10 で、ここから抜け出す口（`git:init`）が画面に付いた。
          文言が説明するのは**その1回で何が起きるか**だけで、その先
          （Commit / GitHub への公開）は促さない ── 初期化と公開は
          完全に別の操作にしてある（main/git/gitInit.ts）。
        */
        description: t('git.repository.notRepositoryDescription'),
        retryable: true,
        action: t('git.repository.notRepositoryAction')
      }

    case 'nested':
      return {
        title: t('git.repository.nestedTitle', { name: state.repositoryName }),
        /*
          リポジトリ root の絶対パスは届かない（渡していない。設計判断 10）。
          名前だけで「どれを開き直せばよいか」は伝わる。
        */
        description: t('git.repository.nestedDescription'),
        retryable: true,
        action: null
      }

    case 'failed':
      return describeGitFailure(state.reason, t)
  }
}

/** 失敗の分類ごとの案内。 */
function describeGitFailure(reason: GitFailureReason, t: TFunction): GitRepositoryNotice {
  switch (reason) {
    case 'no-work-tree':
      return {
        title: t('git.repository.noWorkTreeTitle'),
        description: t('git.repository.noWorkTreeDescription'),
        retryable: true,
        action: null
      }

    case 'dubious-ownership':
      return {
        title: t('git.repository.dubiousOwnershipTitle'),
        description: t('git.repository.dubiousOwnershipDescription'),
        retryable: true,
        action: null
      }

    case 'permission-denied':
      return {
        title: t('git.repository.permissionDeniedTitle'),
        description: t('git.repository.permissionDeniedDescription'),
        retryable: true,
        action: null
      }

    case 'timeout':
      return {
        title: t('git.repository.timeoutTitle'),
        description: t('git.repository.timeoutDescription'),
        retryable: true,
        action: null
      }

    case 'unreadable-output':
    case 'unknown':
      return {
        title: t('git.repository.failedTitle'),
        description: t('git.repository.failedDescription'),
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
export function describeGitHead(head: GitHead, t: TFunction = DEFAULT_T): string {
  switch (head.kind) {
    case 'branch':
      return head.name

    case 'detached':
      return t('git.repository.detachedHead', { hash: head.commit })

    case 'unknown':
      return t('git.repository.unknownBranch')
  }
}
