import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitRepositoryState } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitEnvironment } from '../git/gitEnvironment'
import { resolveGitExecutable } from '../git/gitExecutable'
import { currentPlatform } from '../platform'
import type {
  GitHubRepositoryCreation,
  GitHubRepositoryCreationRequest,
  GitHubRepositoryPublisher
} from './githubRepositoryPublisher'

/**
 * 本物の git に対する「GitHub への公開」の検証（Session 3-8-10）。
 *
 * ## 相手を用意する ── ネットワークにも GitHub にも触れずに
 *
 * **repository を作る側を差し替える**（設計判断 12 の境界がここで効く）。
 * 差し替えた実装がすることは1つだけ ── 同じ PC に**bare リポジトリ**を作って、
 * その場所を「remote の URL」として返す。git にとってそれは他の remote と
 * 何も変わらず、`remote add` も `push --set-upstream` も同じ経路を通る
 * （gitSyncRepository.test.ts が Push / Pull で使っているのと同じ形）。
 *
 * この形にすると、どの PC でも・回線が無くても・GitHub CLI が入っていなくても
 * 次を実物に対して固定できる。
 *
 *   - 公開が「作る → remote → Push」の順で通り、追跡先まで設定されること
 *   - **commit が無い／detached HEAD では、外に物を作らずに断る**こと
 *   - 同じ名前が既にあるときに、remote を設定しないこと
 *   - Push だけが通らなかったとき、**作られたことを伝えつつ remote は残す**こと
 *   - **remote が既にあれば作り直さず、続きの Push だけを行う**こと（再開）
 *
 * gh そのものの振る舞い（引数・出力・失敗の文言）は、この塊の外で
 * 固定してある（githubCommands / githubOutput / githubFailure の各テスト）。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `publishRepositoryToGitHub` で、その下の runGit / gitCommands /
 * gitQueue / gitFailure / gitRepository はすべて本番のものが動く。
 * 差し替えるのは3つだけ（electron の logger・現在の Workspace・
 * repository を作る相手）。
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

/** テストごとに作る一時領域（この下に作業リポジトリと remote が並ぶ）。 */
let area: string
/** 利用者が開いている作業リポジトリ。 */
let root: string
/** 「GitHub 側」にあたる bare リポジトリの置き場所。 */
let remotePath: string

/** Main が持つ「今の Workspace」。 */
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { publishRepositoryToGitHub } = await import('./publishRepository')
const { setGitHubRepositoryPublisher } = await import('./githubRepositoryPublisher')

/** 差し替えた実装を元へ戻す（差し替えっぱなしにしない）。 */
let restorePublisher: (() => void) | null = null

/** 「作る」を頼まれた回数と、そのときの要求。 */
let creations: GitHubRepositoryCreationRequest[] = []

/**
 * repository を作る相手の代わり。
 *
 * `create` に渡した関数がそのまま結末になる ── 作れた／既にある／
 * ネットワークが無い、をテストごとに決められる。
 */
function usePublisher(
  create: (request: GitHubRepositoryCreationRequest) => GitHubRepositoryCreation
): void {
  const publisher: GitHubRepositoryPublisher = {
    checkAvailability: async () => ({ status: 'ready' }),
    createRepository: async (request) => {
      creations.push(request)
      return create(request)
    }
  }

  restorePublisher?.()
  restorePublisher = setGitHubRepositoryPublisher(publisher)
}

/** bare リポジトリを1つ作って、その場所を返す（「作られた repository」）。 */
function createBareRepository(name: string): string {
  const path = join(area, `${name}.git`)

  execFileSync(gitExecutable as string, ['init', '--bare', '--quiet', path], {
    cwd: area,
    env: createGitEnvironment(process.env),
    windowsHide: true
  })

  // git へ渡す形に揃える（Windows の `\` はそのままでも通るが、揃えておく）。
  return path.split('\\').join('/')
}

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
function commit(relativePath: string, content: string, message: string): void {
  writeFileSync(join(root, relativePath), content, 'utf8')
  git('add', '--', relativePath)
  git('commit', '--quiet', '-m', message)
}

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

/** 今設定されている `origin` の URL（無ければ null）。 */
function originUrl(): string | null {
  const listed = git('remote', '-v').trim()

  if (listed === '') {
    return null
  }

  return listed.split('\n')[0].split('\t')[1].replace(' (fetch)', '')
}

beforeEach(async () => {
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-github-publish-')))
  root = join(area, 'work')
  mkdirSync(root)
  remotePath = ''
  creations = []

  workspace = {
    id: 'workspace-1',
    rootPath: root,
    displayName: 'work',
    openedAt: Date.now(),
    exists: true
  }

  gitIn(root, 'init', '--quiet', '--initial-branch=main', '.')
  gitIn(root, 'config', 'user.email', 'test@example.com')
  gitIn(root, 'config', 'user.name', 'Fluvix Test')
  gitIn(root, 'config', 'core.autocrlf', 'false')
})

afterEach(async () => {
  restorePublisher?.()
  restorePublisher = null
  workspace = null
  await rm(area, { recursive: true, force: true }).catch(() => undefined)
})

describeWithGit('publishRepositoryToGitHub', () => {
  it('repository を作り、origin を設定し、初回 Push まで通す', async () => {
    commit('a.txt', 'a\n', 'first')
    usePublisher(() => {
      remotePath = createBareRepository('nexus')
      return { status: 'created', remoteUrl: remotePath }
    })

    const result = await publishRepositoryToGitHub({ name: 'nexus', visibility: 'private' })

    expect(result.outcome).toEqual({ status: 'applied' })

    // 打った名前と公開範囲が、そのまま作る側へ渡っている。
    expect(creations).toEqual([{ name: 'nexus', visibility: 'private' }])

    // remote が設定され、状態にも載る（画面の公開の入口はここで消える）。
    expect(originUrl()).toBe(remotePath)
    expect(readyOf(result.repository).hasRemote).toBe(true)

    // 追跡先まで設定される（次からは Push ボタンで送れる）。
    expect(readyOf(result.repository).upstream).not.toBeNull()
    expect(git('rev-parse', 'HEAD').trim()).toBe(gitIn(remotePath, 'rev-parse', 'main').trim())
  })

  it('公開範囲は渡したものがそのまま使われる', async () => {
    commit('a.txt', 'a\n', 'first')
    usePublisher(() => ({ status: 'created', remoteUrl: createBareRepository('nexus') }))

    await publishRepositoryToGitHub({ name: 'nexus', visibility: 'public' })

    expect(creations).toEqual([{ name: 'nexus', visibility: 'public' }])
  })

  /*
    外に物を作ってから手元の理由で断ると、GitHub 側に誰も使わない空の
    repository が残る ── だから**作る前に**確かめる。
  */
  it('commit が1つも無ければ、repository を作らずに断る', async () => {
    writeFileSync(join(root, 'a.txt'), 'a\n', 'utf8')
    usePublisher(() => ({ status: 'created', remoteUrl: createBareRepository('nexus') }))

    const result = await publishRepositoryToGitHub({ name: 'nexus', visibility: 'private' })

    expect(result.outcome).toEqual({ status: 'failed', reason: 'no-commit' })
    expect(creations).toEqual([])
    expect(originUrl()).toBeNull()
  })

  it('detached HEAD では、repository を作らずに断る', async () => {
    commit('a.txt', 'a\n', 'first')
    git('checkout', '--quiet', '--detach', 'HEAD')
    usePublisher(() => ({ status: 'created', remoteUrl: createBareRepository('nexus') }))

    const result = await publishRepositoryToGitHub({ name: 'nexus', visibility: 'private' })

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-on-branch' })
    expect(creations).toEqual([])
    expect(originUrl()).toBeNull()
  })

  /*
    別名で作り直すことも、上書きすることもしない（設計判断）──
    次の名前は利用者が決める。
  */
  it('同じ名前が既にあれば、remote を設定せずに断る', async () => {
    commit('a.txt', 'a\n', 'first')
    usePublisher(() => ({ status: 'failed', reason: 'github-repository-exists' }))

    const result = await publishRepositoryToGitHub({ name: 'nexus', visibility: 'private' })

    expect(result.outcome).toEqual({ status: 'failed', reason: 'github-repository-exists' })
    expect(creations).toHaveLength(1)
    expect(originUrl()).toBeNull()
    expect(readyOf(result.repository).hasRemote).toBe(false)
  })

  it('gh が入っていなければ、そのまま理由として返る', async () => {
    commit('a.txt', 'a\n', 'first')
    usePublisher(() => ({ status: 'failed', reason: 'github-cli-missing' }))

    const result = await publishRepositoryToGitHub({ name: 'nexus', visibility: 'private' })

    expect(result.outcome).toEqual({ status: 'failed', reason: 'github-cli-missing' })
    expect(originUrl()).toBeNull()
  })

  /*
    このセッションでいちばん取り違えてはいけないところ ── 作られたことを
    伝えないと、利用者は同じ名前でもう一度押し、「既にあります」と言われる。
    **作った repository を消して失敗に揃えることもしない。**
  */
  it('Push だけが通らなかったら、作られたことを伝えて remote は残す', async () => {
    commit('a.txt', 'a\n', 'first')

    usePublisher(() => {
      // 相手側に、手元とは無関係の commit を先に積んでおく（＝早送りできない）。
      const bare = createBareRepository('nexus')
      const seed = join(area, 'seed')
      mkdirSync(seed)
      gitIn(seed, 'init', '--quiet', '--initial-branch=main', '.')
      gitIn(seed, 'config', 'user.email', 'other@example.com')
      gitIn(seed, 'config', 'user.name', 'Other')
      gitIn(seed, 'config', 'core.autocrlf', 'false')
      writeFileSync(join(seed, 'b.txt'), 'b\n', 'utf8')
      gitIn(seed, 'add', '-A')
      gitIn(seed, 'commit', '--quiet', '-m', 'theirs')
      gitIn(seed, 'push', '--quiet', bare, 'main')

      remotePath = bare
      return { status: 'created', remoteUrl: bare }
    })

    const result = await publishRepositoryToGitHub({ name: 'nexus', visibility: 'private' })

    expect(result.outcome.status).toBe('partly-applied')
    expect(result.outcome.status === 'partly-applied' ? result.outcome.completed : null).toBe(
      'github-repository'
    )

    // remote は残る ── 続きは Push ボタンからやり直せる。
    expect(originUrl()).toBe(remotePath)
    expect(readyOf(result.repository).hasRemote).toBe(true)
  })

  /*
    途中経過をアプリが覚えないことの現れ ── 押されるたびに実状態を読み直し、
    済んでいるところを飛ばす。
  */
  it('remote が既にあれば作り直さず、続きの Push だけを行う', async () => {
    commit('a.txt', 'a\n', 'first')
    remotePath = createBareRepository('existing')
    git('remote', 'add', 'origin', remotePath)

    usePublisher(() => ({ status: 'created', remoteUrl: createBareRepository('another') }))

    const result = await publishRepositoryToGitHub({ name: 'another', visibility: 'private' })

    expect(result.outcome).toEqual({ status: 'applied' })
    // 作る側は1度も呼ばれない（外に物を増やさない）。
    expect(creations).toEqual([])
    // origin は**上書きされない。**
    expect(originUrl()).toBe(remotePath)
    expect(gitIn(remotePath, 'rev-parse', 'main').trim()).toBe(git('rev-parse', 'HEAD').trim())
  })

  it('Workspace が開かれていなければ何も起きない', async () => {
    usePublisher(() => ({ status: 'created', remoteUrl: createBareRepository('nexus') }))
    workspace = null

    const result = await publishRepositoryToGitHub({ name: 'nexus', visibility: 'private' })

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
    expect(creations).toEqual([])
  })
})
