import { execFileSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitRepositoryState, GitUpstreamStatus } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する Push / Pull / Commit & Push の検証（Session 3-8-5）。
 *
 * ## 相手を用意する ── ネットワークにも認証にも触らずに
 *
 * remote は**同じ PC の bare リポジトリ**にしてある。`git` にとって
 * それは他の remote と何も変わらず、`push` / `fetch` / `merge --ff-only` は
 * 同じ経路を通る ── 変わるのは transport（ファイルシステム）だけになる。
 *
 * この形にすると、どの PC でも・回線が無くても・資格情報が1つも無くても
 * 次を実物に対して固定できる。
 *
 *   - 初回の Push が追跡先まで作ること（`--set-upstream`）
 *   - 送るものが無いときに `nothing-to-do` として返ること
 *   - remote 側が先に進んでいるときに `push-rejected` になること
 *   - Pull が `fetch` → `merge --ff-only` として動き、枝分かれでは**取り込まない**こと
 *   - 作業ツリーの書きかけが上書きされないこと
 *   - **Commit & Push が途中で止まったとき、commit が残ったまま `partly-applied` になること**
 *   - Push できない土台（remote が無い / detached）では、**commit を積まずに**断ること
 *
 * 認証とネットワークの失敗だけはここでは作れない（相手が要る）。そちらは
 * 文言の分類として gitFailure.test.ts が固定してあり、実際の振る舞いは
 * production 実機での確認になる。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `applyGitPush` / `applyGitPull` / `applyGitCommitAndPush` で、
 * その下の runGit / gitCommands / gitQueue / gitFailure はすべて本番のものが動く。
 * 差し替えるのは2つだけ（electron の logger と、現在の Workspace）。
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

const { applyGitPush, applyGitPull, applyGitCommitAndPush } = await import('./gitSync')

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

function upstreamOf(repository: GitRepositoryState): GitUpstreamStatus | null {
  return readyOf(repository).upstream
}

/** 手元に積まれている commit の数。 */
function commitCount(): number {
  const counted = git('rev-list', '--count', 'HEAD').trim()

  return counted === '' ? 0 : Number.parseInt(counted, 10)
}

/** remote 側の main に積まれている commit の数。 */
function remoteCommitCount(): number {
  return Number.parseInt(gitIn(remotePath, 'rev-list', '--count', 'main').trim(), 10)
}

/** remote 側の main が指している commit。 */
function remoteHead(): string {
  return gitIn(remotePath, 'rev-parse', 'main').trim()
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * `push.default` / `pull.rebase` / `credential.helper` はどれも開発者の PC に
 * 入っていておかしくない設定で、しかも**この塊が確かめている振る舞いそのもの**を
 * 変えうる ── 見えなくしておかないと、通る PC と通らない PC が出る
 * （gitCommitRepository.test.ts と同じ理由）。
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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-sync-')))

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

/** remote を繋ぐ（繋がないままの状態も確かめたいので、既定では繋がない）。 */
function addRemote(): void {
  git('remote', 'add', 'origin', remotePath)
}

/**
 * remote 側を1つ先へ進める。
 *
 * 別の作業コピーから push する ── **手元のリポジトリを経由しない**のが要点で、
 * これで「他の人が先に送った」という、いちばん普通に起こる状態が作れる。
 */
function advanceRemote(relativePath: string, content: string, message: string): void {
  const other = join(area, `other-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  gitIn(area, 'clone', '--quiet', remotePath, other)
  configure(other)
  writeFileSync(join(other, relativePath), content, 'utf8')
  gitIn(other, 'add', '--', relativePath)
  gitIn(other, 'commit', '--quiet', '-m', message)
  gitIn(other, 'push', '--quiet', 'origin', 'main')
}

describeWithGit('applyGitPush', () => {
  describe('基本', () => {
    /*
      いちばん人が触る場面。追跡先がまだ無い状態から、送ることと
      追跡先を作ることが**同じ1回**で終わる（別のボタンにしない）。
    */
    it('初回の Push で追跡先まで作る', async () => {
      addRemote()
      commit('a.txt', 'a\n', 'first')

      const result = await applyGitPush()

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(remoteCommitCount()).toBe(1)
      // 応答がそのまま操作後の状態になっている（取り直しは要らない）。
      expect(upstreamOf(result.repository)).toEqual({
        name: 'origin/main',
        ahead: 0,
        behind: 0
      })
    })

    it('2回目以降の Push は追跡先へ送る', async () => {
      addRemote()
      commit('a.txt', 'a\n', 'first')
      await applyGitPush()
      commit('b.txt', 'b\n', 'second')

      const result = await applyGitPush()

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(remoteCommitCount()).toBe(2)
      expect(upstreamOf(result.repository)?.ahead).toBe(0)
    })

    /*
      追跡先と同じ名前でなくても送れること。`push.default` の既定（`simple`）は
      ここで断るため、`upstream` に固定してある（gitCommands.ts）。
    */
    it('追跡先と違う名前のブランチでも、追跡先へ送れる', async () => {
      addRemote()
      commit('a.txt', 'a\n', 'first')
      await applyGitPush()
      git('branch', '--quiet', 'feature')
      git('checkout', '--quiet', 'feature')
      git('branch', '--set-upstream-to=origin/main', 'feature')
      commit('c.txt', 'c\n', 'from feature')

      const result = await applyGitPush()

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(remoteCommitCount()).toBe(2)
    })
  })

  describe('押す前に分かること', () => {
    /*
      黙って成功にすると、押しても何も起きないのに成功と出る ──
      「送れたのか、送るものが無かったのか」が区別できなくなる。
    */
    it('送る Commit が無ければ nothing-to-do（git を動かさない）', async () => {
      addRemote()
      commit('a.txt', 'a\n', 'first')
      await applyGitPush()

      const result = await applyGitPush()

      expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
      expect(remoteCommitCount()).toBe(1)
    })

    it('commit が1つも無ければ nothing-to-do', async () => {
      addRemote()
      writeFile('a.txt', 'a\n')

      const result = await applyGitPush()

      expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    })

    it('remote が1つも無ければ no-remote', async () => {
      commit('a.txt', 'a\n', 'first')

      const result = await applyGitPush()

      expect(result.outcome).toEqual({ status: 'failed', reason: 'no-remote' })
    })

    /* detached HEAD には「今のブランチ」が無く、送り先を決める土台が無い。 */
    it('detached HEAD では not-on-branch', async () => {
      addRemote()
      commit('a.txt', 'a\n', 'first')
      git('checkout', '--quiet', '--detach')

      const result = await applyGitPush()

      expect(result.outcome).toEqual({ status: 'failed', reason: 'not-on-branch' })
      // git は1回も動いていない ＝ remote には何も作られていない。
      expect(gitIn(remotePath, 'branch', '--list').trim()).toBe('')
    })
  })

  /*
    remote 側が先に進んでいる ── 次の一手が **Pull**（隣のボタン）になる、
    このパネルで唯一の失敗にあたる。
  */
  it('remote が先に進んでいれば push-rejected', async () => {
    addRemote()
    commit('a.txt', 'a\n', 'first')
    await applyGitPush()

    advanceRemote('remote-only.txt', 'remote\n', 'from someone else')
    commit('mine.txt', 'mine\n', 'mine')

    const before = remoteHead()
    const result = await applyGitPush()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'push-rejected' })
    // 断られた ＝ remote 側は1文字も変わっていない。
    expect(remoteHead()).toBe(before)
    // 失敗しても一覧（状態）は取り直したものが返る。
    expect(readyOf(result.repository).head).toEqual({ kind: 'branch', name: 'main' })
  })
})

describeWithGit('applyGitPull', () => {
  /** 追跡先まで作った状態から始める。 */
  async function withUpstream(): Promise<void> {
    addRemote()
    commit('a.txt', 'a\n', 'first')
    await applyGitPush()
  }

  describe('基本', () => {
    it('remote の変更を取り込む', async () => {
      await withUpstream()
      advanceRemote('added.txt', 'added\n', 'from someone else')

      const result = await applyGitPull()

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(existsSync(join(root, 'added.txt'))).toBe(true)
      expect(commitCount()).toBe(2)
      expect(upstreamOf(result.repository)).toEqual({ name: 'origin/main', ahead: 0, behind: 0 })
    })

    /*
      取り込むものが無くても成功。Pull の目的は**取ってくること**にあり、
      それは通っている ── 押した意味はあった、という結末にあたる。
    */
    it('取り込むものが無くても applied', async () => {
      await withUpstream()

      const result = await applyGitPull()

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(commitCount()).toBe(1)
    })

    /* 作業ツリーの書きかけは、取り込みで消えない（触れていない別のファイル）。 */
    it('関係の無い書きかけは残る', async () => {
      await withUpstream()
      advanceRemote('added.txt', 'added\n', 'from someone else')
      writeFile('draft.txt', 'draft\n')

      const result = await applyGitPull()

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(readyOf(result.repository).changes.untracked.map((c) => c.relativePath)).toEqual([
        'draft.txt'
      ])
    })
  })

  describe('取り込まずに断る', () => {
    /*
      Session 3-8-5 でいちばん守りたいところ。merge か rebase かは
      リポジトリの流儀で決まる判断で、アプリが黙って選ばない。
    */
    it('枝分かれしていれば diverged（手元は1文字も変わらない）', async () => {
      await withUpstream()
      advanceRemote('remote-only.txt', 'remote\n', 'from someone else')
      commit('mine.txt', 'mine\n', 'mine')

      const before = git('rev-parse', 'HEAD').trim()
      const result = await applyGitPull()

      expect(result.outcome).toEqual({ status: 'failed', reason: 'diverged' })
      expect(git('rev-parse', 'HEAD').trim()).toBe(before)
      expect(existsSync(join(root, 'remote-only.txt'))).toBe(false)
      /*
        fetch は通っているので、取ってきた分だけは分かるようになる ──
        「何も起きなかった」ではなく「取り込めなかった」が画面に出る。
      */
      expect(upstreamOf(result.repository)).toEqual({ name: 'origin/main', ahead: 1, behind: 1 })
    })

    it('作業ツリーの変更が上書きされる場合は local-changes-blocked', async () => {
      await withUpstream()
      advanceRemote('a.txt', 'from someone else\n', 'edit a.txt')
      writeFile('a.txt', 'my draft\n')

      const result = await applyGitPull()

      expect(result.outcome).toEqual({ status: 'failed', reason: 'local-changes-blocked' })
      // git は上書きせずに断る ＝ 書きかけは失われない。
      expect(git('show', ':a.txt')).toBe('a\n')
      expect(readyOf(result.repository).changes.unstaged.map((c) => c.relativePath)).toEqual([
        'a.txt'
      ])
    })

    it('追跡先が無ければ no-upstream（git を動かさない）', async () => {
      addRemote()
      commit('a.txt', 'a\n', 'first')

      const result = await applyGitPull()

      expect(result.outcome).toEqual({ status: 'failed', reason: 'no-upstream' })
    })

    it('detached HEAD では not-on-branch', async () => {
      await withUpstream()
      git('checkout', '--quiet', '--detach')

      const result = await applyGitPull()

      expect(result.outcome).toEqual({ status: 'failed', reason: 'not-on-branch' })
    })
  })
})

describeWithGit('applyGitCommitAndPush', () => {
  it('Commit してそのまま Push する', async () => {
    addRemote()
    commit('a.txt', 'a\n', 'first')
    await applyGitPush()

    writeFile('b.txt', 'b\n')
    git('add', '--', 'b.txt')

    const result = await applyGitCommitAndPush('b を足した')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(commitCount()).toBe(2)
    expect(remoteCommitCount()).toBe(2)
    expect(readyOf(result.repository).changes.staged).toEqual([])
  })

  it('追跡先がまだ無くても、Commit して初回の Push まで行う', async () => {
    addRemote()
    writeFile('a.txt', 'a\n')
    git('add', '--', 'a.txt')

    const result = await applyGitCommitAndPush('最初のコミット')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(remoteCommitCount()).toBe(1)
    expect(upstreamOf(result.repository)).toEqual({ name: 'origin/main', ahead: 0, behind: 0 })
  })

  /**
   * Session 3-8-5 でいちばん取り違えてはいけない結末。
   *
   * 失敗に丸めると、利用者は同じ内容をもう一度 Commit する ──
   * 履歴に同じ commit が2つ積まれることになる。
   */
  describe('途中で止まったとき（partly-applied）', () => {
    it('Push が断られても Commit は残る', async () => {
      addRemote()
      commit('a.txt', 'a\n', 'first')
      await applyGitPush()

      advanceRemote('remote-only.txt', 'remote\n', 'from someone else')
      writeFile('b.txt', 'b\n')
      git('add', '--', 'b.txt')

      const result = await applyGitCommitAndPush('b を足した')

      expect(result.outcome).toEqual({ status: 'partly-applied', reason: 'push-rejected' })
      // Commit は作られている（もう一度 Commit させない）。
      expect(commitCount()).toBe(2)
      expect(git('log', '-1', '--format=%B').trim()).toBe('b を足した')
      // 応答の一覧も Commit 後のもの（ステージ済みは空になっている）。
      expect(readyOf(result.repository).changes.staged).toEqual([])
    })
  })

  /**
   * 「Push できない土台は Commit の前に見る」の担保。
   *
   * 見ないまま進めると、**通らないと分かっている Push のために commit が積まれる。**
   */
  describe('Push できない土台では、commit を積まずに断る', () => {
    it('remote が無ければ no-remote（commit は作らない）', async () => {
      commit('a.txt', 'a\n', 'first')
      writeFile('b.txt', 'b\n')
      git('add', '--', 'b.txt')

      const result = await applyGitCommitAndPush('b を足した')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'no-remote' })
      expect(commitCount()).toBe(1)
      // ステージ済みはそのまま残る（押し直せる）。
      expect(readyOf(result.repository).changes.staged.map((c) => c.relativePath)).toEqual([
        'b.txt'
      ])
    })

    it('detached HEAD では not-on-branch（commit は作らない）', async () => {
      addRemote()
      commit('a.txt', 'a\n', 'first')
      git('checkout', '--quiet', '--detach')
      writeFile('b.txt', 'b\n')
      git('add', '--', 'b.txt')

      const result = await applyGitCommitAndPush('b を足した')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'not-on-branch' })
      expect(commitCount()).toBe(1)
    })
  })

  /*
    Commit が通らなければ Push もしない（送るものが増えていない）。
    分類は Commit のもの（`git:commit` と同じ経路を通っている）。
  */
  it('ステージ済みが無ければ nothing-to-do（Push しない）', async () => {
    addRemote()
    commit('a.txt', 'a\n', 'first')
    await applyGitPush()
    writeFile('b.txt', 'b\n')

    const result = await applyGitCommitAndPush('b を足した')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    expect(commitCount()).toBe(1)
    expect(remoteCommitCount()).toBe(1)
  })
})
