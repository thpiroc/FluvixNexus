import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitRepositoryState, GitWorkingTreeChanges } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する Stage / Unstage の検証（Session 3-8-3）。
 *
 * ## なぜ実物を使うか
 *
 * gitPathspec.test.ts が固定するのは「この値を通すか」までで、**通した値を
 * git がどう受け取るか**は誰も確かめていない。日本語・空白・引用符・先頭の `-` は
 * どれも「渡し方を1つ間違えると別のものが Stage される」形の値で、
 * その答えを決めるのは実装ではなく git になる（gitStatusRepository.test.ts と同じ理由）。
 *
 * とくに実物でしか確かめられないのが次になる。
 *
 *   - 先頭が `-` のファイル名が**オプションとして読まれない**こと（`--` が効いている）
 *   - 初回 commit 前でも Unstage できること（HEAD を前提とする経路を通っていない）
 *   - rename を Unstage すると、**元の位置の削除も一緒に**戻ること
 *   - 「変更のすべて」が競合しているファイルを巻き込まないこと
 *   - 同じ瞬間に始めた2つの操作が、index の取り合いで失敗しないこと
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `applyGitStage` / `applyGitUnstage` で、その下の runGit / gitCommands /
 * gitPathspec / gitQueue はすべて本番のものが動く。差し替えるのは2つだけ。
 *
 *   electron … logger が `app.isPackaged` を見るため（それ以外に用は無い）
 *   現在の Workspace … 一時リポジトリを指させるため
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

const { applyGitStage, applyGitUnstage } = await import('./gitStage')

/** リポジトリの中で git を1回動かす（テスト自身の準備用）。 */
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

/** 変更を「種類と位置」の組にして、グループごと確かめられる形にする。 */
function pairs(changes: GitWorkingTreeChanges[keyof GitWorkingTreeChanges]): string[] {
  return changes.map((change) =>
    change.originalPath === null
      ? `${change.kind} ${change.relativePath}`
      : `${change.kind} ${change.originalPath} -> ${change.relativePath}`
  )
}

/** 応答に載っている状態から一覧を取り出す（ready でなければ不合格）。 */
function changesOf(repository: GitRepositoryState): GitWorkingTreeChanges {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return (repository as Extract<GitRepositoryState, { status: 'ready' }>).changes
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-stage-')))

  git('init', '--quiet', '--initial-branch=main', '.')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Fluvix Nexus Test')
  // 名前をそのまま扱えることを確かめるテストなので、git 側の書き換えも切っておく。
  git('config', 'core.autocrlf', 'false')

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
  await rm(root, { recursive: true, force: true })
})

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

describeWithGit('applyGitStage / applyGitUnstage', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /** 最初の commit を1つ作る（HEAD がある状態にする）。 */
  function commitInitial(): void {
    writeFile('tracked.txt', 'first\n')
    git('add', '--', 'tracked.txt')
    git('commit', '--quiet', '-m', 'initial')
  }

  describe('Stage', () => {
    it('変更されたファイルを Stage する', async () => {
      commitInitial()
      writeFile('tracked.txt', 'second\n')

      const result = await applyGitStage({ kind: 'file', relativePath: 'tracked.txt' })

      expect(result.outcome).toEqual({ status: 'applied' })

      const changes = changesOf(result.repository)

      // 操作の応答が、そのまま操作後の一覧になっている（取り直しは要らない）。
      expect(pairs(changes.staged)).toEqual(['modified tracked.txt'])
      expect(pairs(changes.unstaged)).toEqual([])
    })

    it('未追跡のファイルを Stage する', async () => {
      commitInitial()
      writeFile('new.txt', 'hello\n')

      const result = await applyGitStage({ kind: 'file', relativePath: 'new.txt' })

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(pairs(changesOf(result.repository).staged)).toEqual(['added new.txt'])
      expect(pairs(changesOf(result.repository).untracked)).toEqual([])
    })

    it('削除されたファイルを Stage する', async () => {
      commitInitial()
      unlinkSync(join(root, 'tracked.txt'))

      const result = await applyGitStage({ kind: 'file', relativePath: 'tracked.txt' })

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(pairs(changesOf(result.repository).staged)).toEqual(['deleted tracked.txt'])
    })

    it('rename を Stage する（両方を載せると1件の rename になる）', async () => {
      commitInitial()
      renameSync(join(root, 'tracked.txt'), join(root, 'moved.txt'))

      await applyGitStage({ kind: 'file', relativePath: 'tracked.txt' })
      const result = await applyGitStage({ kind: 'file', relativePath: 'moved.txt' })

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(pairs(changesOf(result.repository).staged)).toEqual([
        'renamed tracked.txt -> moved.txt'
      ])
    })

    it('未追跡のフォルダを Stage すると、その下がまとめて載る', async () => {
      commitInitial()
      mkdirSync(join(root, 'pkg'))
      writeFile('pkg/a.txt', 'a\n')
      writeFile('pkg/b.txt', 'b\n')

      // 一覧には（`--untracked-files=normal` により）フォルダ1件として出る。
      const result = await applyGitStage({ kind: 'file', relativePath: 'pkg' })

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(pairs(changesOf(result.repository).staged)).toEqual([
        'added pkg/a.txt',
        'added pkg/b.txt'
      ])
    })

    describe('扱いにくい名前', () => {
      it.each([
        ['日本語', '設計メモ.md'],
        ['空白入り', 'my notes.txt'],
        ['引用符入り', "it's here.txt"],
        ['先頭が -', '-lead.txt'],
        ['glob に見える', 'a[1].txt']
      ])('%s のファイルを Stage する', async (_label, name) => {
        commitInitial()
        writeFile(name, 'x\n')

        const result = await applyGitStage({ kind: 'file', relativePath: name })

        expect(result.outcome).toEqual({ status: 'applied' })
        expect(pairs(changesOf(result.repository).staged)).toEqual([`added ${name}`])
      })

      it('glob に見える名前でも、他のファイルまで巻き込まない', async () => {
        commitInitial()
        writeFile('a[1].txt', 'x\n')
        writeFile('a1.txt', 'y\n')

        const result = await applyGitStage({ kind: 'file', relativePath: 'a[1].txt' })

        expect(pairs(changesOf(result.repository).staged)).toEqual(['added a[1].txt'])
        expect(pairs(changesOf(result.repository).untracked)).toEqual(['untracked a1.txt'])
      })
    })

    describe('グループのすべて', () => {
      it('変更のすべてを Stage する（未追跡は載せない）', async () => {
        commitInitial()
        writeFile('second.txt', 'second\n')
        git('add', '--', 'second.txt')
        git('commit', '--quiet', '-m', 'second')

        writeFile('tracked.txt', 'changed\n')
        unlinkSync(join(root, 'second.txt'))
        writeFile('new.txt', 'new\n')

        const result = await applyGitStage({ kind: 'unstaged' })

        expect(result.outcome).toEqual({ status: 'applied' })

        const changes = changesOf(result.repository)

        expect(pairs(changes.staged)).toEqual(['deleted second.txt', 'modified tracked.txt'])
        // 未追跡は別のグループ。押した見出しの中身だけが載る。
        expect(pairs(changes.untracked)).toEqual(['untracked new.txt'])
      })

      it('未追跡のすべてを Stage する（追跡済みの変更は載せない）', async () => {
        commitInitial()
        writeFile('tracked.txt', 'changed\n')
        writeFile('one.txt', '1\n')
        writeFile('two.txt', '2\n')

        const result = await applyGitStage({ kind: 'untracked' })

        expect(result.outcome).toEqual({ status: 'applied' })

        const changes = changesOf(result.repository)

        expect(pairs(changes.staged)).toEqual(['added one.txt', 'added two.txt'])
        expect(pairs(changes.unstaged)).toEqual(['modified tracked.txt'])
      })

      it('競合しているファイルを巻き込まない', async () => {
        commitInitial()
        git('checkout', '--quiet', '-b', 'other')
        writeFile('tracked.txt', 'from other\n')
        git('commit', '--quiet', '-am', 'other')
        git('checkout', '--quiet', 'main')
        writeFile('tracked.txt', 'from main\n')
        git('commit', '--quiet', '-am', 'main')

        // 衝突させる（merge そのものは 1 で終わるので、失敗として扱わない）。
        expect(() => git('merge', '--no-edit', 'other')).toThrow()

        writeFile('side.txt', 'side\n')
        await applyGitStage({ kind: 'file', relativePath: 'side.txt' })

        const result = await applyGitStage({ kind: 'unstaged' })

        const changes = changesOf(result.repository)

        // 競合はそのまま。解決するまで Stage も Unstage も意味を持たない。
        expect(pairs(changes.conflicted)).toEqual(['conflicted tracked.txt'])
        expect(pairs(changes.staged)).toEqual(['added side.txt'])
      })

      it('対象が1件も無ければ、失敗として返す', async () => {
        commitInitial()

        const result = await applyGitStage({ kind: 'untracked' })

        expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
      })
    })

    it('消えたファイルを指しても、パネルを壊さずに失敗として返す', async () => {
      commitInitial()

      const result = await applyGitStage({ kind: 'file', relativePath: 'gone.txt' })

      expect(result.outcome).toEqual({ status: 'failed', reason: 'path-not-found' })
      // 失敗しても状態は取り直されている（古い一覧を残さない）。
      expect(result.repository.status).toBe('ready')
    })

    it.each([
      ['絶対パス', 'C:\\Windows\\System32\\drivers\\etc\\hosts'],
      ['Workspace の外', '../outside.txt'],
      ['空文字', ''],
      ['pathspec の魔法', ':(exclude)tracked.txt'],
      ['.git の中', '.git/config']
    ])('%s は git へ渡さない', async (_label, path) => {
      commitInitial()

      const result = await applyGitStage({ kind: 'file', relativePath: path })

      expect(result.outcome.status).toBe('failed')
      expect(result.repository.status).toBe('ready')
    })
  })

  describe('Unstage', () => {
    it('ステージ済みのファイルを外す（作業ツリーは変えない）', async () => {
      commitInitial()
      writeFile('tracked.txt', 'second\n')
      git('add', '--', 'tracked.txt')

      const result = await applyGitUnstage({ relativePath: 'tracked.txt' })

      expect(result.outcome).toEqual({ status: 'applied' })

      const changes = changesOf(result.repository)

      expect(pairs(changes.staged)).toEqual([])
      expect(pairs(changes.unstaged)).toEqual(['modified tracked.txt'])
      // 書きかけの中身が消えないことが、この操作の要点にあたる。
      expect(existsSync(join(root, 'tracked.txt'))).toBe(true)
    })

    it('初回 commit 前でも外せる（未追跡へ戻る）', async () => {
      writeFile('first.txt', 'hello\n')
      git('add', '--', 'first.txt')

      const result = await applyGitUnstage({ relativePath: 'first.txt' })

      expect(result.outcome).toEqual({ status: 'applied' })

      const changes = changesOf(result.repository)

      expect(pairs(changes.staged)).toEqual([])
      expect(pairs(changes.untracked)).toEqual(['untracked first.txt'])
      expect(existsSync(join(root, 'first.txt'))).toBe(true)
    })

    it('初回 commit 前で、Stage の後に書き換えたファイルでも外せる', async () => {
      writeFile('first.txt', 'hello\n')
      git('add', '--', 'first.txt')
      // ここで `git rm --cached` の安全弁（--force 無し）が効くと、断られる。
      writeFile('first.txt', 'hello again\n')

      const result = await applyGitUnstage({ relativePath: 'first.txt' })

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(pairs(changesOf(result.repository).untracked)).toEqual(['untracked first.txt'])
    })

    it('初回 commit 前の日本語ファイル名でも外せる', async () => {
      writeFile('設計メモ.md', 'x\n')
      git('add', '--', '設計メモ.md')

      const result = await applyGitUnstage({ relativePath: '設計メモ.md' })

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(pairs(changesOf(result.repository).untracked)).toEqual(['untracked 設計メモ.md'])
    })

    it('rename を外すと、元の位置の削除も一緒に戻る', async () => {
      commitInitial()
      renameSync(join(root, 'tracked.txt'), join(root, 'moved.txt'))
      git('add', '--', 'tracked.txt', 'moved.txt')

      const result = await applyGitUnstage({ relativePath: 'moved.txt' })

      expect(result.outcome).toEqual({ status: 'applied' })

      const changes = changesOf(result.repository)

      // 片方だけ戻すと「元の位置の削除」が Stage に残り、1行だったものが2つに割れる。
      expect(pairs(changes.staged)).toEqual([])
      expect(pairs(changes.unstaged)).toEqual(['deleted tracked.txt'])
      expect(pairs(changes.untracked)).toEqual(['untracked moved.txt'])
    })

    it('ステージ済みでない位置を指したら、失敗として返す', async () => {
      commitInitial()
      writeFile('tracked.txt', 'second\n')

      const result = await applyGitUnstage({ relativePath: 'tracked.txt' })

      expect(result.outcome).toEqual({ status: 'failed', reason: 'path-not-found' })
      expect(pairs(changesOf(result.repository).unstaged)).toEqual(['modified tracked.txt'])
    })
  })

  describe('同時に押されたとき', () => {
    it('2つの Stage が同時に始まっても、どちらも通る', async () => {
      commitInitial()
      writeFile('one.txt', '1\n')
      writeFile('two.txt', '2\n')

      // 待たずに2つ始める。index の取り合いになれば、片方が index.lock で失敗する。
      const [first, second] = await Promise.all([
        applyGitStage({ kind: 'file', relativePath: 'one.txt' }),
        applyGitStage({ kind: 'file', relativePath: 'two.txt' })
      ])

      expect(first.outcome).toEqual({ status: 'applied' })
      expect(second.outcome).toEqual({ status: 'applied' })

      // 後から終わった方の応答は、両方が載った状態を持っている。
      expect(pairs(changesOf(second.repository).staged)).toEqual(['added one.txt', 'added two.txt'])
    })

    it('同じファイルへの Stage と Unstage は、押した順に効く', async () => {
      commitInitial()
      writeFile('tracked.txt', 'second\n')

      const [staged, unstaged] = await Promise.all([
        applyGitStage({ kind: 'file', relativePath: 'tracked.txt' }),
        applyGitUnstage({ relativePath: 'tracked.txt' })
      ])

      expect(staged.outcome).toEqual({ status: 'applied' })
      expect(unstaged.outcome).toEqual({ status: 'applied' })
      expect(pairs(changesOf(unstaged.repository).unstaged)).toEqual(['modified tracked.txt'])
    })
  })

  it('Workspace が閉じられていたら、git を動かさずに返す', async () => {
    commitInitial()
    workspace = null

    const result = await applyGitStage({ kind: 'file', relativePath: 'tracked.txt' })

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
    expect(result.repository).toEqual({ status: 'no-workspace' })
  })

  it('リポジトリでなくなっていたら、git を動かさずに返す', async () => {
    commitInitial()
    rmSync(join(root, '.git'), { recursive: true, force: true })

    const result = await applyGitStage({ kind: 'file', relativePath: 'tracked.txt' })

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
    expect(result.repository.status).toBe('not-a-repository')
  })
})
