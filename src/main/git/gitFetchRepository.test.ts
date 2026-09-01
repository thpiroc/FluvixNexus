import { execFileSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitRepositoryState } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する fetch の検証（Session 3-8-22A）。
 *
 * ## ここで固定したいのは「取ってくるが、取り込まない」
 *
 * 3-8-5 の Pull は `fetch` → `merge --ff-only` の2つで、**追跡先が無ければ
 * 押せない**（`no-upstream`）。3-8-22A で足した口はその前半だけを切り出した
 * もので、押せる条件も、動いた後に変わるものも違う。
 *
 * 実物にしか確かめられないのは次の 8 個。
 *
 *  1. remote に増えた枝が、手元の `refs/remotes/` に現れる
 *  2. **`--prune` で、相手から消えた枝が手元の一覧からも消える**
 *  3. ローカルブランチと commit は1つも失われない（消えるのは追跡の写しだけ）
 *  4. **HEAD も index も作業ツリーも動かない**（取り込まない）
 *  5. **追跡先が無いブランチでも通る**（Pull が断る条件が当てはまらない）
 *  6. detached HEAD でも通る（同上）
 *  7. remote が1つも無くても失敗にしない（取ってくるものが無いだけ）
 *  8. 取ってきた結果が `behind` として状態に出る（Pull を押す手掛かりになる）
 *
 * 2 と 5 がこの回の要点にあたる ── 2 は Pull の中の `fetch` と**引数を
 * 分けた理由**そのもので、5 は**この口を足した理由**そのものになる
 * （3-8-19 の一覧を新しくする手立てが、それまでアプリの中に無かった）。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `applyGitFetch` で、その下の runGit / gitCommands / gitQueue /
 * gitFailure / gitRepository はすべて本番のものが動く。差し替えるのは2つだけ
 * （electron の logger と、現在の Workspace）。
 *
 * remote は**同じ PC の bare リポジトリ**にしてある（3-8-5 と同じ構え）──
 * ネットワークにも認証にも触らずに、本物の `git fetch` を通せる。
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

/** テストごとに作る一時領域。 */
let area: string
/** 利用者が開いている作業リポジトリ。 */
let root: string
/** remote（bare）。 */
let remotePath: string

/** Main が持つ「今の Workspace」。 */
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { applyGitFetch } = await import('./gitFetch')

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

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

/** 今ある remote-tracking branch の名前（`origin/HEAD` は除く）。 */
function remoteTrackingBranches(): readonly string[] {
  return git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith('/HEAD'))
}

/** 今あるローカルブランチの名前。 */
function localBranches(): readonly string[] {
  return git('for-each-ref', '--format=%(refname:short)', 'refs/heads/')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-fetch-')))

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

/** 最初の commit を1つ積んで、remote へ送る（追跡先も付く）。 */
function publishMain(): void {
  writeFileSync(join(root, 'f.txt'), 'base\n', 'utf8')
  git('add', '--', 'f.txt')
  git('commit', '--quiet', '-m', 'base')
  git('remote', 'add', 'origin', remotePath)
  git('push', '--quiet', '--set-upstream', 'origin', 'main')
}

/**
 * remote 側に枝を1つ増やす / 消す。
 *
 * 別の作業コピーから操作する ── **手元のリポジトリを経由しない**のが要点で、
 * これで「他の人が枝を作った / 消した」という状態が作れる。
 */
function withOtherClone(run: (other: string) => void): void {
  const other = join(area, `other-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  gitIn(area, 'clone', '--quiet', remotePath, other)
  configure(other)
  run(other)
}

/** 実 git を何本も起動するテストの待ち時間（3-8-20 で決めた理由のまま）。 */
const REAL_GIT_TIMEOUT_MS = 30_000

describeWithGit('applyGitFetch', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('remote に増えた枝が、手元の一覧に現れる', async () => {
    publishMain()

    withOtherClone((other) => {
      gitIn(other, 'switch', '--quiet', '--create', 'feature/x')
      writeFileSync(join(other, 'g.txt'), 'x\n', 'utf8')
      gitIn(other, 'add', '--', 'g.txt')
      gitIn(other, 'commit', '--quiet', '-m', 'feature')
      gitIn(other, 'push', '--quiet', 'origin', 'feature/x')
    })

    // 押す前は見えていない（3-8-19 の一覧が「最後に取得した時点の写し」である証拠）。
    expect(remoteTrackingBranches()).not.toContain('origin/feature/x')

    const result = await applyGitFetch()

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(remoteTrackingBranches()).toContain('origin/feature/x')
  })

  /*
    **`--prune` を付けた理由そのもの。**

    付けないと、相手から消えた枝が一覧に残り続ける ── 選んでも
    「同名のローカルブランチを作る」だけの行になり、3-8-19 の面が
    嘘をつく（Pull の中の `fetch` には付けていない。理由は
    main/git/gitCommands.ts）。
  */
  it('相手から消えた枝が、手元の一覧からも消える（--prune）', async () => {
    publishMain()

    withOtherClone((other) => {
      gitIn(other, 'switch', '--quiet', '--create', 'gone')
      gitIn(other, 'push', '--quiet', 'origin', 'gone')
    })

    expect((await applyGitFetch()).outcome).toEqual({ status: 'applied' })
    expect(remoteTrackingBranches()).toContain('origin/gone')

    withOtherClone((other) => {
      gitIn(other, 'push', '--quiet', 'origin', '--delete', 'gone')
    })

    expect((await applyGitFetch()).outcome).toEqual({ status: 'applied' })
    expect(remoteTrackingBranches()).not.toContain('origin/gone')
  })

  /*
    消えるのは**追跡の写しだけ**。ローカルブランチも commit も1つも
    失われない ── `--prune` を「消す操作」として恐れなくてよい根拠になる。
  */
  it('ローカルブランチと commit は、prune で1つも失われない', async () => {
    publishMain()

    withOtherClone((other) => {
      gitIn(other, 'switch', '--quiet', '--create', 'gone')
      gitIn(other, 'push', '--quiet', 'origin', 'gone')
    })

    await applyGitFetch()

    // 手元にも同じ名前で作っておく（消えてはいけない側）。
    git('switch', '--quiet', '--create', 'gone', 'origin/gone')
    git('switch', '--quiet', 'main')

    const localCommit = git('rev-parse', 'gone').trim()

    withOtherClone((other) => {
      gitIn(other, 'push', '--quiet', 'origin', '--delete', 'gone')
    })

    expect((await applyGitFetch()).outcome).toEqual({ status: 'applied' })

    expect(remoteTrackingBranches()).not.toContain('origin/gone')
    expect(localBranches()).toContain('gone')
    expect(git('rev-parse', 'gone').trim()).toBe(localCommit)
  })

  /*
    **取り込まない。** Pull との違いがこれで、押しても手元の中身は
    1文字も変わらない（変わるのは `refs/remotes/` だけ）。
  */
  it('HEAD も index も作業ツリーも動かさない', async () => {
    publishMain()

    withOtherClone((other) => {
      writeFileSync(join(other, 'f.txt'), 'remote-changed\n', 'utf8')
      gitIn(other, 'commit', '--quiet', '-am', 'remote')
      gitIn(other, 'push', '--quiet', 'origin', 'main')
    })

    // 手元には未コミットの変更も置いておく（消えてはいけない側）。
    writeFileSync(join(root, 'work.txt'), 'wip\n', 'utf8')
    git('add', '--', 'work.txt')

    const headBefore = git('rev-parse', 'HEAD').trim()
    const treeBefore = git('rev-parse', 'HEAD^{tree}').trim()

    expect((await applyGitFetch()).outcome).toEqual({ status: 'applied' })

    expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore)
    expect(git('rev-parse', 'HEAD^{tree}').trim()).toBe(treeBefore)
    // 作業ツリーの中身も、stage したものもそのまま。
    expect(git('show', ':work.txt')).toBe('wip\n')
    expect(git('show', 'HEAD:f.txt')).toBe('base\n')
  })

  /*
    **この口を足した理由そのもの。**

    Pull は追跡先が無ければ `no-upstream` で断る（main/git/gitSync.ts）──
    つまり追跡先の無いブランチに居るあいだ、3-8-19 の一覧を新しくする
    手立てがアプリの中に1つも無かった。
  */
  it('追跡先が無いブランチでも通る（Pull が断る条件が当てはまらない）', async () => {
    publishMain()
    // 追跡先を持たない枝へ移る。
    git('switch', '--quiet', '--create', 'local-only')

    expect(readyOf((await applyGitFetch()).repository).upstream).toBeNull()

    withOtherClone((other) => {
      gitIn(other, 'switch', '--quiet', '--create', 'from-remote')
      gitIn(other, 'push', '--quiet', 'origin', 'from-remote')
    })

    const result = await applyGitFetch()

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(remoteTrackingBranches()).toContain('origin/from-remote')
  })

  it('detached HEAD でも通る', async () => {
    publishMain()
    git('switch', '--quiet', '--detach', 'HEAD')

    const result = await applyGitFetch()

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readyOf(result.repository).head.kind).toBe('detached')
  })

  /*
    remote が1つも無い場合。`git fetch` は取ってくるものが無いだけで 0 で
    終わる ── Push の `Everything up-to-date` を `nothing-to-do` にしたのとは
    逆の判断で、**押した意味はあった**という結末にあたる
    （main/git/gitFetch.ts）。
  */
  it('remote が1つも無くても失敗にしない', async () => {
    writeFileSync(join(root, 'f.txt'), 'base\n', 'utf8')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'base')

    const result = await applyGitFetch()

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readyOf(result.repository).hasRemote).toBe(false)
  })

  /*
    取ってきた結果は、上のバーの `↓1` として出る ── そこから先は Pull を
    押す、という導線がそれで繋がる（1つのボタンが「取ってくる」と
    「取り込む」を兼ねない、という 3-8-22A の判断の裏返し）。
  */
  it('取ってきた結果が behind として状態に出る', async () => {
    publishMain()

    withOtherClone((other) => {
      writeFileSync(join(other, 'f.txt'), 'remote-changed\n', 'utf8')
      gitIn(other, 'commit', '--quiet', '-am', 'remote')
      gitIn(other, 'push', '--quiet', 'origin', 'main')
    })

    const result = await applyGitFetch()

    expect(readyOf(result.repository).upstream).toEqual({
      name: 'origin/main',
      ahead: 0,
      behind: 1
    })
  })

  it('Workspace が閉じられていれば git を動かさない', async () => {
    workspace = null

    const result = await applyGitFetch()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})
