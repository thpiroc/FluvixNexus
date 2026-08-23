import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { GIT_LOCAL_BRANCH_LIMIT, type GitHead, type GitRepositoryState } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対するブランチの一覧 / 切り替え / 作成の検証（Session 3-8-6）。
 *
 * ## ここで固定したいのは「失われないこと」
 *
 * 切り替えは、このアプリが git に頼む操作の中で**唯一、作業ツリーの中身を
 * まるごと書き換える**ものになる。文言の分類（gitFailure.test.ts）だけでは
 * 足りず、実物に対して次を確かめる。
 *
 *   - 書きかけが**上書きされない**（git が断り、ファイルはそのまま）
 *   - 切り替え先が触らないファイルの書きかけは、**切り替えても残る**
 *     （アプリが確認を挟まないという判断が、実際に安全であること）
 *   - 同じ名前で作ろうとしても**上書きしない**（HEAD が動かない）
 *   - remote-tracking branch の名前では**手元にブランチが増えない**（`--no-guess`）
 *   - 今のブランチを選んでも git を動かさない（`nothing-to-do`）
 *   - detached HEAD からでも作れて、切り替えられる
 *   - 一覧は上限で切られ、切られたことが分かる
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `listGitBranches` / `applyGitSwitchBranch` / `applyGitCreateBranch` で、
 * その下の runGit / gitCommands / gitQueue / gitFailure / gitOutput はすべて
 * 本番のものが動く。差し替えるのは2つだけ（electron の logger と、現在の Workspace）。
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

/** テストごとに作る一時領域（この下に作業リポジトリと remote が並ぶ）。 */
let area: string
/** 利用者が開いている作業リポジトリ。 */
let root: string
/** remote（bare）。繋ぐのは remote-tracking を作る回だけ。 */
let remotePath: string

/** Main が持つ「今の Workspace」。 */
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { listGitBranches, applyGitSwitchBranch, applyGitCreateBranch } =
  await import('./gitBranches')

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

function writeFile(relativePath: string, content: string): void {
  writeFileSync(join(root, relativePath), content, 'utf8')
}

function readFile(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

/** 作業リポジトリに commit を1つ積む。 */
function commit(relativePath: string, content: string, message: string): void {
  writeFile(relativePath, content)
  git('add', '--', relativePath)
  git('commit', '--quiet', '-m', message)
}

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

function headOf(repository: GitRepositoryState): GitHead {
  return readyOf(repository).head
}

/** 手元にある**ローカル**ブランチの名前（テスト自身の確認用）。 */
function localBranchNames(): readonly string[] {
  return git('for-each-ref', '--format=%(refname:short)', 'refs/heads/')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * 開発者の PC に入っている設定（`checkout.defaultRemote` / `merge.autoStash` /
 * `branch.autoSetupMerge`）は、**この塊が確かめている振る舞いそのもの**を変えうる ──
 * 見えなくしておかないと、通る PC と通らない PC が出る。
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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-branch-')))

  // 実在しないパスを指すと、git はその設定ファイルを空として扱う。
  process.env.GIT_CONFIG_GLOBAL = join(area, 'no-such-gitconfig')
  process.env.GIT_CONFIG_SYSTEM = join(area, 'no-such-system-gitconfig')

  root = join(area, 'work')
  remotePath = join(area, 'remote.git')

  gitIn(area, 'init', '--bare', '--initial-branch=main', 'remote.git')
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
  await rm(area, { recursive: true, force: true })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

describeWithGit('listGitBranches', () => {
  it('ローカルブランチを、今どこに居るかの印つきで返す', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature/x')

    const result = await listGitBranches()

    expect(result.listing).toEqual({
      status: 'ready',
      branches: [
        { name: 'feature/x', current: false },
        { name: 'main', current: true }
      ],
      truncated: false
    })
  })

  /*
    `git init` の直後。ブランチ名（main）は出ているのに ref は1つも無い ──
    これは失敗ではなく、正しい答えの1つにあたる。
  */
  it('commit が1つも無いリポジトリでは空で返る（失敗にしない）', async () => {
    const result = await listGitBranches()

    expect(result.listing).toEqual({ status: 'ready', branches: [], truncated: false })
  })

  it('remote-tracking branch は載らない', async () => {
    commit('a.txt', 'a\n', 'first')
    git('remote', 'add', 'origin', remotePath)
    git('push', '--quiet', 'origin', 'main')
    git('fetch', '--quiet')

    const result = await listGitBranches()

    expect(result.listing.status).toBe('ready')
    expect(result.listing.status === 'ready' ? result.listing.branches : []).toEqual([
      { name: 'main', current: true }
    ])
  })

  /**
   * 上限に達したら、切ったことを言う。
   *
   * ref は `update-ref --stdin` で**1回の git**にまとめて作る ── 500 回
   * `git branch` を呼ぶと、確かめたいこと（上限の扱い）に対して待ち時間が
   * 釣り合わない。
   */
  it('上限で切り、切ったことを truncated で伝える', async () => {
    commit('a.txt', 'a\n', 'first')

    const head = git('rev-parse', 'HEAD').trim()
    const commands = Array.from(
      { length: GIT_LOCAL_BRANCH_LIMIT },
      (_unused, index) => `create refs/heads/bulk/${String(index).padStart(4, '0')} ${head}`
    ).join('\n')

    execFileSync(gitExecutable as string, ['update-ref', '--stdin'], {
      cwd: root,
      env: createGitEnvironment(process.env),
      input: `${commands}\n`,
      encoding: 'utf8',
      windowsHide: true
    })

    const result = await listGitBranches()

    expect(result.listing.status).toBe('ready')

    if (result.listing.status !== 'ready') {
      return
    }

    expect(result.listing.branches).toHaveLength(GIT_LOCAL_BRANCH_LIMIT)
    expect(result.listing.truncated).toBe(true)
  })

  it('Workspace が開かれていなければ not-ready', async () => {
    workspace = null

    const result = await listGitBranches()

    expect(result.listing).toEqual({ status: 'not-ready' })
    expect(result.workspaceId).toBeNull()
  })
})

describeWithGit('applyGitCreateBranch', () => {
  it('作って、そのまま切り替わる', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitCreateBranch('feature/x')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'feature/x' })
    // 応答に載っている状態が、そのまま画面に出るもの（もう一度読み直さない）。
    expect(git('symbolic-ref', '--short', 'HEAD').trim()).toBe('feature/x')
  })

  it('同じ名前があれば上書きせずに断る', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature/x')
    commit('b.txt', 'b\n', 'second')

    const before = git('rev-parse', 'feature/x').trim()
    const result = await applyGitCreateBranch('feature/x')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-exists' })
    // 既にあるブランチは1文字も動かない（付け替えない）。
    expect(git('rev-parse', 'feature/x').trim()).toBe(before)
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
  })

  /**
   * detached HEAD からの作成。
   *
   * Push は detached で断る（送り先が決まらない）が、こちらは塞がない ──
   * 今居る commit に名前が付くので、**どこにも属さない commit から
   * 抜け出す手立て**になる。
   */
  it('detached HEAD からでも作れる', async () => {
    commit('a.txt', 'a\n', 'first')
    git('checkout', '--quiet', '--detach', 'HEAD')

    const result = await applyGitCreateBranch('rescue')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'rescue' })
  })

  it('作業ツリーの書きかけは、新しいブランチへそのまま付いてくる', async () => {
    commit('a.txt', 'a\n', 'first')
    writeFile('a.txt', 'work in progress\n')

    const result = await applyGitCreateBranch('feature/x')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readFile('a.txt')).toBe('work in progress\n')
    expect(readyOf(result.repository).changes.unstaged).toHaveLength(1)
  })
})

describeWithGit('applyGitSwitchBranch', () => {
  it('切り替えると、作業ツリーの中身がそのブランチのものになる', async () => {
    commit('a.txt', 'main\n', 'first')
    git('switch', '--quiet', '--create', 'feature/x')
    commit('a.txt', 'feature\n', 'on feature')
    git('switch', '--quiet', 'main')

    const result = await applyGitSwitchBranch('feature/x')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'feature/x' })
    expect(readFile('a.txt')).toBe('feature\n')
  })

  /*
    今のブランチを選んだ。一覧では選べるようにしてあり（印は付く）、
    押しても git は動かさずにここへ落ちる（main/git/gitBranches.ts）。
  */
  it('今のブランチを選んだら nothing-to-do（何も起きない）', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitSwitchBranch('main')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
  })

  it('無い名前は branch-not-found（勝手に作らない）', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitSwitchBranch('feature/typo')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
    expect(localBranchNames()).toEqual(['main'])
  })

  /**
   * `--no-guess` が効いていること（Session 3-8-6 の範囲を決めている引数）。
   *
   * 既定の `git switch` は、その名前の remote-tracking branch を見つけると
   * **手元にブランチを作って追跡先まで設定する。** 一覧に出していないものが
   * 名前を渡しただけで生えることになるので、止めてある。
   */
  it('remote-tracking branch の名前では、手元にブランチが増えない', async () => {
    commit('a.txt', 'a\n', 'first')
    git('remote', 'add', 'origin', remotePath)
    git('push', '--quiet', 'origin', 'main')
    // remote 側にだけあるブランチを作って、取ってくる。
    gitIn(remotePath, 'branch', 'remote-only', 'main')
    git('fetch', '--quiet')

    expect(git('rev-parse', '--verify', 'refs/remotes/origin/remote-only').trim().length).toBe(40)

    const result = await applyGitSwitchBranch('remote-only')

    // git の断り方は「無い名前」を渡したときとまったく同じになる。
    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
    expect(localBranchNames()).toEqual(['main'])
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
  })

  describe('作業ツリーの書きかけ', () => {
    /**
     * このセッションでいちばん起こしてはいけないこと。
     *
     * `--force` も `--merge` も渡していないので、切り替え先が触るファイルに
     * 書きかけがあれば git は**上書きせずに断る。** アプリが確認を挟まずに
     * 頼めるのは、この振る舞いが土台にあるからになる。
     */
    it('切り替え先が触るファイルに書きかけがあれば、断られて何も失われない', async () => {
      commit('a.txt', 'main\n', 'first')
      git('switch', '--quiet', '--create', 'feature/x')
      commit('a.txt', 'feature\n', 'on feature')
      git('switch', '--quiet', 'main')
      writeFile('a.txt', 'work in progress\n')

      const result = await applyGitSwitchBranch('feature/x')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'local-changes-blocked' })
      // 書きかけも、今居る場所も動かない。
      expect(readFile('a.txt')).toBe('work in progress\n')
      expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
    })

    /**
     * 逆側の保証。
     *
     * 切り替え先が触らないファイルの書きかけは、**切り替えても残る。**
     * アプリが「未保存の変更があります」と一律に確認を出す形にすると、
     * この普通の使い方（別の枝で続きを見る）まで止めることになる。
     */
    it('切り替え先が触らないファイルの書きかけは、切り替えても残る', async () => {
      commit('a.txt', 'main\n', 'first')
      git('switch', '--quiet', '--create', 'feature/x')
      commit('b.txt', 'feature\n', 'on feature')
      git('switch', '--quiet', 'main')
      writeFile('a.txt', 'work in progress\n')

      const result = await applyGitSwitchBranch('feature/x')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(readFile('a.txt')).toBe('work in progress\n')
      expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'feature/x' })
    })

    /*
      未追跡のファイルも同じ（git は上書きしない）。Editor で作ったばかりの
      ファイルが、切り替えで消えることはない。
    */
    it('未追跡のファイルは切り替えても残る', async () => {
      commit('a.txt', 'main\n', 'first')
      git('branch', 'feature/x')
      writeFile('draft.md', 'draft\n')

      const result = await applyGitSwitchBranch('feature/x')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(readFile('draft.md')).toBe('draft\n')
    })
  })

  /**
   * 競合が残っている間は、git を動かす前に断る。
   *
   * 動かしても git は断るが、先に分けておけば「押したのに何も変わらない」を
   * 作らずに理由だけを出せる（Pull と同じ判断）。
   */
  it('競合が残っていたら unresolved-conflicts', async () => {
    commit('a.txt', 'main\n', 'first')
    git('switch', '--quiet', '--create', 'feature/x')
    commit('a.txt', 'feature\n', 'on feature')
    git('switch', '--quiet', 'main')
    commit('a.txt', 'main changed\n', 'on main')

    // 競合させる（終了コードは非0になるので、失敗として扱わない）。
    try {
      git('merge', 'feature/x')
    } catch {
      // 競合は想定どおり。
    }

    const result = await applyGitSwitchBranch('feature/x')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'unresolved-conflicts' })
  })

  it('detached HEAD からブランチへ戻れる', async () => {
    commit('a.txt', 'a\n', 'first')
    git('checkout', '--quiet', '--detach', 'HEAD')

    const result = await applyGitSwitchBranch('main')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
  })

  it('Workspace が開かれていなければ not-ready', async () => {
    workspace = null

    const result = await applyGitSwitchBranch('main')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})
