import {
  findGitHubRepositoryNameProblem,
  prepareGitHubRepositoryName,
  type GitHubAvailability,
  type GitHubRepositoryNameProblem
} from '@shared/github'
import type { GitActionReadiness } from './gitChanges'

/**
 * GitHub への公開 → 画面に並べる形（React / DOM 非依存・テスト対象・Session 3-8-10）。
 *
 * gitBranches.ts が「ブランチを選ぶ面の中身」を持つのとまったく同じ立ち位置で、
 * こちらは**公開の面の中身**を持つ。GitHubPublishForm.tsx に残るのは配置だけになる。
 *
 * ## ここで決めているのは4つ
 *
 *   1. gh の状態を何と出すか（入っていない・ログインしていない・確かめている）
 *   2. 打った名前で公開できるか、できないならなぜか
 *   3. 欄の初期値（Workspace の名前をそのまま使えるか）
 *   4. 押したときに何が起きるか（`note`）
 *
 * 2 の判断は shared の関数（`findGitHubRepositoryNameProblem`）に委ねてある ──
 * Main が受け取った後に通すのと**同じ関数**で、ここが持つのは文言だけになる
 * （ブランチ名・Commit メッセージと同じ分担）。
 *
 * ## 「その名前が空いているか」はここで見ない
 *
 * 見ようがない（GitHub にしか分からない）。押した結果として Main が
 * `github-repository-exists` を返す ── 条件を Main と二重に持たないのは
 * ブランチの作成と同じ判断になる（gitBranches.ts）。
 */

/**
 * 公開の目印（`toGitOperationKey` が作るものと同じ枠に入る）。
 *
 * Commit / Push と同じく関数ではなく定数にしてある ── 対象を1つしか
 * 持てない操作で、**同時に2つ走ってよいものが無い。**
 */
export const GITHUB_PUBLISH_OPERATION_KEY = 'github-publish'

/** gh の状態の今の姿（フックが持つ形）。 */
export interface GitHubStatusState {
  readonly status: 'loading' | 'ready' | 'cli-missing' | 'signed-out' | 'failed'
}

/** 面を開いた直後の姿（まだ何も届いていない）。 */
export const INITIAL_GITHUB_STATUS: GitHubStatusState = { status: 'loading' }

/** 応答（shared の型）を、画面が持つ形へ写す。 */
export function toGitHubStatusState(availability: GitHubAvailability): GitHubStatusState {
  return { status: availability.status }
}

/**
 * gh を入れるための1行。
 *
 * **アプリからは入れない**（設計判断）── インストーラを起動する、
 * ましてや裏で入れることはしない。ここに置いてあるのは
 * 「**利用者が自分で打てる文字列**」1つで、Terminal パネルへ貼れば済む。
 *
 * winget を選んでいるのは、Windows 11 に最初から入っているためになる
 * （v1 の対象は Windows。DESIGN.md §8）。
 */
export const GITHUB_CLI_INSTALL_COMMAND = 'winget install --id GitHub.cli'

/** 公開の面に出す案内1つ分。 */
export interface GitHubStatusNotice {
  readonly title: string
  /** 次の一手。 */
  readonly description: string
  /**
   * そのまま打てるコマンド。無ければ null。
   *
   * 文章と分けてあるのは、**選んで写せる形**で出すため
   * （renderer/src/git/GitHubPublishForm.tsx）── 文章の中に混ぜると、
   * 前後の助詞まで一緒に選ばれる。
   */
  readonly command: string | null
}

/**
 * gh の状態の案内。名前を打てる状態（`ready`）なら null。
 *
 * **「できません」で終わらせない**（gitRepositoryMessage.ts と同じ）──
 * どの状態にも次の一手を添える。
 */
export function describeGitHubStatus(state: GitHubStatusState): GitHubStatusNotice | null {
  switch (state.status) {
    case 'ready':
      return null

    case 'loading':
      return {
        title: 'GitHub CLI を確認しています…',
        description: '少しお待ちください。',
        command: null
      }

    case 'cli-missing':
      return {
        title: 'GitHub CLI が見つかりませんでした。',
        /*
          入れた後に押し直せば、そのまま使える（実行ファイルの解決を
          覚えていないため。main/github/githubExecutable.ts）。
        */
        description:
          'GitHub への公開には GitHub CLI が必要です。Terminal パネルで次のコマンドを実行してインストールし、「もう一度確認する」を押してください。',
        command: GITHUB_CLI_INSTALL_COMMAND
      }

    case 'signed-out':
      return {
        title: 'GitHub にログインしていません。',
        /*
          Fluvix Nexus は認証情報を持たない（設計判断 7）── ここでも
          ID とパスワードを尋ねる欄は作らず、gh に任せる。
        */
        description:
          'Terminal パネルで次のコマンドを実行して GitHub にログインし、「もう一度確認する」を押してください。',
        command: 'gh auth login'
      }

    case 'failed':
      return {
        title: 'GitHub CLI の状態を確認できませんでした。',
        description: 'もう一度お試しください。詳しい内容はアプリのログに記録されています。',
        command: null
      }
  }
}

/**
 * Workspace の名前から、欄の初期値を作る。
 *
 * ## 直せるものは直し、直せなければ空にする
 *
 * フォルダ名には repository 名に使えない字が普通に入る（空白・日本語・
 * `()`）。**使えない字のかたまりを `-` 1つに置き換える**ことで、
 * `My Project` は `My-Project` になり、そのまま押せる。
 *
 * これは「打った名前を勝手に変える」のとは違う ── 変えているのは
 * **こちらが提案した初期値**で、欄には結果が見えていて、いつでも
 * 打ち直せる（`prepareGitHubRepositoryName` が中の空白を落とさないのは
 * その逆の場面にあたる。shared/github/repositoryName.ts）。
 *
 * 置き換えても通らない名前（日本語だけのフォルダ名など）は**空にする** ──
 * `--` のような意味の無い文字列を初期値として置くより、空欄から打ち始める方が早い。
 */
export function toGitHubRepositoryNameSuggestion(workspaceName: string): string {
  const replaced = workspaceName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // 先頭と末尾の `-` / `.` は形として通らない（shared/github/repositoryName.ts）。
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')

  return findGitHubRepositoryNameProblem(replaced) === null ? replaced : ''
}

/**
 * 打った名前で公開できるか、できないならなぜか。
 *
 * `toGitBranchCreateReadiness`（gitBranches.ts）とまったく同じ考え方で、
 * **押せる / 押せないを決める場所に理由も一緒に持たせる。**
 *
 * 空のときだけ理由を言わない（`note` は「何が起きるか」に留める）── 打つ前から
 * 「名前を入力してください」と出るのは、まだ何も間違えていない人に
 * 間違いを知らせる形になる。
 *
 * gh の状態も同じ場所で見る ── 押せない理由が「名前」と「gh」の2つに
 * 分かれていると、片方を直した人がもう片方に気づけない。
 */
export function toGitHubPublishReadiness(
  name: string,
  status: GitHubStatusState,
  operating: boolean
): GitActionReadiness {
  const prepared = prepareGitHubRepositoryName(name)
  const problem = findGitHubRepositoryNameProblem(prepared)

  if (status.status !== 'ready') {
    return {
      enabled: false,
      note:
        status.status === 'loading'
          ? 'GitHub CLI を確認しています…'
          : 'GitHub CLI の準備ができていないため公開できません。'
    }
  }

  if (problem === 'empty') {
    return { enabled: false, note: 'GitHub に repository を作って、今のブランチを送ります。' }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitHubRepositoryNameProblem(problem) }
  }

  return { enabled: !operating, note: `${prepared} という repository を作って公開します。` }
}

/**
 * 名前を受け付けられない理由の一言。
 *
 * 分類そのものは shared（`GitHubRepositoryNameProblem`）が持ち、ここは文言だけを持つ。
 * **何が使えるかを具体的に書く** ── 「使えない文字が含まれています」だけでは、
 * どれを消せばよいのかが分からない。
 */
export function describeGitHubRepositoryNameProblem(problem: GitHubRepositoryNameProblem): string {
  switch (problem) {
    case 'empty':
      return 'repository 名を入力してください。'

    case 'too-long':
      return 'repository 名が長すぎます。'

    case 'invalid-characters':
      return 'repository 名に使えるのは、英数字と - _ . だけです。'

    case 'invalid-shape':
      return 'この形の repository 名は使えません（先頭の - や .、末尾の .git をご確認ください）。'
  }
}

/**
 * 公開範囲の選択肢。
 *
 * **`private` を先に置く**（既定でもある）── 押し間違いが
 * 「世界中から見える」になる側を、既定にも1つめにもしない
 * （shared/github/publish.ts）。
 */
export const GITHUB_VISIBILITY_CHOICES = [
  {
    value: 'private',
    label: '非公開（private）',
    note: '自分だけが見られます。あとから GitHub 側で公開に変えられます。'
  },
  {
    value: 'public',
    label: '公開（public）',
    note: '誰でも見られます。送った内容は取り消しても記録が残ることがあります。'
  }
] as const
