import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitRemote, GitRepositoryState } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { listRemoteUrls } from './gitCommands'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'
import { readRemoteEntries } from './gitOutput'

/**
 * 本物の git に対する remote の一覧 / 追加 / 削除の検証（Session 3-8-16）。
 *
 * ## ここで固定したいのは「何が消えるか」と「何が渡らないか」
 *
 * 3-8-14 が確かめたのは「断られたときに1つも消えていないこと」、3-8-15 が
 * 「指した1件が、指したとおりであること」だった。remote で確かめたいのは
 * そのどちらとも違う2つになる。
 *
 *   1. **消したときに、実際に何が消えるか**（設定・ref・**追跡先**）
 *   2. **git が受け取ってしまう値を、こちらが受け取らないこと**
 *
 * 2つめが実物にしか確かめられない側の中心にあたる ── `ext::sh -c whoami` や
 * 先頭が `-` の remote 名を git が**通してしまう**ことは、写しを相手にすると
 * 自分でその答えを書くことになる。
 *
 * 実物にしか確かめられないのは次の 10 個。
 *
 *  1. remote が1つも無くても `git remote --verbose` は 0 で終わり、空を返す
 *  2. 1件につき2行出る（fetch / push）── それを1件として読む
 *  3. fetch と push で URL が違っても、載るのは fetch 側1つ
 *  4. 追加してもネットワークへ出ない（届かない URL でも通る）
 *  5. 追加しても**追跡先は付かない**（`branch.<名前>.remote` は増えない）
 *  6. 同じ名前を2度足すと git が断り、**先にあった URL は変わらない**
 *  7. 削除すると、設定・remote-tracking ref・**追跡先**の3つが消える
 *  8. 削除しても commit は1つも失われない
 *  9. 無い remote を消そうとすると `remote-not-found` で、他は1つも消えない
 * 10. **git が受け取る危険な値**（`ext::…`・先頭が `-` の名前）を、こちらは断る
 *
 * ## 上限（100 件）は、本番と同じ引数を小さい数で通して確かめる
 *
 * `git remote` に件数を切る指定は無い（main/git/gitCommands.ts）ので、
 * 上限を掛けるのは読む側になる ── その振る舞いは `gitOutput.test.ts` が
 * 純粋な関数として固定済みで、ここで確かめたいのは
 * **本番の引数が出す形が、その関数の読める形であること**だけになる。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `listGitRemotes` / `applyGitAddRemote` / `applyGitRemoveRemote` で、
 * その下の runGit / gitCommands / gitQueue / gitFailure / gitOutput /
 * gitRemoteLabel はすべて本番のものが動く。差し替えるのは2つだけ
 * （electron の logger と、現在の Workspace）。
 *
 * 値の検証（`normalizeGitRemoteName` / `normalizeGitRemoteUrl`）は IPC の
 * ハンドラに在るため、この塊は**通った値だけ**を渡す ── 10 個めは
 * 「git は受け取るが、shared の規則は断る」という形で確かめる。
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

/** テストごとに作る一時領域。 */
let area: string
/** 利用者が開いている作業リポジトリ。 */
let root: string
/** 送り先として使う bare リポジトリ（ネットワークに出ずに Push できる相手）。 */
let bare: string

/** Main が持つ「今の Workspace」。 */
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const {
  listGitRemotes,
  applyGitAddRemote,
  applyGitRemoveRemote,
  applyGitRenameRemote,
  applyGitSetRemoteUrl
} = await import('./gitRemotes')
const { normalizeGitRemoteName, normalizeGitRemoteUrl } = await import('@shared/git')

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

/** 手元の設定（テスト自身の確認用）。無ければ null。 */
function config(key: string): string | null {
  try {
    return gitIn(root, 'config', '--get', key).trim()
  } catch {
    // `--get` は見つからないと非0で終わる（それ自体が答えにあたる）。
    return null
  }
}

/** 手元にある remote 名（テスト自身の確認用）。 */
function remoteNames(): readonly string[] {
  return git('remote')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** 手元にある remote-tracking ref（テスト自身の確認用）。 */
function remoteRefs(): readonly string[] {
  return git('for-each-ref', '--format=%(refname)', 'refs/remotes/')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

/** 一覧を `ready` として取り出す（そうでなければ不合格）。 */
async function readRemotes(): Promise<readonly GitRemote[]> {
  const result = await listGitRemotes()

  expect(result.listing.status, `ready ではない一覧: ${JSON.stringify(result.listing)}`).toBe(
    'ready'
  )

  return result.listing.status === 'ready' ? result.listing.remotes : []
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * `url.<base>.insteadOf` のような設定は開発者の PC に入っていておかしくなく、
 * **登録した URL そのものを書き換えうる** ── 見えなくしておかないと、
 * 通る PC と通らない PC が出る（3-8-14 / 3-8-15 と同じ構え）。
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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-remote-')))

  // 実在しないパスを指すと、git はその設定ファイルを空として扱う。
  process.env.GIT_CONFIG_GLOBAL = join(area, 'no-such-gitconfig')
  process.env.GIT_CONFIG_SYSTEM = join(area, 'no-such-system-gitconfig')

  root = join(area, 'work')
  bare = join(area, 'bare.git')

  gitIn(area, 'init', '--quiet', '--initial-branch=main', 'work')
  gitIn(area, 'init', '--bare', '--quiet', '--initial-branch=main', 'bare.git')
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

/**
 * 実 git を何本も起動するテストの待ち時間（Session 3-8-20 で明示した）。
 *
 * ここのテストは1件あたり 10 本前後の git プロセスを起動する ── 準備の
 * commit / switch に加えて、`applyGit*` は操作の前後で状態を読み直し
 * （main/git/gitOperationResult.ts）、その1回ずつが `rev-parse` /
 * `symbolic-ref` / `remote` / `rev-parse MERGE_HEAD` / `status` を動かす
 * （main/git/gitRepository.ts）。
 *
 * vitest の既定（5 秒）はそれに対して元から余裕が無く、100 本を超える
 * テストファイルを並べて走らせたときだけ落ちる、という形で表に出ていた ──
 * Session 3-8-20 で状態の読み取りに `rev-parse MERGE_HEAD` が1本増えたことで、
 * その余裕が無くなった（プロセスの起動そのものが Windows では重い）。
 *
 * **速さを確かめるテストではない**ので、上限は「本当に返ってこなくなったことに
 * 気づける」までの長さで足りる。既定を全体へ広げるのではなく、実 git を
 * 並べて起動するこの塊にだけ掛ける ── 純粋なロジックのテストは 5 秒で
 * 落ちてくれた方がよい。
 */
const REAL_GIT_TIMEOUT_MS = 30_000

describeWithGit('listGitRemotes', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /*
    `git remote --verbose` は remote が1つも無くても 0 で終わり、
    何も出さない ── だから「1件も無い」を失敗にする分岐が要らない
    （`git log` が非0で終わるのとは違う。shared/git/remote.ts）。
  */
  it('remote が1つも無くても、空として返る（失敗にしない）', async () => {
    const result = await listGitRemotes()

    expect(result.listing).toEqual({ status: 'ready', remotes: [], truncated: false })
  })

  it('commit が1つも無いリポジトリでも一覧できる', async () => {
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    expect(await readRemotes()).toEqual([{ name: 'origin', label: 'github.com/o/r' }])
  })

  /*
    1件につき fetch と push の2行が出る ── それを1件として読めていることを、
    本番の経路で確かめる（gitOutput.test.ts は写しに対して確かめている）。
  */
  it('1件につき2行出る出力を、1件として返す', async () => {
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    const raw = git('remote', '--verbose')

    expect(raw.split('\n').filter((line) => line.includes('origin'))).toHaveLength(2)
    expect(await readRemotes()).toHaveLength(1)
  })

  it('fetch と push で URL が違っても、載るのは fetch 側1つ', async () => {
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')
    git('remote', 'set-url', '--push', 'origin', 'ssh://git@example.com/other/repo.git')

    expect(await readRemotes()).toEqual([{ name: 'origin', label: 'github.com/o/r' }])
  })

  /*
    Renderer へ URL が渡らないことを、**本番の経路の出口で**確かめる ──
    ラベルの作り方そのものは gitRemoteLabel.test.ts が固定している
    （shared/git/remote.ts）。
  */
  it('URL は返らない（認証情報つきの URL でも、渡るのはラベルだけ）', async () => {
    git('remote', 'add', 'origin', 'https://ghp_secrettoken@github.com/o/r.git')

    const remotes = await readRemotes()
    const serialized = JSON.stringify(remotes)

    expect(remotes).toEqual([{ name: 'origin', label: 'github.com/o/r' }])
    expect(serialized).not.toContain('ghp_secrettoken')
    expect(serialized).not.toContain('https://')
  })

  it('ローカルのパスを指す remote は、場所を出さずに並ぶ', async () => {
    git('remote', 'add', 'local', bare)

    const remotes = await readRemotes()

    expect(remotes).toEqual([{ name: 'local', label: 'ローカルのパス' }])
    expect(JSON.stringify(remotes)).not.toContain('bare.git')
  })

  /**
   * 本番と同じ引数（`listRemoteUrls()` が組み立てたもの）を、小さい上限で通す。
   *
   * remote を 101 件作るのは `git remote add` を 101 回呼ぶことになり、
   * 確かめたいことに対して待ち時間が釣り合わない（3-8-15 と同じ判断）──
   * 上限の掛け方そのものは gitOutput.test.ts が固定済みで、ここで
   * 確かめたいのは**本番の引数が出す形が、その関数の読める形であること**になる。
   */
  it('本番の引数が出す出力を、上限の掛かる形として読める', async () => {
    for (const name of ['a', 'b', 'c']) {
      git('remote', 'add', name, `https://example.com/o/${name}.git`)
    }

    const raw = gitIn(root, ...listRemoteUrls().args)
    const reading = readRemoteEntries(raw, 2)

    expect(reading.remotes.map((remote) => remote.name)).toEqual(['a', 'b'])
    expect(reading.truncated).toBe(true)
  })

  /*
    `git remote --verbose` はサブフォルダでも答えるが、その手前で止める ──
    一覧を出すということは**消す相手を選ばせる**ことで、Git 操作を行わないと
    決めた状態（設計判断 10）で選ばせる形にはできない（main/git/gitRemotes.ts）。
  */
  it('Workspace root がリポジトリ root でなければ一覧しない', async () => {
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')
    commit('a.txt', 'base\n', 'first')

    const inner = join(root, 'src')

    mkdirSync(inner)

    // サブフォルダでも git 自身は答える（そこを手前で止めていることを確かめる）。
    expect(gitIn(inner, 'remote')).toContain('origin')

    workspace = { ...(workspace as WorkspaceFolder), rootPath: inner }

    expect((await listGitRemotes()).listing).toEqual({ status: 'not-ready' })
  })
})

describeWithGit('applyGitAddRemote', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('登録すると、一覧に出て hasRemote が立つ', async () => {
    commit('a.txt', 'base\n', 'first')

    const result = await applyGitAddRemote('origin', 'https://github.com/o/r.git')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readyOf(result.repository).hasRemote).toBe(true)
    expect(await readRemotes()).toEqual([{ name: 'origin', label: 'github.com/o/r' }])
  })

  /*
    `--fetch` を渡していないので、この1回で起きるのは設定に1行増えることだけ ──
    **届かない URL でも通る**（shared/ipc/contracts/git.ts）。
  */
  it('ネットワークへ出ない（届かない URL でも通る）', async () => {
    commit('a.txt', 'base\n', 'first')

    const result = await applyGitAddRemote(
      'origin',
      'https://nonexistent.invalid/definitely/not-there.git'
    )

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(remoteRefs()).toEqual([])
  })

  /*
    足した瞬間に追跡先が付く形にすると、**まだ届くかも分からない相手**が
    画面の `↑ ↓` の基準になる（shared/ipc/contracts/git.ts）。
  */
  it('追跡先は付かない（付くのは Push が通ったときだけ）', async () => {
    commit('a.txt', 'base\n', 'first')

    await applyGitAddRemote('origin', 'https://github.com/o/r.git')

    expect(config('branch.main.remote')).toBeNull()
    expect(config('branch.main.merge')).toBeNull()
    expect(
      readyOf((await applyGitAddRemote('x', 'https://x.example/y.git')).repository).upstream
    ).toBeNull()
  })

  it('commit が1つも無いリポジトリでも登録できる', async () => {
    const result = await applyGitAddRemote('origin', 'https://github.com/o/r.git')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(await readRemotes()).toHaveLength(1)
  })

  it('2つめの remote も足せる', async () => {
    commit('a.txt', 'base\n', 'first')

    await applyGitAddRemote('origin', 'https://github.com/o/r.git')
    await applyGitAddRemote('upstream', 'git@github.com:upstream/r.git')

    expect((await readRemotes()).map((remote) => remote.name)).toEqual(['origin', 'upstream'])
  })

  /*
    ここが `set-url` を持たないという判断の現れになる ── `git remote add` は
    既にあれば失敗し、**先にあった URL は1文字も変わらない**
    （黙って上書きすると、送り先が入れ替わったことに誰も気づかない）。
  */
  it('同じ名前を2度足すと断り、先にあった URL は変わらない', async () => {
    commit('a.txt', 'base\n', 'first')

    await applyGitAddRemote('origin', 'https://github.com/o/first.git')

    const result = await applyGitAddRemote('origin', 'https://github.com/o/second.git')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'remote-exists' })
    expect(config('remote.origin.url')).toBe('https://github.com/o/first.git')
    expect(await readRemotes()).toEqual([{ name: 'origin', label: 'github.com/o/first' }])
  })

  it('Workspace が閉じられていれば git を動かさない', async () => {
    workspace = null

    const result = await applyGitAddRemote('origin', 'https://github.com/o/r.git')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})

/**
 * remote の URL の変更（Session 3-8-17）。
 *
 * ## ここで固定したいのは「何が変わらないか」
 *
 * 削除の塊が**何が消えるか**を固定しているのに対し、こちらは逆向きになる ──
 * `git remote set-url` が書き換えるのは設定の1行だけで、refspec も
 * remote-tracking ref も追跡先も動かない。**つまり画面の `↑ ↓` は
 * 変更後も前の送り先と比べた数のまま残る** ── これが確認の文言
 * （renderer/src/git/gitRemotes.ts）の根拠そのものにあたる。
 */
describeWithGit('applyGitSetRemoteUrl', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /** 送り先を bare にして、追跡先まで作る（ネットワークへは出ない）。 */
  async function connectAndPush(): Promise<void> {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', bare)
    git('push', '--quiet', '--set-upstream', 'origin', 'main')
  }

  it('URL だけが変わる', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/old.git')

    const result = await applyGitSetRemoteUrl('origin', 'https://github.com/o/new.git')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(config('remote.origin.url')).toBe('https://github.com/o/new.git')
  })

  /*
    この塊の中心。**残るもの**を1つずつ固定する ── 削除が消す3つ
    （設定・remote-tracking ref・追跡先）のうち、set-url が触るのは
    設定の URL 1行だけになる。
  */
  it('refspec・remote-tracking ref・追跡先は1つも動かない', async () => {
    await connectAndPush()

    const result = await applyGitSetRemoteUrl('origin', 'https://github.com/o/other.git')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(config('remote.origin.fetch')).toBe('+refs/heads/*:refs/remotes/origin/*')
    expect(remoteRefs()).toContain('refs/remotes/origin/main')
    expect(config('branch.main.remote')).toBe('origin')
    expect(config('branch.main.merge')).toBe('refs/heads/main')
  })

  /*
    確認の文言が「前の送り先と比べたものになります」と書ける根拠。
    送り先を丸ごと別のものへ変えても、`↑1` はそのまま残る。
  */
  it('ahead / behind は変更前と同じまま残る（前の送り先と比べた数）', async () => {
    await connectAndPush()
    commit('b.txt', 'more\n', 'second')

    const before = readyOf((await applyGitSetRemoteUrl('origin', bare)).repository).upstream

    expect(before).not.toBeNull()
    expect(before?.ahead).toBe(1)

    const after = readyOf(
      (await applyGitSetRemoteUrl('origin', 'https://github.com/o/unrelated.git')).repository
    ).upstream

    expect(after).toEqual(before)
  })

  it('commit も作業ツリーも動かない', async () => {
    await connectAndPush()

    const log = git('log', '--format=%s').trim()

    await applyGitSetRemoteUrl('origin', 'https://github.com/o/new.git')

    expect(git('log', '--format=%s').trim()).toBe(log)
    expect(git('status', '--porcelain').trim()).toBe('')
  })

  /* remote の数は増えも減りもしない ── 公開の入口は戻らない。 */
  it('hasRemote は変わらない', async () => {
    await connectAndPush()

    const result = await applyGitSetRemoteUrl('origin', 'https://github.com/o/new.git')

    expect(readyOf(result.repository).hasRemote).toBe(true)
  })

  /* 追加と同じく `--fetch` を渡していないので、届かない URL でも通る。 */
  it('ネットワークへ出ない（届かない URL でも通る）', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    const result = await applyGitSetRemoteUrl(
      'origin',
      'https://nonexistent.invalid/does/not/exist.git'
    )

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(remoteRefs()).toEqual([])
  })

  /*
    同じ URL を渡しても失敗にしない（D4）── Renderer は今の URL を
    持っていないので押す前に判定できず、Main で判定するには git を
    1本増やすことになる。変わらない値で上書きしても壊れるものは無い。
  */
  it('今と同じ URL を渡しても、成功として終わる', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    const result = await applyGitSetRemoteUrl('origin', 'https://github.com/o/r.git')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(config('remote.origin.url')).toBe('https://github.com/o/r.git')
  })

  /*
    一覧を開いてから押すまでの間に、端末で消えた場合にあたる ──
    **他の remote の URL は1文字も変わらない。**
  */
  it('無い remote を指すと断り、他の URL は1文字も変わらない', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    const result = await applyGitSetRemoteUrl('nope', 'https://github.com/o/new.git')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'remote-not-found' })
    expect(config('remote.origin.url')).toBe('https://github.com/o/r.git')
    expect(remoteNames()).toEqual(['origin'])
  })

  it('複数あるうちの1つだけを変える', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')
    git('remote', 'add', 'upstream', 'https://github.com/u/r.git')

    await applyGitSetRemoteUrl('origin', 'https://github.com/o/new.git')

    expect(config('remote.origin.url')).toBe('https://github.com/o/new.git')
    expect(config('remote.upstream.url')).toBe('https://github.com/u/r.git')
  })

  /* 一覧のラベルは、変更後の URL から作り直される。 */
  it('変えると一覧のラベルも変わる', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/old.git')

    expect(await readRemotes()).toEqual([{ name: 'origin', label: 'github.com/o/old' }])

    await applyGitSetRemoteUrl('origin', 'https://example.com/team/new.git')

    expect(await readRemotes()).toEqual([{ name: 'origin', label: 'example.com/team/new' }])
  })

  it('Workspace が閉じられていれば git を動かさない', async () => {
    workspace = null

    const result = await applyGitSetRemoteUrl('origin', 'https://github.com/o/r.git')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})

/**
 * remote の rename（Session 3-8-17）。
 *
 * ## ここで固定したいのは「全部が追随すること」と「壊れる1点」
 *
 * 3-8-16 は「rename は追跡先まで書き換わる ── 消して足し直すのとは別の
 * 設計が要る」と書いていたが、実物は**易しい側に別**だった ── git が
 * 必要なものを全部追随させるため、remove + add と違って追跡先を失わない。
 *
 * 唯一壊れるのが大文字小文字だけの改名で、そこは git を動かす前に断つ。
 */
describeWithGit('applyGitRenameRemote', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /** 送り先を bare にして、追跡先まで作る（ネットワークへは出ない）。 */
  async function connectAndPush(): Promise<void> {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', bare)
    git('push', '--quiet', '--set-upstream', 'origin', 'main')
  }

  /*
    この塊の中心。**削除が消す3つが、rename では1つも失われない。**
    `remote.pushDefault` まで追随することも、ここで固定しておく。
  */
  it('設定・refspec・remote-tracking ref・追跡先・pushDefault の5つが追随する', async () => {
    await connectAndPush()
    git('config', 'remote.pushDefault', 'origin')

    const result = await applyGitRenameRemote('origin', 'upstream')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(config('remote.upstream.url')).toBe(bare)
    expect(config('remote.upstream.fetch')).toBe('+refs/heads/*:refs/remotes/upstream/*')
    expect(remoteRefs()).toEqual(['refs/remotes/upstream/main'])
    expect(config('branch.main.remote')).toBe('upstream')
    expect(config('branch.main.merge')).toBe('refs/heads/main')
    expect(config('remote.pushDefault')).toBe('upstream')

    // 古い側は1つも残らない。
    expect(config('remote.origin.url')).toBeNull()
    expect(remoteNames()).toEqual(['upstream'])
  })

  /*
    削除との決定的な違い ── 画面の `↑ ↓` が消えず、Push が
    「初回の Push」に戻らない。
  */
  it('追跡先が生きたまま残り、rename の後も Push が通る', async () => {
    await connectAndPush()
    commit('b.txt', 'more\n', 'second')

    const result = await applyGitRenameRemote('origin', 'upstream')

    const upstream = readyOf(result.repository).upstream

    expect(upstream).not.toBeNull()
    expect(upstream?.name).toBe('upstream/main')
    expect(upstream?.ahead).toBe(1)

    // 追跡先が生きているので、remote 名を指さない素の push で送れる。
    expect(() => git('push', '--quiet')).not.toThrow()
  })

  it('commit も作業ツリーも動かない', async () => {
    await connectAndPush()

    const log = git('log', '--format=%s').trim()

    await applyGitRenameRemote('origin', 'upstream')

    expect(git('log', '--format=%s').trim()).toBe(log)
    expect(git('status', '--porcelain').trim()).toBe('')
  })

  it('hasRemote は変わらない（数は増えも減りもしない）', async () => {
    await connectAndPush()

    const result = await applyGitRenameRemote('origin', 'upstream')

    expect(readyOf(result.repository).hasRemote).toBe(true)
  })

  it('commit が1つも無いリポジトリでも改名できる', async () => {
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    expect((await applyGitRenameRemote('origin', 'upstream')).outcome).toEqual({
      status: 'applied'
    })
    expect(remoteNames()).toEqual(['upstream'])
  })

  /*
    行き先が既に使われている場合。**手元の remote は1つも変わらない。**
  */
  it('行き先が既にあると断り、どちらの remote も変わらない', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')
    git('remote', 'add', 'upstream', 'https://github.com/u/r.git')

    const result = await applyGitRenameRemote('origin', 'upstream')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'remote-exists' })
    expect(config('remote.origin.url')).toBe('https://github.com/o/r.git')
    expect(config('remote.upstream.url')).toBe('https://github.com/u/r.git')
    expect(remoteNames()).toEqual(['origin', 'upstream'])
  })

  it('無い remote を改名しようとすると断り、他は1つも変わらない', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    const result = await applyGitRenameRemote('nope', 'other')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'remote-not-found' })
    expect(remoteNames()).toEqual(['origin'])
  })

  /*
    同じ名前を打った。git は `already exists` と言うが、それは
    「別のものが在る」という意味の文で、起きたこととは違う（3-8-14 と同じ）。
  */
  it('同じ名前なら git を動かさず nothing-to-do', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    const result = await applyGitRenameRemote('origin', 'origin')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    expect(remoteNames()).toEqual(['origin'])
  })

  /*
    **この塊でいちばん大事な1件。**

    Windows では `refs/remotes/origin/…` と `refs/remotes/Origin/…` が
    同じファイルになるため、git は途中まで適用したまま落ちる ──
    こちらは git を動かす前に断つので、設定は1文字も変わらない。
  */
  it('大文字小文字だけの改名は、git を動かさずに断る', async () => {
    await connectAndPush()

    const result = await applyGitRenameRemote('origin', 'Origin')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'unsupported-target' })

    // 半分だけ適用された痕跡が1つも無い。
    expect(remoteNames()).toEqual(['origin'])
    expect(config('remote.origin.url')).toBe(bare)
    expect(config('remote.origin.fetch')).toBe('+refs/heads/*:refs/remotes/origin/*')
    expect(config('remote.Origin.url')).toBeNull()
    expect(remoteRefs()).toEqual(['refs/remotes/origin/main'])
    expect(config('branch.main.remote')).toBe('origin')
  })

  it('Workspace が閉じられていれば git を動かさない', async () => {
    workspace = null

    const result = await applyGitRenameRemote('origin', 'upstream')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})

describeWithGit('applyGitRemoveRemote', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /** 送り先を bare にして、追跡先まで作る（ネットワークへは出ない）。 */
  async function connectAndPush(): Promise<void> {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', bare)
    git('push', '--quiet', '--set-upstream', 'origin', 'main')
  }

  /*
    ここがこの塊の中心になる。**何が消えるか**を、実物に対して固定する
    （shared/ipc/contracts/git.ts に書いてある3つ）。
  */
  it('設定・remote-tracking ref・追跡先の3つが消える', async () => {
    await connectAndPush()

    expect(config('remote.origin.url')).not.toBeNull()
    expect(remoteRefs()).toContain('refs/remotes/origin/main')
    expect(config('branch.main.remote')).toBe('origin')
    expect(config('branch.main.merge')).toBe('refs/heads/main')

    const result = await applyGitRemoveRemote('origin')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(config('remote.origin.url')).toBeNull()
    expect(config('remote.origin.fetch')).toBeNull()
    expect(remoteRefs()).toEqual([])
    expect(config('branch.main.remote')).toBeNull()
    expect(config('branch.main.merge')).toBeNull()
  })

  /*
    確認の文言が「コミットは失われません」と書ける根拠になる
    （renderer/src/git/gitRemotes.ts）。
  */
  it('commit は1つも失われない', async () => {
    await connectAndPush()
    commit('b.txt', 'more\n', 'second')

    const before = git('log', '--format=%s').trim()

    await applyGitRemoveRemote('origin')

    expect(git('log', '--format=%s').trim()).toBe(before)
    expect(git('status', '--porcelain').trim()).toBe('')
  })

  it('消すと hasRemote が下りる（公開の入口が戻る）', async () => {
    await connectAndPush()

    const result = await applyGitRemoveRemote('origin')

    expect(readyOf(result.repository).hasRemote).toBe(false)
    expect(readyOf(result.repository).upstream).toBeNull()
  })

  it('追っているブランチが在っても止めない（消したいのに消せない形を作らない）', async () => {
    await connectAndPush()

    expect((await applyGitRemoveRemote('origin')).outcome).toEqual({ status: 'applied' })
  })

  /*
    一覧を開いてから ✕ を押すまでの間に、端末で消えた場合にあたる ──
    **他の remote は1つも消えない。**
  */
  it('無い remote を消そうとすると断り、他は1つも消えない', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')

    const result = await applyGitRemoveRemote('nope')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'remote-not-found' })
    expect(remoteNames()).toEqual(['origin'])
  })

  it('複数あるうちの1つだけを消す', async () => {
    commit('a.txt', 'base\n', 'first')
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')
    git('remote', 'add', 'upstream', 'https://github.com/u/r.git')

    expect((await applyGitRemoveRemote('origin')).outcome).toEqual({ status: 'applied' })
    expect(remoteNames()).toEqual(['upstream'])
  })

  it('Workspace が閉じられていれば git を動かさない', async () => {
    workspace = null

    const result = await applyGitRemoveRemote('origin')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})

/**
 * git が受け取ってしまう値を、こちらは受け取らない（Session 3-8-16）。
 *
 * ## この塊だけ、確かめる相手が2つある
 *
 * 他の塊は「アプリがどう振る舞うか」を確かめているが、ここでは
 * **git がどう振る舞うか**を先に確かめる ── それが「shared の規則が
 * 要る理由」そのものになるため。写しを相手にすると、この前提を
 * 自分で書くことになる。
 */
describeWithGit('git が受け取る値と、こちらが受け取る値', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /*
    `ext::` は実在する RCE の経路になる ── 追加した時点では何も起きないが、
    以降の fetch / push でその文字列がシェルとして走る。
  */
  it('git は `ext::sh -c …` を remote として受け取るが、こちらは断る', () => {
    git('remote', 'add', 'evil', 'ext::sh -c whoami')

    expect(remoteNames()).toContain('evil')
    expect(config('remote.evil.url')).toBe('ext::sh -c whoami')

    // 同じ値が IPC の境界を通ることは無い（shared/git/remoteUrl.ts）。
    expect(normalizeGitRemoteUrl('ext::sh -c whoami')).toBeNull()
  })

  /*
    `--end-of-options` は「引数として解釈されない」ことは守るが、
    **扱えない名前が生まれること**は止めない（main/git/gitCommands.ts）。
  */
  it('git は `--end-of-options` の後ろの `-x` を名前として受け取るが、こちらは断る', () => {
    git('remote', 'add', '--end-of-options', '-x', 'https://github.com/o/r.git')

    expect(remoteNames()).toContain('-x')

    // その名前は、こちらの規則を通らない。
    expect(normalizeGitRemoteName('-x')).toBeNull()
  })

  /*
    `--end-of-options` を置いていないと、名前がオプションとして読まれる ──
    アプリから消せない remote が生まれることになる。
  */
  it('`--end-of-options` があれば、先頭が `-` の remote も消せる', () => {
    git('remote', 'add', '--end-of-options', '-x', 'https://github.com/o/r.git')

    // 置かないと、git は `-x` をオプションとして読む。
    expect(() => git('remote', 'remove', '-x')).toThrow()

    // 本番の表が組み立てるのと同じ形（main/git/gitCommands.ts の `removeRemote`）。
    git('remote', 'remove', '--end-of-options', '-x')

    expect(remoteNames()).not.toContain('-x')
  })

  it('一覧はこれらの remote も隠さない（見えない送り先を作らない）', async () => {
    git('remote', 'add', 'evil', 'ext::sh -c whoami')

    expect(await readRemotes()).toEqual([{ name: 'evil', label: '不明な形式' }])
  })

  /*
    3-8-17 で口が2本増えても、**git が受け取ってしまうものは同じ**になる ──
    追加の口だけを固めても、変更と rename が素通しなら同じ穴が
    2つめ・3つめとして開く。
  */
  it('git は `set-url` でも `ext::…` を受け取るが、こちらは断る', () => {
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')
    git('remote', 'set-url', 'origin', 'ext::sh -c whoami')

    expect(config('remote.origin.url')).toBe('ext::sh -c whoami')

    // 同じ値が IPC の境界を通ることは無い（追加のときとまったく同じ関数）。
    expect(normalizeGitRemoteUrl('ext::sh -c whoami')).toBeNull()
  })

  it('git は `rename` の行き先として `-x` を受け取るが、こちらは断る', () => {
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')
    git('remote', 'rename', '--end-of-options', 'origin', '-x')

    expect(remoteNames()).toContain('-x')

    // その名前は、行き先としてもこちらの規則を通らない。
    expect(normalizeGitRemoteName('-x')).toBeNull()
  })

  /*
    **アプリが大文字小文字だけの rename を断つ理由そのもの。**

    git は失敗として終わるが、そのとき既に設定は半分書き換わっている ──
    「失敗したのでやり直せる」ではなく、1回目で壊れる。しかも stderr は
    `.lock` / `Another git process seems to be running` と読めるため、
    素直に分類すると「他の git を閉じてやり直せば通る」という嘘の案内になる
    （main/git/gitFailure.ts はそこを読まない）。
  */
  it('git の大文字小文字だけの rename は、途中まで適用したまま落ちる', () => {
    git('remote', 'add', 'origin', 'https://github.com/o/r.git')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Fluvix Nexus Test')
    writeFileSync(join(root, 'a.txt'), 'base\n', 'utf8')
    git('add', '--', 'a.txt')
    git('commit', '--quiet', '-m', 'first')

    // remote-tracking ref が在る状態を作る（この ref の改名で落ちる）。
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')

    expect(() => git('remote', 'rename', '--end-of-options', 'origin', 'Origin')).toThrow()

    /*
      落ちたのに、設定だけが新しい名前になっている ── refspec も
      remote-tracking ref も古い名前を指したまま残る。
    */
    expect(config('remote.Origin.url')).toBe('https://github.com/o/r.git')
    expect(config('remote.Origin.fetch')).toBe('+refs/heads/*:refs/remotes/origin/*')
    expect(remoteRefs()).toEqual(['refs/remotes/origin/main'])
  })
})
