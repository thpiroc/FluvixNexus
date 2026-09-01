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
 * 本物の git に対するブランチの一覧 / 切り替え / 作成 / 削除 / rename の検証
 * （Session 3-8-6 / 3-8-13 / 3-8-14）。
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
 * ## Session 3-8-13 で、作成に始点が1つ増えた
 *
 * 履歴の commit を始点にすると、作成もまた**作業ツリーの中身を書き換える**
 * 側に回る（3-8-6 までの作成は HEAD から作るので1文字も動かなかった）。
 * したがって確かめることが増える。
 *
 *   - 渡した始点の上に作られ、そこへ切り替わる（`--end-of-options` の位置）
 *   - マージ commit と、履歴の最初の commit も始点にできる
 *   - 始点が解けないときに `commit-not-found`（`branch-not-found` ではない）
 *   - 断られたときに**ブランチも作られない**（`switch --create` が1回で行う）
 *
 * ## Session 3-8-14 で、作業ツリーに触らない2つが加わった
 *
 * 削除と rename が動かすのは `git branch` で、書き換えるのは ref 1つになる ──
 * したがって固定したいことが**裏返る。** 3-8-6 / 3-8-13 で確かめたのが
 * 「書きかけが失われないこと」だったのに対し、こちらは
 * **断られたときに1つも消えていない / 動いていないこと**にあたる。
 *
 *   - 未マージのブランチは断られ、**ref も指す先もそのまま残る**（`-D` を持たない）
 *   - 今チェックアウトしているブランチは、git を動かす前に断る
 *   - 行き先が実在する rename は断り、**相手のブランチが1文字も動かない**（`-M` を渡さない）
 *   - 大文字小文字だけの改名は**通る**（`--force` の使いどころが1点であること）
 *   - 削除も rename も、未コミットの変更を消さない
 *   - rename の後、追跡先は古い remote 側の名前を指したまま残る（対象外にした判断）
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `listGitBranches` / `applyGitSwitchBranch` / `applyGitCreateBranch` /
 * `applyGitDeleteBranch` / `applyGitRenameBranch` で、
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

const {
  listGitBranches,
  applyGitSwitchBranch,
  applyGitCreateBranch,
  applyGitDeleteBranch,
  applyGitRenameBranch
} = await import('./gitBranches')

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

describeWithGit('listGitBranches', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
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

describeWithGit('applyGitCreateBranch', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('作って、そのまま切り替わる', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitCreateBranch('feature/x', null)

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
    const result = await applyGitCreateBranch('feature/x', null)

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

    const result = await applyGitCreateBranch('rescue', null)

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'rescue' })
  })

  it('作業ツリーの書きかけは、新しいブランチへそのまま付いてくる', async () => {
    commit('a.txt', 'a\n', 'first')
    writeFile('a.txt', 'work in progress\n')

    const result = await applyGitCreateBranch('feature/x', null)

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readFile('a.txt')).toBe('work in progress\n')
    expect(readyOf(result.repository).changes.unstaged).toHaveLength(1)
  })

  /**
   * 履歴の commit を始点にする（Session 3-8-13）。
   *
   * ここで実物にしか確かめられないのは「git が実際にどう受け取るか」になる ──
   * `--end-of-options` を名前の**後ろ**に置いた形が本当に通るのか、始点が
   * 解けなかったときに何と言うのか、断られたときに ref が残らないのかは、
   * どれも実装ではなく git が決める。
   */
  describe('始点を渡す（Session 3-8-13）', () => {
    /**
     * `switch --create <name> --end-of-options <hash>` が通ること。
     *
     * 3-8-6 の時点では「`--create` は必ず最後に置く」と書いていた（位置引数が
     * 1つも無かったため）。その後ろに置けるのは始点だけ、というのがここで
     * 確かめている形になる ── 名前の**手前**に `--end-of-options` を挟むと、
     * 名前が始点として読まれて `invalid reference` になる。
     */
    it('指した commit の上にブランチが作られ、そこへ切り替わる', async () => {
      commit('a.txt', 'first\n', 'first')
      const startPoint = git('rev-parse', '--short', 'HEAD').trim()
      commit('a.txt', 'second\n', 'second')

      const result = await applyGitCreateBranch('feature/from-history', startPoint)

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(headOf(result.repository)).toEqual({
        kind: 'branch',
        name: 'feature/from-history'
      })
      // 新しいブランチが指しているのは、渡した始点そのもの（HEAD ではない）。
      expect(git('rev-parse', '--short', 'feature/from-history').trim()).toBe(startPoint)
      // 作業ツリーもそこへ戻っている（`switch` なので中身が入れ替わる）。
      expect(readFile('a.txt')).toBe('first\n')
    })

    /**
     * マージ commit も始点にできる（3-8-12 の差分との対比）。
     *
     * 差分は親が2つ以上あると「どちらと比べるか」が決まらないため断っている。
     * 始点にはその問いが無く、**指す先は1つに決まる** ── 画面の側でも
     * マージの行に ⑂ を出してあり（GitHistoryOverlay.tsx）、それが
     * git の上でも本当に通ることをここで固定する。
     */
    it('マージ commit も始点にできる', async () => {
      commit('a.txt', 'a\n', 'first')
      git('switch', '--quiet', '--create', 'side')
      commit('side.txt', 's\n', 'on side')
      git('switch', '--quiet', 'main')
      commit('main.txt', 'm\n', 'on main')
      git('merge', '--quiet', '--no-ff', '-m', 'merge side', 'side')

      const mergeHash = git('rev-parse', '--short', 'HEAD').trim()
      // 親が2つあること自体を先に確かめる（`diff-tree` が黙る条件そのもの）。
      expect(git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/)).toHaveLength(3)

      const result = await applyGitCreateBranch('from-merge', mergeHash)

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(git('rev-parse', '--short', 'from-merge').trim()).toBe(mergeHash)
    })

    /** 履歴のいちばん最初の commit（親を持たない）も始点になる。 */
    it('履歴の最初の commit も始点にできる', async () => {
      commit('a.txt', 'a\n', 'first')
      const rootCommit = git('rev-parse', '--short', 'HEAD').trim()
      commit('b.txt', 'b\n', 'second')
      commit('c.txt', 'c\n', 'third')

      const result = await applyGitCreateBranch('from-root', rootCommit)

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(git('rev-parse', '--short', 'from-root').trim()).toBe(rootCommit)
      // 最初の commit まで戻っているので、後から足したものは作業ツリーに無い。
      expect(existsSync(join(root, 'c.txt'))).toBe(false)
    })

    /**
     * 始点が解けなかった。
     *
     * git の言い分は `invalid reference: <hash>` で、これは
     * **切り替え先のブランチが無いときとまったく同じ文**になる。始点を
     * 渡した作成だけが `commit-not-found` として読むのは、次の一手が
     * 違うため（履歴を開き直す / ブランチの一覧を開き直す）── その
     * 読み分けが本当に効いていることをここで固定する。
     */
    it('始点が見つからなければ commit-not-found で、ブランチも増えない', async () => {
      commit('a.txt', 'a\n', 'first')

      const result = await applyGitCreateBranch('feature/x', 'abcdef1')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'commit-not-found' })
      expect(localBranchNames()).toEqual(['main'])
    })

    /** 40 桁で渡したときだけ、git の言い方が変わる（`unable to read tree`）。 */
    it('40 桁の始点が見つからない場合も commit-not-found', async () => {
      commit('a.txt', 'a\n', 'first')

      const result = await applyGitCreateBranch(
        'feature/x',
        '0123456789abcdef0123456789abcdef01234567'
      )

      expect(result.outcome).toEqual({ status: 'failed', reason: 'commit-not-found' })
      expect(localBranchNames()).toEqual(['main'])
    })

    /**
     * ここが 3-8-13 でいちばん確かめたいところ。
     *
     * 始点を渡した切り替えは**作業ツリーの中身を書き換える**ため、書きかけが
     * あると git が断る。そのときブランチだけが残ると、「押したのに切り替わって
     * いないブランチ」が一覧に増える ── `switch --create` は1回で両方を
     * 行うので、断られれば ref も作られない（そのことを実物で押さえる）。
     *
     * アプリ側は確認を挟まない（切り替えてよいかを決めるのは git 自身）。
     * その判断に委ねてよいかどうかは、文言の分類では何も言えない。
     */
    it('書きかけが上書きされるなら断り、ブランチも作られない', async () => {
      commit('a.txt', 'a\n', 'first')
      const startPoint = git('rev-parse', '--short', 'HEAD').trim()
      commit('b.txt', 'b\n', 'second')
      // 始点には b.txt が無い ＝ 切り替えると消える。そこに書きかけを作る。
      writeFile('b.txt', 'work in progress\n')

      const result = await applyGitCreateBranch('feature/x', startPoint)

      expect(result.outcome).toEqual({ status: 'failed', reason: 'local-changes-blocked' })
      expect(localBranchNames()).toEqual(['main'])
      // 書きかけも HEAD も1文字も動かない。
      expect(readFile('b.txt')).toBe('work in progress\n')
      expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
    })

    /**
     * 始点が触らないファイルの書きかけは、そのまま付いてくる。
     *
     * 3-8-6 の「確認を挟まない判断が、普通の使い方を止めていないこと」と
     * 同じ形になる ── 断られる条件を実物で確かめたなら、断られない条件も
     * 同じだけ確かめておく必要がある。
     */
    it('始点が触らないファイルの書きかけは残る', async () => {
      commit('a.txt', 'a\n', 'first')
      const startPoint = git('rev-parse', '--short', 'HEAD').trim()
      commit('b.txt', 'b\n', 'second')
      writeFile('untracked.txt', 'still here\n')

      const result = await applyGitCreateBranch('feature/x', startPoint)

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(readFile('untracked.txt')).toBe('still here\n')
    })

    /** 名前が既にあれば、始点を渡していても上書きしない（`--force` を渡していない）。 */
    it('同じ名前があれば、始点を渡していても断る', async () => {
      commit('a.txt', 'a\n', 'first')
      const startPoint = git('rev-parse', '--short', 'HEAD').trim()
      commit('b.txt', 'b\n', 'second')
      git('branch', 'feature/x')

      const before = git('rev-parse', 'feature/x').trim()
      const result = await applyGitCreateBranch('feature/x', startPoint)

      expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-exists' })
      expect(git('rev-parse', 'feature/x').trim()).toBe(before)
    })
  })
})

describeWithGit('applyGitSwitchBranch', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
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
  /*
    マージの途中で切り替えようとした場合（Session 3-8-22A で理由が変わった）。

    3-8-20 までは競合の件数を見て `unresolved-conflicts` を返していたが、
    途中の操作そのものを断る表ができたのでそちらが先に断る
    （shared/git/inProgress.ts）── **解決し終えていても通さない**ので、
    こちらの理由の方が正確にあたる。

    競合はあるが途中の操作が無い場合（`stash pop` の競合）は
    `unresolved-conflicts` のままになる ── 下の確かめが対になっている。
  */
  it('マージの途中は operation-in-progress', async () => {
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

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
  })

  /*
    途中の操作が無いのに競合だけが残っている形（`stash pop` の競合。3-8-15）。

    ここは 3-8-6 からの `unresolved-conflicts` のまま ── **競合を理由に断る道が
    残っていること**を固定しておく（3-8-22A の表がすべてを飲み込んだわけでは
    ない、という線引きがここに出る）。
  */
  it('途中の操作が無い競合（stash pop）は unresolved-conflicts のまま', async () => {
    commit('a.txt', 'base\n', 'first')
    git('switch', '--quiet', '--create', 'feature/x')
    git('switch', '--quiet', 'main')

    writeFileSync(join(root, 'a.txt'), 'stashed\n', 'utf8')
    git('stash', 'push', '--quiet')
    commit('a.txt', 'other\n', 'other change')

    try {
      git('stash', 'pop')
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

/**
 * 削除（Session 3-8-14）。
 *
 * ## ここで固定したいのは「消えないこと」
 *
 * 切り替えのときに固定したかったのが「書きかけが失われないこと」だったのに対し、
 * 削除で固定したいのは**断られたときに1つも消えていないこと**になる ──
 * 分類の文言（gitFailure.test.ts）だけでは、`branch-not-merged` が返ったときに
 * ref が残っているかどうかを何も言わない。
 *
 * `-D` を持たないという判断が意味を持つのは、まさにそこにあたる。
 */
describeWithGit('applyGitDeleteBranch', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('マージ済みのブランチを消す', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'merged')

    const result = await applyGitDeleteBranch('merged')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(localBranchNames()).toEqual(['main'])
  })

  /*
    追跡先にマージ済みなら、HEAD にマージされていなくても `-d` は通る ──
    「今の枝にマージ済みか」ではないことを、実物に対して記録しておく
    （アプリはこの基準を持たず、git に委ねている）。
  */
  it('HEAD ではなく追跡先にマージ済みでも消せる', async () => {
    commit('a.txt', 'a\n', 'first')
    git('remote', 'add', 'origin', remotePath)
    git('switch', '--quiet', '--create', 'topic')
    commit('b.txt', 'b\n', 'second')
    git('push', '--quiet', '--set-upstream', 'origin', 'topic')
    git('switch', '--quiet', 'main')

    // main には topic の commit が入っていない。
    expect(git('branch', '--merged').includes('topic')).toBe(false)

    const result = await applyGitDeleteBranch('topic')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(localBranchNames()).toEqual(['main'])
  })

  /**
   * そこにしか無い commit があるブランチは消せない。
   *
   * **断りの文が出たことは、ref が残っていることを何も言わない。**
   * `for-each-ref` で名前が在ることまで確かめる。
   */
  it('未マージのブランチは断り、ref も消さない', async () => {
    commit('a.txt', 'a\n', 'first')
    git('switch', '--quiet', '--create', 'unmerged')
    commit('b.txt', 'b\n', 'second')
    const unmergedHead = git('rev-parse', 'unmerged').trim()
    git('switch', '--quiet', 'main')

    const result = await applyGitDeleteBranch('unmerged')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-merged' })
    expect(localBranchNames()).toContain('unmerged')
    // 指している先も1文字も動いていない。
    expect(git('rev-parse', 'unmerged').trim()).toBe(unmergedHead)
  })

  /**
   * 今そこに居るブランチは消せない。
   *
   * ここは**git を動かす前に**返る（gitBranches.ts の事前判定）── 画面の側でも
   * ✕ は押せないようにしてあり、これはその二重の備えにあたる。
   */
  it('今チェックアウトしているブランチは断る', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitDeleteBranch('main')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-checked-out' })
    expect(localBranchNames()).toEqual(['main'])
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
  })

  it('無いブランチを消そうとしたら branch-not-found', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitDeleteBranch('nope')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
    expect(localBranchNames()).toEqual(['main'])
  })

  /**
   * 作業ツリーに触らない。
   *
   * 切り替えと違って**書きかけがあっても断られない**し、消えもしない ──
   * だから確認で「未保存の変更があります」とは言わない（言うと嘘になる）。
   */
  it('未コミットの変更があっても消せて、その変更は残る', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'merged')
    writeFile('a.txt', 'work in progress\n')
    writeFile('untracked.txt', 'untracked\n')

    const result = await applyGitDeleteBranch('merged')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(readFile('a.txt')).toBe('work in progress\n')
    expect(readFile('untracked.txt')).toBe('untracked\n')
  })

  /*
    競合が残っている状態でも、ブランチの削除そのものは通る ── 切り替えの
    事前判定（`unresolved-conflicts`）をこちらに当てていないことの裏返しになる。
  */
  it('競合が残っていても、関係の無いブランチは消せる', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'merged')
    git('switch', '--quiet', '--create', 'feature/x')
    commit('a.txt', 'from feature\n', 'feature')
    git('switch', '--quiet', 'main')
    commit('a.txt', 'from main\n', 'main change')

    try {
      git('merge', 'feature/x')
    } catch {
      // 競合は想定どおり。
    }

    const result = await applyGitDeleteBranch('merged')

    expect(result.outcome).toEqual({ status: 'applied' })
  })

  it('Workspace が開かれていなければ not-ready', async () => {
    workspace = null

    const result = await applyGitDeleteBranch('main')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})

/**
 * rename（Session 3-8-14）。
 *
 * ## ここで固定したいのは3つ
 *
 *   - **失われるものが無い**（今のブランチを改名しても、書きかけが残る）
 *   - 行き先が実在するときは**相手のブランチが1文字も動かない**
 *   - 大文字小文字だけの改名が**通る**（`--force` の使いどころが1点であること）
 */
describeWithGit('applyGitRenameBranch', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('他のブランチの名前を変える（HEAD は動かない）', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'old-name')
    const target = git('rev-parse', 'old-name').trim()

    const result = await applyGitRenameBranch('old-name', 'new-name')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(localBranchNames()).toEqual(['main', 'new-name'])
    // 指している commit は同じ（付け替えではなく改名）。
    expect(git('rev-parse', 'new-name').trim()).toBe(target)
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'main' })
  })

  /**
   * 今そこに居るブランチも改名できる。
   *
   * git が HEAD を追随させ、**作業ツリーには何も起こらない** ── 応答に載る
   * 状態で、上のバーの表示がそのまま新しい名前に変わる。
   */
  it('今のブランチを改名すると HEAD が追随し、書きかけも残る', async () => {
    commit('a.txt', 'a\n', 'first')
    writeFile('a.txt', 'work in progress\n')
    writeFile('untracked.txt', 'untracked\n')

    const result = await applyGitRenameBranch('main', 'primary')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'primary' })
    expect(localBranchNames()).toEqual(['primary'])
    expect(readFile('a.txt')).toBe('work in progress\n')
    expect(readFile('untracked.txt')).toBe('untracked\n')
  })

  /**
   * 行き先が実在するときは断り、**相手を消さない。**
   *
   * `-M` を既定で渡していないことが、ここに現れる ── 渡していれば
   * `main` が消えて `feature/x` の中身に置き換わっていた。
   */
  it('行き先が既にあるときは branch-exists で、どちらの ref も動かない', async () => {
    commit('a.txt', 'a\n', 'first')
    git('switch', '--quiet', '--create', 'feature/x')
    commit('b.txt', 'b\n', 'second')
    git('switch', '--quiet', 'main')

    const mainHead = git('rev-parse', 'main').trim()
    const featureHead = git('rev-parse', 'feature/x').trim()

    const result = await applyGitRenameBranch('feature/x', 'main')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-exists' })
    expect(localBranchNames()).toEqual(['feature/x', 'main'])
    expect(git('rev-parse', 'main').trim()).toBe(mainHead)
    expect(git('rev-parse', 'feature/x').trim()).toBe(featureHead)
  })

  /**
   * 大文字小文字だけを変える改名。
   *
   * Windows（と既定の macOS）では ref の実体が同じファイルになるため、素の
   * `--move` は「既にある」と断る ── だがそのとき指されているのは
   * **改名しようとしているブランチ自身**なので、`--force` を立てて通す
   * （相手が自分自身であることを `branch --list` の完全名で確かめてある）。
   */
  it('大文字小文字だけを変える改名が通る', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature')
    const target = git('rev-parse', 'feature').trim()

    const result = await applyGitRenameBranch('feature', 'Feature')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(localBranchNames()).toEqual(['Feature', 'main'])
    expect(git('rev-parse', 'Feature').trim()).toBe(target)
  })

  it('今のブランチでも、大文字小文字だけを変える改名が通る', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitRenameBranch('main', 'Main')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(headOf(result.repository)).toEqual({ kind: 'branch', name: 'Main' })
    expect(localBranchNames()).toEqual(['Main'])
  })

  /**
   * 大文字小文字だけの違いでも、**その綴りちょうどの別のブランチが在れば断る。**
   *
   * 大文字小文字を区別しないファイルシステムでは2つが同時に在りえないので、
   * この確認が効くのは区別する側（Linux / 設定した macOS）になる。
   * どちらでも「相手を消さない」ことだけは変わらない、という形を残しておく。
   */
  it('同じ綴りのブランチが実在するときは、大文字違いでも断る', async () => {
    commit('a.txt', 'a\n', 'first')
    git('branch', 'feature')

    let bothExist = true

    try {
      git('branch', 'FEATURE')
    } catch {
      // 大文字小文字を区別しないファイルシステム。ここでは確かめられない。
      bothExist = false
    }

    if (!bothExist) {
      return
    }

    const featureHead = git('rev-parse', 'refs/heads/FEATURE').trim()

    const result = await applyGitRenameBranch('feature', 'FEATURE')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-exists' })
    expect(git('rev-parse', 'refs/heads/FEATURE').trim()).toBe(featureHead)
  })

  it('無いブランチを改名しようとしたら branch-not-found', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitRenameBranch('nope', 'other')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
    expect(localBranchNames()).toEqual(['main'])
  })

  /*
    同じ名前を打った。git を動かさずに返る（画面の側でも押せない）。
  */
  it('同じ名前への改名は nothing-to-do', async () => {
    commit('a.txt', 'a\n', 'first')

    const result = await applyGitRenameBranch('main', 'main')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    expect(localBranchNames()).toEqual(['main'])
  })

  /**
   * 追跡先は**付け替わらない。**
   *
   * `branch.<新名>.merge` は古い remote 側の名前を指したまま残る ── つまり
   * rename の後の Push は、改名前の名前の remote branch へ向かう。
   * 3-8-14 の対象外にした判断（remote 側は動かさない）を、実物で記録しておく
   * ── 黙って変わった日に気づけるようにするため。
   */
  it('追跡先は古い remote 側の名前を指したまま残る', async () => {
    commit('a.txt', 'a\n', 'first')
    git('remote', 'add', 'origin', remotePath)
    git('push', '--quiet', '--set-upstream', 'origin', 'main')

    const result = await applyGitRenameBranch('main', 'primary')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(git('config', '--get', 'branch.primary.merge').trim()).toBe('refs/heads/main')
    // remote 側の名前は1つも変わっていない。
    expect(git('ls-remote', '--heads', 'origin').includes('refs/heads/main')).toBe(true)
  })

  it('Workspace が開かれていなければ not-ready', async () => {
    workspace = null

    const result = await applyGitRenameBranch('main', 'primary')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})
