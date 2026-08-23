import { execFileSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { GIT_COMMIT_MESSAGE_MAX_LENGTH, type GitRepositoryState } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する Commit の検証（Session 3-8-4）。
 *
 * ## なぜ実物を使うか
 *
 * commitMessage.test.ts が固定するのは「この文字列を通すか」までで、
 * **通した文字列を git がどう記録するか**は誰も確かめていない。日本語・引用符・
 * 改行・`#` で始まる行は、どれも「渡し方を1つ間違えると別のものが記録される」
 * 値にあたる（gitStageRepository.test.ts と同じ理由）。
 *
 * とくに実物でしか確かめられないのが次になる。
 *
 *   - **staged だけが Commit される**（unstaged / untracked を巻き込まない）
 *   - 標準入力から渡したメッセージがそのまま記録されること（`git log` で読む）
 *   - `#` で始まるメッセージが消えないこと（`--cleanup=whitespace` が効いている）
 *   - 初回 commit（HEAD がまだ無い）でも同じ経路で通ること
 *   - 名乗りが無いときに **commit を作らずに** 失敗すること
 *   - hook が止めたときに `hook-rejected` として返ること
 *   - 同じ瞬間に始めた Commit と Stage が、index の取り合いで失敗しないこと
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `applyGitCommit` で、その下の runGit / gitCommands / gitQueue /
 * gitFailure はすべて本番のものが動く。差し替えるのは2つだけ
 * （electron の logger と、現在の Workspace）。
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

let root: string

/** Main が持つ「今の Workspace」。テストごとに一時リポジトリを指す。 */
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { applyGitCommit } = await import('./gitCommit')
const { applyGitStage } = await import('./gitStage')

/** リポジトリの中で git を1回動かす（テスト自身の準備・確認用）。 */
function git(...args: readonly string[]): string {
  return execFileSync(gitExecutable as string, [...args], {
    cwd: root,
    env: createGitEnvironment(process.env),
    encoding: 'utf8',
    windowsHide: true
  })
}

function writeFile(relativePath: string, content: string): void {
  writeFileSync(join(root, relativePath), content, 'utf8')
}

/** 応答に載っている状態から一覧を取り出す（ready でなければ不合格）。 */
function changesOf(repository: GitRepositoryState): {
  readonly staged: readonly { readonly relativePath: string }[]
  readonly unstaged: readonly { readonly relativePath: string }[]
  readonly untracked: readonly { readonly relativePath: string }[]
} {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return (repository as Extract<GitRepositoryState, { status: 'ready' }>).changes
}

function paths(changes: readonly { readonly relativePath: string }[]): string[] {
  return changes.map((change) => change.relativePath)
}

/** 直近の commit の本文（`git log` から読む ＝ 実際に記録されたもの）。 */
function lastCommitMessage(): string {
  return git('log', '-1', '--format=%B').replace(/\n+$/, '')
}

/** 積まれている commit の数。 */
function commitCount(): number {
  return git('rev-list', '--count', 'HEAD').trim() === ''
    ? 0
    : Number.parseInt(git('rev-list', '--count', 'HEAD').trim(), 10)
}

/**
 * 実行可能な hook を置く。
 *
 * Windows でも Git for Windows は付属の sh で hook を走らせるため、
 * `#!/bin/sh` のスクリプトがそのまま動く。
 */
function writeHook(name: string, body: string): void {
  const path = join(root, '.git', 'hooks', name)

  writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf8')
  chmodSync(path, 0o755)
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * `user.email` を外したときの挙動は、**外した先に何も無い**ときにしか
 * 確かめられない ── 開発者の PC には `--global` の名乗りが入っているのが普通で、
 * リポジトリ側を外しただけでは git はそちらへ落ちる（実際にそうなった）。
 *
 * 名乗り以外にも `commit.gpgsign` / `core.hooksPath` / `commit.template` など、
 * 結果を変えうる設定が global には入りうる。**この塊が読むのは
 * 一時リポジトリの設定だけ**にしておく方が、どの PC でも同じ答えになる。
 */
const originalGitConfigEnv = {
  global: process.env.GIT_CONFIG_GLOBAL,
  system: process.env.GIT_CONFIG_SYSTEM
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-commit-')))

  // 実在しないパスを指すと、git はその設定ファイルを空として扱う。
  process.env.GIT_CONFIG_GLOBAL = join(root, 'no-such-gitconfig')
  process.env.GIT_CONFIG_SYSTEM = join(root, 'no-such-system-gitconfig')

  git('init', '--quiet', '--initial-branch=main', '.')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Fluvix Nexus Test')
  git('config', 'core.autocrlf', 'false')
  // 環境（GPG 鍵の設定など）に結果を左右されないようにする。
  git('config', 'commit.gpgsign', 'false')

  workspace = {
    id: 'test-workspace',
    rootPath: root,
    displayName: 'test',
    openedAt: Date.now(),
    exists: true
  }
})

afterEach(async () => {
  workspace = null
  restoreEnv('GIT_CONFIG_GLOBAL', originalGitConfigEnv.global)
  restoreEnv('GIT_CONFIG_SYSTEM', originalGitConfigEnv.system)
  await rm(root, { recursive: true, force: true })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

describeWithGit('applyGitCommit', () => {
  /** 最初の commit を1つ作る（HEAD がある状態にする）。 */
  function commitInitial(): void {
    writeFile('tracked.txt', 'first\n')
    git('add', '--', 'tracked.txt')
    git('commit', '--quiet', '-m', 'initial')
  }

  describe('基本', () => {
    it('staged のファイルを Commit する', async () => {
      commitInitial()
      writeFile('tracked.txt', 'second\n')
      git('add', '--', 'tracked.txt')

      const result = await applyGitCommit('2回目の変更')

      expect(result.outcome).toEqual({ status: 'applied' })
      // 応答がそのまま操作後の一覧になっている（取り直しは要らない）。
      expect(paths(changesOf(result.repository).staged)).toEqual([])
      expect(lastCommitMessage()).toBe('2回目の変更')
      expect(commitCount()).toBe(2)
    })

    it('複数の staged ファイルを1回で Commit する', async () => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      writeFile('b.txt', 'b\n')
      git('add', '--', 'a.txt', 'b.txt')

      const result = await applyGitCommit('2件まとめて')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(paths(changesOf(result.repository).staged)).toEqual([])
      expect(git('show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/).sort()).toEqual([
        'a.txt',
        'b.txt'
      ])
    })

    /*
      初回 commit は「いちばん人が触る場面」にあたる。HEAD がまだ何も指していない
      状態でも、通常の Commit とまったく同じ経路で通ることを固定しておく。
    */
    it('初回 Commit（HEAD がまだ無い）を通常と同じ経路で行う', async () => {
      writeFile('first.txt', 'hello\n')
      git('add', '--', 'first.txt')

      const result = await applyGitCommit('最初のコミット')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(commitCount()).toBe(1)
      expect(lastCommitMessage()).toBe('最初のコミット')
      expect(paths(changesOf(result.repository).staged)).toEqual([])
    })
  })

  /**
   * Session 3-8-4 でいちばん大事な保証。
   *
   * `git commit` に pathspec も `-a` も渡していないため、対象は index の中身だけに
   * なる（main/git/gitCommit.ts）。この形が崩れていないことを、混ざった状態で確かめる。
   */
  describe('staged だけが Commit される', () => {
    it('staged / unstaged / untracked が混ざっていても staged だけが入る', async () => {
      commitInitial()

      // A: staged
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')
      // B: unstaged（追跡済みだが index に載せていない）
      writeFile('tracked.txt', 'changed\n')
      // C: untracked
      writeFile('c.txt', 'c\n')

      const result = await applyGitCommit('A だけ')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('a.txt')

      const changes = changesOf(result.repository)

      // B と C はそのまま残る。
      expect(paths(changes.staged)).toEqual([])
      expect(paths(changes.unstaged)).toEqual(['tracked.txt'])
      expect(paths(changes.untracked)).toEqual(['c.txt'])
    })

    it('同じファイルの staged 分だけが入り、その後の書き換えは残る', async () => {
      commitInitial()
      writeFile('tracked.txt', 'staged\n')
      git('add', '--', 'tracked.txt')
      // Stage した後にもう一度書き換える（index と作業ツリーが食い違う）。
      writeFile('tracked.txt', 'staged\nand more\n')

      const result = await applyGitCommit('Stage した分だけ')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(git('show', 'HEAD:tracked.txt')).toBe('staged\n')

      const changes = changesOf(result.repository)

      expect(paths(changes.staged)).toEqual([])
      expect(paths(changes.unstaged)).toEqual(['tracked.txt'])
    })
  })

  /**
   * メッセージの渡し方（標準入力）が壊れていないこと。
   *
   * 引数として組み立てていたら、このどれかで別のものが記録される。
   */
  describe('メッセージ', () => {
    beforeEach(() => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')
    })

    it.each([
      ['日本語', '日本語のコミットメッセージ'],
      ['引用符', 'fix: "quoted" and \'single\''],
      ['バックスラッシュ', 'fix: back\\slash'],
      ['先頭が -', '-m looks like an option'],
      ['先頭が #', '#123 の修正'],
      ['絵文字', '✨ 新機能']
    ])('%s をそのまま記録する', async (_label, message) => {
      const result = await applyGitCommit(message)

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(lastCommitMessage()).toBe(message)
    })

    it('改行を含むメッセージ（要約 + 空行 + 本文）をそのまま記録する', async () => {
      const message = '要約の行\n\n本文の1行目\n本文の2行目'

      const result = await applyGitCommit(message)

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(lastCommitMessage()).toBe(message)
    })

    it('上限ちょうどの長さでも通る', async () => {
      const message = 'a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH)

      const result = await applyGitCommit(message)

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(lastCommitMessage()).toBe(message)
    })
  })

  describe('失敗', () => {
    it('staged が1件も無ければ nothing-to-do（空の Commit は作らない）', async () => {
      commitInitial()
      // untracked はあるが index には何も無い。
      writeFile('c.txt', 'c\n')

      const result = await applyGitCommit('何も無い')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
      expect(commitCount()).toBe(1)
    })

    it('未解決の競合が残っていれば unresolved-conflicts', async () => {
      commitInitial()
      git('checkout', '--quiet', '-b', 'other')
      writeFile('tracked.txt', 'other\n')
      git('commit', '--quiet', '-am', 'other')
      git('checkout', '--quiet', 'main')
      writeFile('tracked.txt', 'main\n')
      git('commit', '--quiet', '-am', 'main')

      // 衝突させる（`git merge` は非0で終わるので、失敗しても構わない）。
      try {
        git('merge', 'other')
      } catch {
        // 衝突は想定どおり。
      }

      const result = await applyGitCommit('競合中')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'unresolved-conflicts' })
    })

    /**
     * 名乗りが決まっていないときの挙動（実 git で確認）。
     *
     * **Fluvix Nexus 側から user.name / user.email を勝手に設定しない。**
     * 失敗として案内するだけで、commit は1つも作られない。
     *
     * `user.name` だけを外しても git は OS の情報から名前を作れてしまうため、
     * 空文字を入れて「名乗りが成立しない」状態を作る（実 git で確かめた挙動）。
     * `user.email` の方は、git がホスト名から作った宛先を
     * `…@host.(none)` として自分で断る ── どちらも `git var GIT_AUTHOR_IDENT` が
     * 128 で終わる形になり、commit を動かす前に分かる（main/git/gitCommands.ts）。
     */
    it.each([
      ['user.email が無い', ['--unset', 'user.email']],
      ['user.name が空', ['user.name', '']]
    ])('%s なら identity-missing（commit は作られない）', async (_label, configArgs) => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')
      git('config', ...configArgs)

      const result = await applyGitCommit('名乗りが無い')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'identity-missing' })
      // 失敗しても一覧は取り直され、staged はそのまま残っている（押し直せる）。
      expect(paths(changesOf(result.repository).staged)).toEqual(['a.txt'])
      expect(commitCount()).toBe(1)
    })

    it('pre-commit hook が止めたら hook-rejected', async () => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')
      writeHook('pre-commit', 'echo "lint failed" >&2\nexit 1')

      const result = await applyGitCommit('hook に止められる')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'hook-rejected' })
      expect(commitCount()).toBe(1)
      // staged はそのまま。hook を直せば同じ内容で押し直せる。
      expect(paths(changesOf(result.repository).staged)).toEqual(['a.txt'])
    })

    it('commit-msg hook が止めても hook-rejected', async () => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')
      writeHook('commit-msg', 'exit 1')

      const result = await applyGitCommit('形式が違うメッセージ')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'hook-rejected' })
      expect(commitCount()).toBe(1)
    })

    /*
      hook は迂回しない（`--no-verify` を使わない）。通る hook なら Commit は通る。
    */
    it('通る hook があれば Commit は成功する', async () => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')
      writeHook('pre-commit', 'exit 0')

      const result = await applyGitCommit('hook を通る')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(commitCount()).toBe(2)
    })

    it('Workspace がリポジトリでなくなっていれば not-ready', async () => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')

      // Workspace を、リポジトリではないフォルダへ差し替える。
      const outside = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-plain-')))

      workspace = { ...(workspace as WorkspaceFolder), rootPath: outside }

      const result = await applyGitCommit('リポジトリではない')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
      expect(result.repository.status).toBe('not-a-repository')

      await rm(outside, { recursive: true, force: true })
    })

    it('Workspace が開かれていなければ not-ready', async () => {
      workspace = null

      const result = await applyGitCommit('Workspace が無い')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
      expect(result.repository.status).toBe('no-workspace')
    })
  })

  /**
   * 同時に始めた操作（Session 3-8-3 の順番待ちが Commit にも効いていること）。
   *
   * `.git/index.lock` の取り合いになれば、片方が理由も無く失敗する。
   * 走る git が常に1本であることを、いちばん衝突しやすい組み合わせで確かめる。
   */
  describe('同時の Git 操作', () => {
    it('Commit と Stage を同時に始めても、どちらも失敗しない', async () => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')
      writeFile('b.txt', 'b\n')

      const [committed, staged] = await Promise.all([
        applyGitCommit('先に積む'),
        applyGitStage({ kind: 'file', relativePath: 'b.txt' })
      ])

      expect(committed.outcome).toEqual({ status: 'applied' })
      expect(staged.outcome).toEqual({ status: 'applied' })
      expect(commitCount()).toBe(2)
      // 後から走った Stage の分は、次の Commit の中身として残る。
      expect(git('diff', '--cached', '--name-only').trim()).toBe('b.txt')
    })

    it('Commit を2つ同時に始めても、2つめは nothing-to-do で止まる', async () => {
      commitInitial()
      writeFile('a.txt', 'a\n')
      git('add', '--', 'a.txt')

      const [first, second] = await Promise.all([applyGitCommit('1つめ'), applyGitCommit('2つめ')])

      expect(first.outcome).toEqual({ status: 'applied' })
      // index は空になっているので、2つめは空の Commit を作らずに止まる。
      expect(second.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
      expect(commitCount()).toBe(2)
    })

    it('多数の Stage の間に挟まれた Commit も、順番どおりに効く', async () => {
      commitInitial()
      mkdirSync(join(root, 'pkg'))

      for (const name of ['a', 'b', 'c']) {
        writeFile(`pkg/${name}.txt`, `${name}\n`)
      }

      const results = await Promise.all([
        applyGitStage({ kind: 'file', relativePath: 'pkg/a.txt' }),
        applyGitCommit('間に挟まる Commit'),
        applyGitStage({ kind: 'file', relativePath: 'pkg/b.txt' }),
        applyGitStage({ kind: 'file', relativePath: 'pkg/c.txt' })
      ])

      // どれも index.lock の取り合いで落ちていない。
      for (const result of results) {
        expect(result.outcome.status).toBe('applied')
      }

      // 先に Stage された a だけが commit に入り、b / c は index に残る。
      expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('pkg/a.txt')
      expect(git('diff', '--cached', '--name-only').trim().split(/\r?\n/).sort()).toEqual([
        'pkg/b.txt',
        'pkg/c.txt'
      ])
    })
  })
})
