import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { GIT_REMOTE_BRANCH_LIMIT, type GitHead, type GitRepositoryState } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する remote-tracking branch の一覧と、そこからのブランチ作成の検証
 * （Session 3-8-19）。
 *
 * ## ここで固定したいのは「指していないものを相手にしないこと」
 *
 * 3-8-6 / 3-8-13 の検証（gitBranchRepository.test.ts）が「**失われないこと**」を
 * 固定していたのに対し、こちらが固定したいのは
 * **押した人が指したものだけが相手になる**ことになる。
 *
 *   - symbolic HEAD（`origin/HEAD`）が一覧に**載らない**
 *   - remote 名に `/` が入っていても、既定のローカル名が正しく切れる
 *   - 同じ名前のローカルブランチがあれば、**git を動かす前に**断る
 *     （上書きしない・消さない・そのブランチへ切り替えない）
 *   - ローカルブランチ名を始点として渡しても**作らない**
 *     （渡せば git は `branch.<名前>.remote=.` を書いて通してしまう）
 *   - `origin/HEAD` を始点として渡しても**作らない**
 *   - 作れたときは**追跡先が必ず付く**（`--track` を明示している効き目）
 *
 * ## 「一覧に無いものは指せない」を、実物で確かめる
 *
 * 3-8-6 の `--no-guess` は「remote-tracking branch の名前で切り替えても
 * 手元にブランチが増えない」ことを担保していた。3-8-19 は**その逆の口を
 * 開ける**回にあたるので、開けた口が指せる範囲を実物で閉じておく。
 *
 * ## ネットワークへ出ない
 *
 * 一覧も作成も fetch を1回も動かさない ── したがってこの塊の準備でだけ
 * `git push` / `git fetch` を使い、**検証対象の関数はローカルの
 * `refs/remotes/` しか読まない。**
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `listGitRemoteBranches` / `applyGitCreateTrackingBranch` で、
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
/** remote（bare）。 */
let remotePath: string

/** Main が持つ「今の Workspace」。 */
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { listGitRemoteBranches, applyGitCreateTrackingBranch } = await import('./gitRemoteBranches')

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

/** そのブランチの追跡先（無ければ null）。 */
function upstreamOf(branch: string): string | null {
  const remote = configOf(`branch.${branch}.remote`)
  const merge = configOf(`branch.${branch}.merge`)

  return remote === null || merge === null ? null : `${remote} ${merge}`
}

function configOf(key: string): string | null {
  try {
    return git('config', '--get', key).trim()
  } catch {
    // 設定されていなければ `git config --get` は 1 で終わる。
    return null
  }
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * 3-8-6 の塊と同じ理由（開発者の PC の設定で結果が変わらないようにする）だが、
 * ここでは効くものが1つ増える ── **`branch.autoSetupMerge`**。`false` に
 * してある PC では、`--track` を明示していなければ追跡先が付かない。
 * 見えなくしたうえで「追跡先が付く」ことを確かめるのは、
 * `--track` を明示している効き目そのものを固定するためになる。
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

/**
 * remote を1つ繋いで、`main` と `feature/x` を送ってから取り直す。
 *
 * 3-8-19 の検証はどれも「手元の `refs/remotes/` に何か在る」ところから
 * 始まるので、その準備をここへまとめてある。
 */
function connectOrigin(name = 'origin'): void {
  git('remote', 'add', name, remotePath)
  git('push', '--quiet', name, 'main')
  git('push', '--quiet', name, 'feature/x')
  git('fetch', '--quiet', name)
}

beforeEach(async () => {
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-remote-branch-')))

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

describeWithGit('listGitRemoteBranches', () => {
  it('remote-tracking branch を、既定のローカル名つきで返す', () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature/x')
    connectOrigin()

    return listGitRemoteBranches().then((result) => {
      expect(result.listing).toEqual({
        status: 'ready',
        branches: [
          { name: 'origin/feature/x', branch: 'feature/x' },
          { name: 'origin/main', branch: 'main' }
        ],
        truncated: false
      })
      expect(result.hasRemote).toBe(true)
    })
  })

  /*
    3-8-6 の一覧が remote-tracking を載せなかったのと**対になる**確認。
    こちらにローカルブランチが混ざると、同じ面の上下で同じ名前が2度出る。
  */
  it('ローカルブランチは載らない', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature/x')
    git('branch', 'local-only')
    connectOrigin()

    const result = await listGitRemoteBranches()

    expect(result.listing.status).toBe('ready')
    expect(result.listing.status === 'ready' ? result.listing.branches : []).toEqual([
      { name: 'origin/feature/x', branch: 'feature/x' },
      { name: 'origin/main', branch: 'main' }
    ])
  })

  /*
    `origin/HEAD` は、その remote の既定ブランチを指す**別名**にあたる ──
    載せると、指した先が別の行（`origin/main`）と同じになる選択肢が並ぶ。
  */
  it('symbolic HEAD（origin/HEAD）は載らない', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature/x')
    connectOrigin()
    git('remote', 'set-head', 'origin', 'main')

    // 準備が効いていること自体を確かめる（ref が実在しないと素通りしてしまう）。
    expect(git('for-each-ref', '--format=%(refname)', 'refs/remotes/')).toContain(
      'refs/remotes/origin/HEAD'
    )

    const result = await listGitRemoteBranches()
    const names =
      result.listing.status === 'ready' ? result.listing.branches.map((b) => b.name) : []

    expect(names).toEqual(['origin/feature/x', 'origin/main'])
  })

  /*
    git の `%(refname:lstrip=3)` はここを `stream/feature/x` と切ってしまう ──
    名前の一覧と突き合わせているのは、この1件を正しく切るためにあたる。
    既定値を間違えると、押した人はそれを打ち直すことになる。
  */
  it('remote 名に / が入っていても、既定のローカル名を正しく切る', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature/x')
    connectOrigin('up/stream')

    const result = await listGitRemoteBranches()

    expect(result.listing.status).toBe('ready')
    expect(result.listing.status === 'ready' ? result.listing.branches : []).toEqual([
      { name: 'up/stream/feature/x', branch: 'feature/x' },
      { name: 'up/stream/main', branch: 'main' }
    ])
  })

  /*
    remote が無い場合と、remote はあるが未 fetch の場合。git の出力は
    どちらも空で、次の一手だけが違う ── その言い分けの材料が `hasRemote` になる。
  */
  it('remote が1つも無ければ、空と hasRemote=false を返す（失敗にしない）', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await listGitRemoteBranches()

    expect(result.listing).toEqual({ status: 'ready', branches: [], truncated: false })
    expect(result.hasRemote).toBe(false)
  })

  it('remote はあるが未 fetch なら、空と hasRemote=true を返す', async () => {
    commit('a.txt', 'a\n', 'first')
    git('remote', 'add', 'origin', remotePath)

    const result = await listGitRemoteBranches()

    expect(result.listing).toEqual({ status: 'ready', branches: [], truncated: false })
    expect(result.hasRemote).toBe(true)
  })

  /**
   * 上限に達したら、切ったことを言う。
   *
   * ref は `update-ref --stdin` で**1回の git**にまとめて作る（3-8-6 の
   * 塊と同じ理由 ── 500 回 git を呼ぶと待ち時間が釣り合わない）。
   */
  it('上限で切り、切ったことを truncated で伝える', async () => {
    commit('a.txt', 'a\n', 'first')
    git('remote', 'add', 'origin', remotePath)

    const head = git('rev-parse', 'HEAD').trim()
    const commands = Array.from(
      { length: GIT_REMOTE_BRANCH_LIMIT + 1 },
      (_unused, index) =>
        `create refs/remotes/origin/bulk/${String(index).padStart(4, '0')} ${head}`
    ).join('\n')

    execFileSync(gitExecutable as string, ['update-ref', '--stdin'], {
      cwd: root,
      env: createGitEnvironment(process.env),
      input: `${commands}\n`,
      encoding: 'utf8',
      windowsHide: true
    })

    const result = await listGitRemoteBranches()

    expect(result.listing.status).toBe('ready')

    if (result.listing.status !== 'ready') {
      return
    }

    expect(result.listing.branches).toHaveLength(GIT_REMOTE_BRANCH_LIMIT)
    expect(result.listing.truncated).toBe(true)
  })

  it('Workspace が開かれていなければ not-ready', async () => {
    workspace = null

    const result = await listGitRemoteBranches()

    expect(result.listing).toEqual({ status: 'not-ready' })
    expect(result.workspaceId).toBeNull()
  })
})

describeWithGit('applyGitCreateTrackingBranch', () => {
  /** `main` と `feature/x` を送った状態から始める（この塊の共通の前提）。 */
  function prepare(): void {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature/x')
    git('switch', '--quiet', 'feature/x')
    commit('b.txt', 'b\n', 'on feature')
    git('switch', '--quiet', 'main')
    connectOrigin()
    // remote から取れた状態にしてから、手元のブランチは消しておく。
    git('branch', '--delete', '--force', 'feature/x')
  }

  it('作って、そのまま切り替わる', async () => {
    prepare()

    const result = await applyGitCreateTrackingBranch('feature/x', 'origin/feature/x')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'feature/x' })
    // 応答に載っている状態が、そのまま画面に出るもの（もう一度読み直さない）。
    expect(git('symbolic-ref', '--short', 'HEAD').trim()).toBe('feature/x')
    // 始点の中身が作業ツリーへ来ている。
    expect(readFile('b.txt')).toBe('b\n')
  })

  /*
    `--track` を明示している効き目そのもの。`branch.autoSetupMerge` を
    見えなくしてある（この塊の冒頭）ので、ここが通るのは明示のおかげになる。
  */
  it('追跡先が必ず付く', async () => {
    prepare()

    const result = await applyGitCreateTrackingBranch('feature/x', 'origin/feature/x')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(upstreamOf('feature/x')).toBe('origin refs/heads/feature/x')
  })

  it('ローカル名を打ち替えても、追う先は変わらない', async () => {
    prepare()

    const result = await applyGitCreateTrackingBranch('my-work', 'origin/feature/x')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'my-work' })
    expect(upstreamOf('my-work')).toBe('origin refs/heads/feature/x')
  })

  /*
    ここがこの回のいちばん大きな決めごとにあたる（設計判断）── 上書きも
    削除も、そのブランチへの自動切替もしない。同じ名前の別物である
    ことは普通に起こるため。
  */
  it('同じ名前のローカルブランチがあれば、git を動かさずに断る', async () => {
    prepare()
    git('branch', 'feature/x', 'main')
    const before = git('rev-parse', 'feature/x').trim()

    const result = await applyGitCreateTrackingBranch('feature/x', 'origin/feature/x')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-exists' })
    // 元のブランチは1文字も動いていない（付け替えていない）。
    expect(git('rev-parse', 'feature/x').trim()).toBe(before)
    // 追跡先も付いていない。
    expect(upstreamOf('feature/x')).toBeNull()
    // 切り替わってもいない（押したのは「作る」であって「切り替える」ではない）。
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
  })

  /*
    渡せば git は受け取り、`branch.<名前>.remote=.` を書いて
    「ローカルを追うローカルブランチ」を作る（実物で確かめてある）──
    押した人が一覧から選んだのは remote の枝なので、それは指していないものになる。
  */
  it('ローカルブランチ名を始点に渡しても作らない', async () => {
    prepare()

    const result = await applyGitCreateTrackingBranch('copy-of-main', 'main')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
    expect(localBranchNames()).not.toContain('copy-of-main')
  })

  /*
    一覧から除いてあるものが、要求としては届きうる（`branch --list` の
    パターンには一致する）── 認めると、追跡先が**別名**を指すブランチが
    できることになる。
  */
  it('origin/HEAD を始点に渡しても作らない', async () => {
    prepare()
    git('remote', 'set-head', 'origin', 'main')

    const result = await applyGitCreateTrackingBranch('from-head', 'origin/HEAD')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
    expect(localBranchNames()).not.toContain('from-head')
  })

  it('無い remote-tracking branch を指したら branch-not-found', async () => {
    prepare()

    const result = await applyGitCreateTrackingBranch('nope', 'origin/nope')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
    expect(localBranchNames()).not.toContain('nope')
  })

  /*
    3-8-6 / 3-8-13 と同じ「失われないこと」の確認。`--force` も `--merge` も
    渡していないので、失われるものがあれば git が断る ── そしてそのとき
    ブランチも作られない（`switch --create` が1回で行う）。
  */
  it('書きかけが上書きされるときは断り、ブランチも作られない', async () => {
    prepare()
    // 始点（origin/feature/x）が触るファイルを、手元でも書いておく。
    writeFile('b.txt', 'local work\n')

    const result = await applyGitCreateTrackingBranch('feature/x', 'origin/feature/x')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'local-changes-blocked' })
    expect(localBranchNames()).not.toContain('feature/x')
    // 書きかけはそのまま残っている。
    expect(readFile('b.txt')).toBe('local work\n')
  })

  it('切り替え先が触らないファイルの書きかけは、作っても残る', async () => {
    prepare()
    writeFile('a.txt', 'work in progress\n')

    const result = await applyGitCreateTrackingBranch('feature/x', 'origin/feature/x')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readFile('a.txt')).toBe('work in progress\n')
  })

  it('Workspace が開かれていなければ not-ready', async () => {
    workspace = null

    const result = await applyGitCreateTrackingBranch('feature/x', 'origin/feature/x')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})
