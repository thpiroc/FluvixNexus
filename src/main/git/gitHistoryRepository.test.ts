import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { GIT_COMMIT_HISTORY_LIMIT, type GitCommitHistory, type GitCommitSummary } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する履歴の検証（Session 3-8-11）。
 *
 * ## ここで固定したいのは「git が実際に何を返すか」
 *
 * `gitOutput.test.ts`（`readCommitHistory`）が固定するのは「この文字列をこう読む」
 * までで、**git が本当にその文字列を出すのか**は誰も確かめていない ── 出力の形を
 * 決めるのは実装ではなく git だからで、写しを相手にするとその答えを自分で書くことに
 * なる（3-8-2 以降の各セッションと同じ立て付け）。
 *
 * 実物でしか確かめられないのは次の6つになる。
 *
 *   - **commit が1つも無いリポジトリで、失敗にならない**こと（`git log` は非0で終わる）
 *   - 要約に空白・記号・日本語・空が入っても、**欄がずれない**こと
 *   - マージ commit の親が**2として返る**こと（`%P`）
 *   - 日時が**リポジトリの設定（`log.date`）に振り回されない**こと（`%at`）
 *   - 上限（100）で切られ、切られたことが分かること
 *   - **rev を渡していない**ので、ブランチを切り替えると履歴もそちらになること
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `listGitCommits` で、その下の runGit / gitCommands / gitQueue /
 * gitRepository / gitOutput はすべて本番のものが動く。差し替えるのは2つだけ
 * （electron の logger と、現在の Workspace）。
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

/** テストごとに作る一時領域。 */
let area: string
/** 利用者が開いている作業リポジトリ。 */
let root: string

/** Main が持つ「今の Workspace」。 */
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { listGitCommits } = await import('./gitHistory')

/** 指定した場所で git を1回動かす（テスト自身の準備・確認用）。 */
function gitIn(cwd: string, ...args: readonly string[]): string {
  return execFileSync(gitExecutable as string, [...args], {
    cwd,
    env: createGitEnvironment(process.env),
    encoding: 'utf8',
    windowsHide: true
  })
}

/** 作業リポジトリで git を1回動かす。 */
function git(...args: readonly string[]): string {
  return gitIn(root, ...args)
}

/** 作業リポジトリに commit を1つ積む。 */
function commit(message: string, options: { readonly file?: string } = {}): void {
  const file = options.file ?? 'a.txt'

  writeFileSync(join(root, file), `${message}\n`, 'utf8')
  git('add', '--', file)
  git('commit', '--quiet', '--allow-empty-message', '-m', message)
}

/** 応答を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(history: GitCommitHistory): {
  readonly commits: readonly GitCommitSummary[]
  readonly truncated: boolean
} {
  expect(history.status, `ready ではない履歴: ${JSON.stringify(history)}`).toBe('ready')

  return history as Extract<GitCommitHistory, { status: 'ready' }>
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * 開発者の PC に入っている設定（`log.date` / `log.showSignature` /
 * `log.abbrevCommit`）は、**この塊が確かめている振る舞いそのもの**を変えうる ──
 * 見えなくしておかないと、通る PC と通らない PC が出る（gitBranchRepository.test.ts
 * と同じ構え）。
 */
const originalGitConfigEnv = {
  global: process.env.GIT_CONFIG_GLOBAL,
  system: process.env.GIT_CONFIG_SYSTEM
}

/** リポジトリ1つ分の共通設定（環境に結果を左右されないようにする）。 */
function configure(cwd: string): void {
  gitIn(cwd, 'config', 'user.email', 'test@example.com')
  gitIn(cwd, 'config', 'user.name', 'Fluvix Nexus Test')
  gitIn(cwd, 'config', 'core.autocrlf', 'false')
  gitIn(cwd, 'config', 'commit.gpgsign', 'false')
}

beforeEach(async () => {
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-history-')))

  // 実在しないパスを指すと、git はその設定ファイルを空として扱う。
  process.env.GIT_CONFIG_GLOBAL = join(area, 'no-such-gitconfig')
  process.env.GIT_CONFIG_SYSTEM = join(area, 'no-such-system-gitconfig')

  root = join(area, 'work')

  gitIn(area, 'init', '--quiet', '--initial-branch=main', 'work')
  configure(root)

  workspace = {
    id: 'test-workspace',
    rootPath: root,
    displayName: 'work',
    openedAt: Date.now(),
    exists: true
  }
})

afterEach(async () => {
  workspace = null
  restoreEnv('GIT_CONFIG_GLOBAL', originalGitConfigEnv.global)
  restoreEnv('GIT_CONFIG_SYSTEM', originalGitConfigEnv.system)
  delete process.env.GIT_AUTHOR_DATE
  await rm(area, { recursive: true, force: true })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

describeWithGit('listGitCommits', () => {
  it('新しい順に、要約・名乗り・親の数つきで返す', async () => {
    commit('first')
    commit('second')

    const { commits, truncated } = readyOf((await listGitCommits()).history)

    expect(commits.map((entry) => entry.subject)).toEqual(['second', 'first'])
    expect(commits.map((entry) => entry.authorName)).toEqual([
      'Fluvix Nexus Test',
      'Fluvix Nexus Test'
    ])
    // 履歴のいちばん最初だけ親が無い。
    expect(commits.map((entry) => entry.parentCount)).toEqual([1, 0])
    expect(truncated).toBe(false)

    /*
      短い hash は git が決めた長さのまま返る（アプリ側で桁数を決め打ちに
      していないこと）。実 git の `rev-parse --short` と突き合わせる。
    */
    expect(commits[0]?.shortHash).toBe(git('rev-parse', '--short', 'HEAD').trim())
  })

  /*
    `git init` の直後。`git log` はここで**非0で終わる**（HEAD の指す先が無い）──
    そのまま失敗にすると、初期化した直後のリポジトリで
    「履歴を取得できませんでした」と出ることになる。
  */
  it('commit が1つも無いリポジトリでは空で返る（失敗にしない）', async () => {
    const result = await listGitCommits()

    expect(result.history).toEqual({ status: 'ready', commits: [], truncated: false })
  })

  it('要約に空白・記号・日本語が入っていても、欄がずれない', async () => {
    /*
      区切りを NUL にしてある理由そのもの。目に見える文字を区切りにすると、
      その文字を含む要約で名乗りや日時の列がずれる。
    */
    const subject = 'fix: A | B  --force  日本語 %s %h  末尾'

    commit(subject)

    const { commits } = readyOf((await listGitCommits()).history)

    expect(commits[0]?.subject).toBe(subject)
    expect(commits[0]?.authorName).toBe('Fluvix Nexus Test')
  })

  it('メッセージが空の commit も落とさない', async () => {
    commit('first')
    // git は空のメッセージでの commit を作れる（`--allow-empty-message`）。
    commit('')

    const { commits } = readyOf((await listGitCommits()).history)

    expect(commits).toHaveLength(2)
    expect(commits[0]?.subject).toBe('')
    expect(commits[1]?.subject).toBe('first')
  })

  it('マージ commit の親を2として返す', async () => {
    commit('first')
    git('switch', '--quiet', '--create', 'feature')
    commit('on feature', { file: 'feature.txt' })
    git('switch', '--quiet', 'main')
    commit('on main', { file: 'main.txt' })
    git('merge', '--quiet', '--no-ff', '-m', 'merge feature', 'feature')

    const { commits } = readyOf((await listGitCommits()).history)

    expect(commits[0]?.subject).toBe('merge feature')
    expect(commits[0]?.parentCount).toBe(2)
  })

  it('日時が、リポジトリの設定（log.date）に振り回されない', async () => {
    /*
      `%ad` を使っていれば、この設定でここが `Tue Aug 25 ...` のような文字列に
      なる ── `%at`（epoch 秒）は設定に左右されない生の数のまま返る
      （main/git/gitCommands.ts）。`log.showSignature` も一緒に立てておく ──
      この `--format` には `%G?` が無いので今は出力を変えないが、打ち消しごと
      壊れていないことをここで通しておく。
    */
    git('config', 'log.date', 'rfc')
    git('config', 'log.showSignature', 'true')

    process.env.GIT_AUTHOR_DATE = '1756100000 +0900'
    commit('dated')
    delete process.env.GIT_AUTHOR_DATE

    const { commits } = readyOf((await listGitCommits()).history)

    expect(commits[0]?.authoredAt).toBe(1_756_100_000_000)
  })

  it('今のブランチの履歴を返す（切り替えると変わる）', async () => {
    /*
      rev を渡していないこと（HEAD からさかのぼる）の担保。別のブランチの
      履歴を見る手立ては、上のバーでそちらへ切り替えることそのものになる。
    */
    commit('shared')
    git('switch', '--quiet', '--create', 'feature')
    commit('only on feature', { file: 'feature.txt' })

    expect(readyOf((await listGitCommits()).history).commits.map((entry) => entry.subject)).toEqual(
      ['only on feature', 'shared']
    )

    git('switch', '--quiet', 'main')

    expect(readyOf((await listGitCommits()).history).commits.map((entry) => entry.subject)).toEqual(
      ['shared']
    )
  })

  /**
   * 上限に達したら、切ったことを言う。
   *
   * commit は `git commit --allow-empty` を回数ぶん動かして作る ── ブランチ
   * （`update-ref --stdin`）のように1回の git へまとめる手立てが commit には
   * 無いためで、そのぶん待ち時間が要る（このテストだけ上限を延ばしてある）。
   */
  it('上限で切り、切ったことを truncated で伝える', async () => {
    for (let index = 0; index <= GIT_COMMIT_HISTORY_LIMIT; index += 1) {
      git('commit', '--quiet', '--allow-empty', '-m', `c${index}`)
    }

    const { commits, truncated } = readyOf((await listGitCommits()).history)

    expect(commits).toHaveLength(GIT_COMMIT_HISTORY_LIMIT)
    // 新しい方から採る（いちばん最後に積んだものが先頭）。
    expect(commits[0]?.subject).toBe(`c${GIT_COMMIT_HISTORY_LIMIT}`)
    expect(truncated).toBe(true)
  }, 60_000)

  it('Workspace root がリポジトリ root でなければ、履歴を出さない', async () => {
    /*
      設計判断 10（root が食い違えば Git 操作を行わない）は、読むだけの
      履歴にも掛かる ── 一覧を出すということは、そのリポジトリの中身を
      見せるということにあたる。
    */
    commit('first')

    const nested = join(root, 'nested')
    mkdirSync(nested)
    workspace = { ...(workspace as WorkspaceFolder), rootPath: nested }

    expect((await listGitCommits()).history).toEqual({ status: 'not-ready' })
  })
})
