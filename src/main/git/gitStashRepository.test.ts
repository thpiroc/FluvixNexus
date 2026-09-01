import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitRepositoryState } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { listStashEntries } from './gitCommands'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する退避（stash）の一覧 / 退避 / 戻す / 捨てるの検証
 * （Session 3-8-15）。
 *
 * ## ここで固定したいのは「指した1件が、指したとおりであること」
 *
 * 3-8-6 / 3-8-13 が確かめたのは「書きかけが失われないこと」、3-8-14 が
 * 「断られたときに1つも消えていないこと」だった。退避で確かめたいのは、
 * そのどちらとも違う**同一性**になる。
 *
 * `stash@{N}` は名前ではなく上から数えた位置で、**退避を1つ作れば全部が
 * 1つずつ後ろへずれる。** その振る舞いは実装ではなく git が決めるもので、
 * 写しを相手にすると自分でその答えを書くことになる ── そして取り違えると、
 * 押した人が見ていない退避が消える（戻せない）。
 *
 * 実物にしか確かめられないのは次の9つ。
 *
 *  1. 退避すると tracked の変更が HEAD の状態へ戻り、**未追跡は残る**（`-u` を渡していない）
 *  2. 未追跡しか無いときは git を動かさず `nothing-to-do`（`No local changes to save` は 0 で終わる）
 *  3. commit が1つも無いリポジトリでは `no-commit` で、退避も作られない
 *  4. 競合が残っている間は git を動かさずに断る
 *  5. index に載せた変更は、戻ると **unstaged** になる（`--index` を渡していない）
 *  6. **pop が競合すると `partly-applied` になり、退避は一覧に残る**（stderr は空・stdout に出る）
 *  7. 上書きされる pop は `local-changes-blocked` で、作業ツリーも一覧も1文字も動かない
 *  8. **drop すると、それより後ろの番号が繰り上がる**（同一性を確かめる理由そのもの）
 *  9. **番号がずれていたら git を動かさずに断る**（hash の突き合わせが効いている）
 *
 * ## 上限（100 件）だけは、本番と同じ引数を小さい数で通して確かめる
 *
 * 退避を 101 件作るには `git stash push` を 101 回呼ぶことになり、実測で
 * 9 秒かかる（`git branch` を 500 回呼ばずに `update-ref --stdin` でまとめた
 * のと同じ判断で、確かめたいことに対して待ち時間が釣り合わない）。しかも
 * 退避には ref をまとめて作る手立てが無い ── 同じ commit を `stash store` で
 * 何度積んでも、`git stash list` は同じ commit を1件としか数えない（確かめた）。
 *
 * そこで、確かめる相手を**「上限をどう切るか」から「git が `--max-count` を
 * 守るか」へ**移してある。前者は `gitOutput.test.ts`（`readStashEntries`）が
 * 純粋な関数として固定済みで、後者だけが実物にしか聞けない ── 本番と同じ
 * `listStashEntries()` が組み立てた引数を、小さい上限で通す。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `listGitStashes` / `applyGitStashPush` / `applyGitStashPop` /
 * `applyGitStashDrop` で、その下の runGit / gitCommands / gitQueue /
 * gitFailure / gitOutput はすべて本番のものが動く。差し替えるのは2つだけ
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

const { listGitStashes, applyGitStashPush, applyGitStashPop, applyGitStashDrop } =
  await import('./gitStash')

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

/** 手元にある退避の名乗り（テスト自身の確認用）。 */
function stashSubjects(): readonly string[] {
  return git('stash', 'list', '--format=%gs')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** `git status --porcelain` の行（テスト自身の確認用）。 */
function statusLines(): readonly string[] {
  return git('status', '--porcelain')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
}

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

/** 一覧を `ready` として取り出す（そうでなければ不合格）。 */
async function readEntries(): Promise<
  readonly { readonly index: number; readonly shortHash: string; readonly subject: string }[]
> {
  const result = await listGitStashes()

  expect(result.listing.status, `ready ではない一覧: ${JSON.stringify(result.listing)}`).toBe(
    'ready'
  )

  return result.listing.status === 'ready' ? result.listing.entries : []
}

/** 退避を1つ作る（テスト自身の準備用。本番の経路は使わない）。 */
function stash(content: string, message: string): void {
  writeFile('a.txt', content)
  git('stash', 'push', '--quiet', '-m', message)
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * `stash.showIncludeUntracked` / `stash.showPatch` のような設定は開発者の PC に
 * 入っていておかしくなく、**この塊が確かめている振る舞いそのもの**を変えうる ──
 * 見えなくしておかないと、通る PC と通らない PC が出る（3-8-14 と同じ構え）。
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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-stash-')))

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

describeWithGit('listGitStashes', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /*
    `git log` と違い、`git stash list` は commit が1つも無くても 0 で終わる
    （確かめた）── だから履歴のような「HEAD の有無を先に見る」分岐が要らない。
  */
  it('commit が1つも無いリポジトリでも、空として返る（失敗にしない）', async () => {
    const result = await listGitStashes()

    expect(result.listing).toEqual({ status: 'ready', entries: [], truncated: false })
  })

  it('新しい順に、番号と hash と名乗りと日時を返す', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('one\n', 'first stash')
    stash('two\n', 'second stash')

    const entries = await readEntries()

    expect(entries.map((entry) => entry.index)).toEqual([0, 1])
    expect(entries[0]?.subject).toContain('second stash')
    expect(entries[1]?.subject).toContain('first stash')
    // hash は突き合わせに使う値なので、形まで確かめる。
    expect(entries[0]?.shortHash).toMatch(/^[0-9a-f]{4,40}$/)
    expect(entries[0]?.shortHash).not.toBe(entries[1]?.shortHash)
  })

  /**
   * 本番と同じ引数（`listStashEntries()` が組み立てたもの）を、小さい上限で通す。
   *
   * 確かめているのは「git が `--max-count` を守るか」と「1つ多く求める形が
   * 効くか」の2つで、**切り方そのもの**は `gitOutput.test.ts` が持つ
   * （上限を 100 件で確かめない理由は、このファイルの冒頭に書いてある）。
   */
  it('git は上限より1つ多い要求をそのとおりに返す（切ったことが分かる形になる）', () => {
    commit('a.txt', 'base\n', 'first')
    stash('one\n', 'first stash')
    stash('two\n', 'second stash')
    stash('three\n', 'third stash')

    const lines = gitIn(root, ...listStashEntries(2).args)
      .split('\n')
      .filter((line) => line.length > 0)

    // 上限 2 に対して 3 行返る ＝ 「まだ先がある」が読み取れる。
    expect(lines).toHaveLength(3)
  })

  it('Workspace が開かれていなければ not-ready', async () => {
    workspace = null

    const result = await listGitStashes()

    expect(result.listing).toEqual({ status: 'not-ready' })
    expect(result.workspaceId).toBeNull()
  })
})

describeWithGit('applyGitStashPush', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /**
   * `-u` を渡していないことの実体。
   *
   * 未追跡まで避けると、1行に見えて中身が数万件になりうるものを作業ツリーから
   * 消すことになる（3-8-9 が未追跡のフォルダの破棄を断ったのと同じ事情）。
   */
  it('tracked の変更だけを避け、未追跡のファイルは残す', async () => {
    commit('a.txt', 'base\n', 'first')
    writeFile('a.txt', 'changed\n')
    writeFile('new.txt', 'untracked\n')

    const result = await applyGitStashPush()

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readFile('a.txt')).toBe('base\n')
    expect(readFile('new.txt')).toBe('untracked\n')
    expect(stashSubjects()).toHaveLength(1)
    // 応答に載る状態も、避けた後のものになっている。
    expect(readyOf(result.repository).changes.unstaged).toHaveLength(0)
    expect(readyOf(result.repository).changes.untracked).toHaveLength(1)
  })

  /**
   * `git stash push` は退避するものが無くても **0 で終わる**（確かめた）。
   * 終了コードからは「押したのに何も起きなかった」を知りようが無いので、
   * 動かす前に分ける ── ここが崩れると、押すたびに「退避しました」と出て
   * 一覧には何も増えない。
   */
  it('未追跡しか無いときは git を動かさず nothing-to-do', async () => {
    commit('a.txt', 'base\n', 'first')
    writeFile('new.txt', 'untracked\n')

    const result = await applyGitStashPush()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    expect(stashSubjects()).toHaveLength(0)
    expect(readFile('new.txt')).toBe('untracked\n')
  })

  it('何も変わっていなければ nothing-to-do', async () => {
    commit('a.txt', 'base\n', 'first')

    const result = await applyGitStashPush()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    expect(stashSubjects()).toHaveLength(0)
  })

  it('commit が1つも無いリポジトリでは no-commit（退避も作られない）', async () => {
    writeFile('a.txt', 'first\n')
    git('add', '--', 'a.txt')

    const result = await applyGitStashPush()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'no-commit' })
    expect(stashSubjects()).toHaveLength(0)
    // staged のまま残っている（押したことで何かが失われていない）。
    expect(statusLines()).toEqual(['A  a.txt'])
  })

  /**
   * merge の途中で `git stash push` を動かすと `error: could not write index` で
   * 断られる（確かめた）── その文言は分類の役に立たないうえ、押す前に分かる。
   *
   * **理由は 3-8-22A で `operation-in-progress` に変わった。** 途中の操作
   * そのものを断る表が先に効くためで、こちらの方が正確にあたる ── 競合を
   * 解決し終えたマージでは **git が `stash push` を通してしまい**、
   * `MERGE_HEAD` が黙って消える（実物で確かめてある。
   * main/git/gitInProgressRepository.test.ts）。競合の件数だけを見ていると、
   * まさにその一瞬で素通りする。
   */
  it('マージの途中は operation-in-progress として断る', async () => {
    commit('a.txt', 'base\n', 'first')
    git('switch', '--quiet', '--create', 'other')
    commit('a.txt', 'theirs\n', 'other change')
    git('switch', '--quiet', 'main')
    commit('a.txt', 'ours\n', 'main change')
    // 競合を実際に作る（分類ではなく、本当に競合した状態を相手にする）。
    expect(() => git('merge', 'other')).toThrow()

    const result = await applyGitStashPush()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
    expect(stashSubjects()).toHaveLength(0)
  })

  /*
    途中の操作が無いのに競合だけが残っている形（`stash pop` の競合）。
    ここは 3-8-15 からの `unresolved-conflicts` のまま ── **競合を理由に断る道が
    残っていること**を固定しておく。
  */
  it('途中の操作が無い競合（stash pop）は unresolved-conflicts のまま', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('mine\n', 'my work')
    commit('a.txt', 'other\n', 'other change')

    try {
      git('stash', 'pop')
    } catch {
      // 競合は想定どおり。
    }

    const result = await applyGitStashPush()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'unresolved-conflicts' })
  })

  it('Workspace が開かれていなければ not-ready（git を動かさない）', async () => {
    commit('a.txt', 'base\n', 'first')
    writeFile('a.txt', 'changed\n')
    workspace = null

    const result = await applyGitStashPush()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})

describeWithGit('applyGitStashPop', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('戻して、一覧から取り除く', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('changed\n', 'work in progress')

    const [entry] = await readEntries()
    const result = await applyGitStashPop(entry.index, entry.shortHash)

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readFile('a.txt')).toBe('changed\n')
    expect(stashSubjects()).toHaveLength(0)
  })

  /**
   * `--index` を渡していないことの実体。
   *
   * 段まで復元すると競合時の振る舞いが増える一方、Stage は一覧の `＋` で
   * 1回で戻せる。
   */
  it('index に載せていた変更は、戻ると unstaged になる', async () => {
    commit('a.txt', 'base\n', 'first')
    writeFile('a.txt', 'staged\n')
    git('add', '--', 'a.txt')
    git('stash', 'push', '--quiet')

    const [entry] = await readEntries()
    const result = await applyGitStashPop(entry.index, entry.shortHash)

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(statusLines()).toEqual([' M a.txt'])
    expect(readyOf(result.repository).changes.staged).toHaveLength(0)
    expect(readyOf(result.repository).changes.unstaged).toHaveLength(1)
  })

  /**
   * このファイルでいちばん確かめたい1つ。
   *
   * pop の競合は **stderr に1文字も出ず、stdout と終了コードにだけ現れる**
   * （しかも `--quiet` を渡すとその行ごと消える）。つまり分類の表だけでは
   * 見分けようが無く、`failed` に丸めると利用者は押し直して二重に断られる。
   *
   * git が退避を**捨てない**ことも、ここで一緒に押さえる ── 文言
   * （「退避は一覧に残しています」）がそれに寄りかかっている。
   */
  it('競合したときは partly-applied になり、退避は一覧に残る', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('mine\n', 'my work')
    commit('a.txt', 'theirs\n', 'someone else')

    const [entry] = await readEntries()
    const result = await applyGitStashPop(entry.index, entry.shortHash)

    expect(result.outcome).toEqual({
      status: 'partly-applied',
      completed: 'stash-apply',
      reason: 'unresolved-conflicts'
    })
    // 中身は作業ツリーへ書き込まれている（押し直させてはいけない根拠）。
    expect(readFile('a.txt')).toContain('<<<<<<<')
    expect(stashSubjects()).toHaveLength(1)
    expect(readyOf(result.repository).changes.conflicted).toHaveLength(1)
  })

  /**
   * 競合との対比。
   *
   * こちらは**何も起きていない** ── stderr に理由が出るので、分類の表が当たる。
   * 順番を逆（stdout を先に見る）にすると、どちらの場合も stdout に
   * `The stash entry is kept ...` が出るため取り違える。
   */
  it('上書きされるときは local-changes-blocked で、作業ツリーも一覧も動かない', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('stashed\n', 'my work')
    writeFile('a.txt', 'in progress\n')

    const [entry] = await readEntries()
    const result = await applyGitStashPop(entry.index, entry.shortHash)

    expect(result.outcome).toEqual({ status: 'failed', reason: 'local-changes-blocked' })
    expect(readFile('a.txt')).toBe('in progress\n')
    expect(stashSubjects()).toHaveLength(1)
  })

  /**
   * 3-8-6 が開けたままにしていた穴が塞がっていること。
   *
   * 「作業ツリーの変更が上書きされるため実行できませんでした。Commit するか
   * **退避して**からお試しください。」という文言は 3-8-5 から出ていたが、
   * 退避する手立てがアプリの中に無かった。
   */
  it('退避 → 切り替え → 戻す が通る（切り替えが断られる場面の出口になっている）', async () => {
    commit('a.txt', 'base\n', 'first')
    git('switch', '--quiet', '--create', 'other')
    commit('a.txt', 'other\n', 'other change')
    git('switch', '--quiet', 'main')
    writeFile('a.txt', 'work in progress\n')

    // 退避する前は、git が切り替えを断る。
    expect(() => git('switch', 'other')).toThrow()

    const pushed = await applyGitStashPush()

    expect(pushed.outcome).toEqual({ status: 'applied' })

    // 避けた後は通る。
    git('switch', '--quiet', 'other')
    git('switch', '--quiet', 'main')

    const [entry] = await readEntries()
    const popped = await applyGitStashPop(entry.index, entry.shortHash)

    expect(popped.outcome).toEqual({ status: 'applied' })
    expect(readFile('a.txt')).toBe('work in progress\n')
  })

  /*
    マージの途中で戻そうとした場合（Session 3-8-22A で理由が変わった）──
    退避すると同じく、途中の操作そのものを断る表が先に効く。
  */
  it('マージの途中は operation-in-progress として断る', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('mine\n', 'my work')
    commit('b.txt', 'base\n', 'add b')
    git('switch', '--quiet', '--create', 'other', 'HEAD~1')
    commit('b.txt', 'theirs\n', 'other b')
    expect(() => git('merge', 'main')).toThrow()

    const [entry] = await readEntries()
    const result = await applyGitStashPop(entry.index, entry.shortHash)

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
    expect(stashSubjects()).toHaveLength(1)
  })

  /*
    途中の操作が無いのに競合だけが残っている形（`stash pop` の競合）。
    ここは 3-8-15 からの `unresolved-conflicts` のまま。
  */
  it('途中の操作が無い競合（stash pop）は unresolved-conflicts のまま', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('mine\n', 'my work')
    commit('a.txt', 'other\n', 'other change')

    try {
      git('stash', 'pop')
    } catch {
      // 競合は想定どおり（退避は一覧に残る）。
    }

    const [entry] = await readEntries()
    const result = await applyGitStashPop(entry.index, entry.shortHash)

    expect(result.outcome).toEqual({ status: 'failed', reason: 'unresolved-conflicts' })
    expect(stashSubjects()).toHaveLength(1)
  })
})

describeWithGit('applyGitStashDrop', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('指した1件だけを捨てる', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('one\n', 'first stash')
    stash('two\n', 'second stash')

    const entries = await readEntries()
    const target = entries[1]
    const result = await applyGitStashDrop(target.index, target.shortHash)

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(stashSubjects()).toHaveLength(1)
    expect(stashSubjects()[0]).toContain('second stash')
    // 作業ツリーには1文字も触らない。
    expect(readFile('a.txt')).toBe('base\n')
  })

  /**
   * 番号がずれることの実体。
   *
   * ここが「hash を一緒に渡す」という設計そのものの根拠になる ── 消した後、
   * それより後ろに居た退避の番号が繰り上がる。
   */
  it('捨てると、それより後ろの番号が繰り上がる', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('one\n', 'first stash')
    stash('two\n', 'second stash')
    stash('three\n', 'third stash')

    const before = await readEntries()
    const oldest = before[2]

    expect(oldest.index).toBe(2)

    const middle = before[1]

    await applyGitStashDrop(middle.index, middle.shortHash)

    const after = await readEntries()
    const moved = after.find((entry) => entry.shortHash === oldest.shortHash)

    // 同じ退避が、違う番号で並んでいる。
    expect(moved?.index).toBe(1)
  })

  /**
   * このファイルでいちばん確かめたいもう1つ。
   *
   * 一覧を出してから押すまでの間に端末で `git stash` を1回打たれると、
   * その番号は別の退避を指す ── **確かめずに動かすと、押した人が見ていない
   * 退避が捨てられる。** 突き合わせが効いていれば、git は1回も動かない。
   */
  it('番号がずれていたら、git を動かさずに断る', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('one\n', 'first stash')
    stash('two\n', 'second stash')

    const listed = await readEntries()
    const target = listed[1]

    expect(target.subject).toContain('first stash')

    // 画面を見ている間に、端末で1つ避けられた（全部が1つずつ後ろへずれる）。
    stash('three\n', 'third stash')

    const result = await applyGitStashDrop(target.index, target.shortHash)

    expect(result.outcome).toEqual({ status: 'failed', reason: 'stash-not-found' })
    // 3件とも残っている（別の退避を巻き添えにしていない）。
    expect(stashSubjects()).toHaveLength(3)
  })

  it('戻す側でも、番号がずれていたら git を動かさない', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('one\n', 'first stash')
    stash('two\n', 'second stash')

    const listed = await readEntries()
    const target = listed[1]

    stash('three\n', 'third stash')

    const result = await applyGitStashPop(target.index, target.shortHash)

    expect(result.outcome).toEqual({ status: 'failed', reason: 'stash-not-found' })
    expect(stashSubjects()).toHaveLength(3)
    // 作業ツリーにも何も戻っていない。
    expect(readFile('a.txt')).toBe('base\n')
  })

  it('退避が1件も無ければ stash-not-found', async () => {
    commit('a.txt', 'base\n', 'first')

    const result = await applyGitStashDrop(0, 'abc1234')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'stash-not-found' })
  })

  it('Workspace が開かれていなければ not-ready（git を動かさない）', async () => {
    commit('a.txt', 'base\n', 'first')
    stash('one\n', 'first stash')

    const listed = await readEntries()
    const target = listed[0]

    workspace = null

    const result = await applyGitStashDrop(target.index, target.shortHash)

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})
