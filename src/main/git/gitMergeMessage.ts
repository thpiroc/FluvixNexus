import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { showMergeMessagePath, stripMessageComments } from './gitCommands'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * git が用意したマージ commit のメッセージ（Session 3-8-22A）。
 *
 * ## 3-8-20 が残していた「白紙の Commit 欄」を埋める
 *
 * 3-8-20 でマージを始められるようになり、3-8-18 の解決 → 3-8-4 の Commit で
 * マージを完結できるようになった。ただしその Commit は**利用者が文章を
 * 打たないと押せない**（`toGitCommitReadiness` は空を通さない）── 端末の
 * `git merge` なら `Merge branch 'feature'` が既定で入るところに、アプリでは
 * 白紙が出ていた。マージを完結させる最後の一手だけが、他のどの Commit よりも
 * 手間がかかる状態にあたる。
 *
 * ## `.git/MERGE_MSG` と決め打ちしない
 *
 * `verifyMergeHead` が `.git/MERGE_HEAD` を直接見に行かない理由
 * （`.git` の中の置き方をアプリが知っていることにしない）は、こちらにも
 * そのまま効く。違うのは**中身が要る**ことで、終了コードだけでは済まない。
 *
 * そこで2段にしてある ──
 *
 *   1. どこに在るかを git に聞く（`rev-parse --git-path MERGE_MSG`）
 *   2. **返ってきた場所**を読む
 *
 * 置き方を知っているのは最後まで git で、アプリはその答えを使うだけになる。
 * worktree 形式でも `GIT_DIR` が別の場所でも、聞き先が変わらない。
 *
 * ## コメント行は git に落とさせる
 *
 * `MERGE_MSG` には git が書いたコメント行が入る（競合したマージなら
 * `# Conflicts:` とその一覧）。アプリの Commit は `--cleanup=whitespace` 固定で
 * **コメントを落とさない**ので、そのまま渡すと履歴に入る。
 *
 * 落とす規則を自分で書かないのは、コメントの印が `#` とは限らないため
 * （`core.commentChar`）── `git stripspace --strip-comments` に通す
 * （main/git/gitCommands.ts）。
 *
 * ## どの段で失敗しても null
 *
 * マージの途中でない・ファイルが無い・読めない・git が動かない ── どれも
 * 「既定値が無い」だけで、Commit そのものは今までどおり打てば通る。
 * **失敗として返さない**のは、失敗にすると入力欄の下に理由が出ることになり、
 * *何も損なわれていないのに*直し方を探させることになるため。
 */

const log = createLogger('git')

/** 応答がそのまま持つ形。 */
export interface GitMergeMessageOutcome {
  readonly workspaceId: string | null
  readonly message: string | null
}

/**
 * 今の Workspace のマージ commit の既定メッセージを1回読む。
 *
 * 順番待ちを通す ── 読んでいる最中に Commit / 中止が走ると、途中で消える
 * ファイルを読むことになる（`describeGitRepository` と同じ理由）。
 */
export async function describeGitMergeMessage(): Promise<GitMergeMessageOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    /*
      マージの途中でなければ、ファイルを探しにも行かない。

      git は Commit が済むと `MERGE_MSG` を消すので（実物で確かめてある）、
      「在るかどうか」で判断してもたいていは同じ答えになる。それでも
      **状態の側で決めている**のは、ファイルの後始末を git がいつ行うかに
      画面の中身を預けないためになる ── `verifyMergeHead` が
      `.git/MERGE_HEAD` を見に行かないのと同じ構えで、聞く相手は状態にする。
    */
    if (before.repository.status !== 'ready' || before.repository.inProgress !== 'merge') {
      return { workspaceId: before.workspaceId, message: null }
    }

    return { workspaceId: before.workspaceId, message: await readMergeMessage() }
  })
}

/**
 * `MERGE_MSG` を読んで、コメント行を落とした本文を返す。読めなければ null。
 *
 * 順番待ちの枠の中から呼ぶ（この関数自身は枠を取らない）。
 */
async function readMergeMessage(): Promise<string | null> {
  const located = await runGit(showMergeMessagePath())

  if (located.status !== 'completed' || located.exitCode !== 0) {
    return null
  }

  /*
    `--git-path` は**ファイルが無くても**パスを出して 0 で終わる ──
    在るかどうかを決めるのは、次の読み取りになる。
  */
  const reported = located.stdout.trim()

  if (reported.length === 0) {
    return null
  }

  /*
    **返るのは相対パス**（`.git/MERGE_MSG`。実物で確かめてある）。

    git はそれをリポジトリ root から見た位置として出しており、`runGit` も
    そこを作業ディレクトリにして動かしている（main/git/runGit.ts）。
    Node の側の作業ディレクトリはまったく別の場所なので、そのまま
    `readFile` へ渡すと**アプリの起動フォルダの下**を読みに行くことになる。

    起点は今の Workspace の root にする ── `ready` である以上それは
    リポジトリ root と同じで（ARCHITECTURE.md §14.4）、git が見ていたものと
    同じ場所になる。`resolve` は絶対パスが返ってきた場合もそのまま通す
    （`--git-path` は `GIT_DIR` が外に在れば絶対パスを返す）。
  */
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return null
  }

  const raw = await readMergeMessageFile(resolve(workspace.rootPath, reported))

  if (raw === null) {
    return null
  }

  const stripped = await runGit(stripMessageComments(), { input: raw })

  if (stripped.status !== 'completed' || stripped.exitCode !== 0) {
    /*
      落とせなかったものを、そのまま既定値にしない ── コメント行が入ったまま
      Commit されうる（`--cleanup=whitespace` は落とさない）。
      既定値が出ないだけなら、利用者は今までどおり自分で打てる。
    */
    log.info('git stripspace did not complete; no default merge message will be offered.')
    return null
  }

  const message = stripped.stdout.trim()

  return message.length === 0 ? null : message
}

/**
 * git が指した場所を読む。無い・読めないは null（失敗として投げない）。
 *
 * ここが git ドメインで唯一 `.git` の中のファイルを読む場所になる。
 * **場所を組み立てていない**ことがその条件で、渡ってくるのは
 * `rev-parse --git-path` が返した文字列そのものにあたる。
 */
async function readMergeMessageFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // マージの途中でも、git が書いていないことはありうる（`--no-commit` など）。
    return null
  }
}
