import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitDiscardTarget, GitOperationOutcome, GitRepositoryState } from '@shared/git'
import type { GitWorkingTreeChanges } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する破棄の検証（Session 3-8-9）。
 *
 * ## なぜ実物を使うか
 *
 * 破棄は Git 機能で**唯一、利用者の書いたものが消える**操作にあたる。
 * ここで確かめるべきなのは「消えたか」ではなく、**消えなかったものが
 * ちゃんと残っているか**になる。
 *
 *   - 「変更」を破棄しても **index は1バイトも動かない**こと
 *     （`git restore --worktree` に `--staged` を渡していないことの現れ）
 *   - 押した1件の外側（隣のファイル・`.gitignore` の対象）に手が出ないこと
 *   - 未追跡は **git ではなくごみ箱**へ行くこと（`git clean` を使っていない）
 *   - 未追跡の**フォルダ1件**が、数万件の削除に化けないこと
 *   - 押すまでの間にグループが変わっていたら、**git を動かさない**こと
 *
 * ## ごみ箱だけは差し替える
 *
 * `shell.trashItem` は OS のごみ箱へ送る。テストで本物を呼ぶと、実行するたびに
 * ごみ箱が汚れる ── files ドメインの mutateWorkspaceEntry.test.ts と同じく、
 * **呼ばれたことを記録して実体を消す**偽物を置く。差し替えるのはそこだけで、
 * Workspace の境界の確認も名前の判断も本番のものが動く。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

let root: string
let workspace: WorkspaceFolder | null = null

/** ごみ箱へ送られた絶対パス（呼ばれた順）。 */
let trashed: string[] = []

vi.mock('electron', () => ({
  app: { isPackaged: false },
  shell: {
    trashItem: async (path: string): Promise<void> => {
      const { rm: remove } = await import('fs/promises')

      trashed.push(path)
      await remove(path, { recursive: true, force: true })
    }
  }
}))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { applyGitDiscard } = await import('./gitDiscard')

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

function readFileText(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

/** index に載っている中身（作業ツリーではなく index を見るための道具）。 */
function indexContent(relativePath: string): string {
  return git('show', `:${relativePath}`)
}

function changesOf(repository: GitRepositoryState): GitWorkingTreeChanges {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return (repository as Extract<GitRepositoryState, { status: 'ready' }>).changes
}

function pairs(changes: readonly { kind: string; relativePath: string }[]): string[] {
  return changes.map((change) => `${change.kind} ${change.relativePath}`)
}

async function discard(target: GitDiscardTarget): Promise<{
  readonly outcome: GitOperationOutcome
  readonly changes: GitWorkingTreeChanges
}> {
  const result = await applyGitDiscard(target)

  return { outcome: result.outcome, changes: changesOf(result.repository) }
}

beforeEach(async () => {
  trashed = []
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-discard-')))

  git('init', '--quiet', '--initial-branch=main', '.')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Fluvix Nexus Test')
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

describeWithGit('applyGitDiscard', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  function commitInitial(): void {
    writeFile('tracked.txt', 'one\ntwo\n')
    writeFile('neighbour.txt', 'keep me\n')
    git('add', '--', 'tracked.txt', 'neighbour.txt')
    git('commit', '--quiet', '-m', 'initial')
  }

  describe('変更（unstaged）', () => {
    it('作業ツリーの中身が index の中身へ戻る', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nBROKEN\n')

      const { outcome, changes } = await discard({
        group: 'unstaged',
        relativePath: 'tracked.txt'
      })

      expect(outcome).toEqual({ status: 'applied' })
      expect(readFileText('tracked.txt')).toBe('one\ntwo\n')
      expect(pairs(changes.unstaged)).toEqual([])
    })

    it('**index は1バイトも動かない**（ステージ済みを巻き添えにしない）', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nSTAGED\n')
      git('add', '--', 'tracked.txt')
      writeFile('tracked.txt', 'one\nWORKTREE\n')

      const { outcome, changes } = await discard({
        group: 'unstaged',
        relativePath: 'tracked.txt'
      })

      expect(outcome).toEqual({ status: 'applied' })
      // 作業ツリーは index の中身に戻る。
      expect(readFileText('tracked.txt')).toBe('one\nSTAGED\n')
      // index はステージしたときのまま。
      expect(indexContent('tracked.txt')).toBe('one\nSTAGED\n')
      expect(pairs(changes.staged)).toEqual(['modified tracked.txt'])
      expect(pairs(changes.unstaged)).toEqual([])
    })

    it('作業ツリーから消したファイルが戻る', async () => {
      commitInitial()
      unlinkSync(join(root, 'tracked.txt'))

      const { outcome, changes } = await discard({
        group: 'unstaged',
        relativePath: 'tracked.txt'
      })

      expect(outcome).toEqual({ status: 'applied' })
      expect(readFileText('tracked.txt')).toBe('one\ntwo\n')
      expect(pairs(changes.unstaged)).toEqual([])
    })

    it('押した1件の外側には手が出ない', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nBROKEN\n')
      writeFile('neighbour.txt', 'also changed\n')

      await discard({ group: 'unstaged', relativePath: 'tracked.txt' })

      expect(readFileText('neighbour.txt')).toBe('also changed\n')
    })

    it('日本語や空白を含む名前でも、指したものだけが戻る', async () => {
      writeFile('メモ 帳.txt', 'もと\n')
      git('add', '--', 'メモ 帳.txt')
      git('commit', '--quiet', '-m', 'initial')
      writeFile('メモ 帳.txt', 'かきかけ\n')

      const { outcome } = await discard({ group: 'unstaged', relativePath: 'メモ 帳.txt' })

      expect(outcome).toEqual({ status: 'applied' })
      expect(readFileText('メモ 帳.txt')).toBe('もと\n')
    })

    it('先頭が `-` の名前でも、オプションとして読まれない', async () => {
      writeFile('-dash.txt', 'original\n')
      git('add', '--', '-dash.txt')
      git('commit', '--quiet', '-m', 'initial')
      writeFile('-dash.txt', 'edited\n')

      const { outcome } = await discard({ group: 'unstaged', relativePath: '-dash.txt' })

      expect(outcome).toEqual({ status: 'applied' })
      expect(readFileText('-dash.txt')).toBe('original\n')
    })

    it('git は一度も動かず、ごみ箱も呼ばれない（対象が居ないとき）', async () => {
      commitInitial()

      const { outcome } = await discard({ group: 'unstaged', relativePath: 'tracked.txt' })

      expect(outcome).toEqual({ status: 'failed', reason: 'path-not-found' })
      expect(trashed).toEqual([])
      expect(readFileText('tracked.txt')).toBe('one\ntwo\n')
    })

    it('押すまでの間に Stage されていたら、作業ツリーに手が出ない', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nSTAGED\n')
      // 端末で `git add` された、を模す（Renderer の一覧はまだ「変更」のまま）。
      git('add', '--', 'tracked.txt')

      const { outcome } = await discard({ group: 'unstaged', relativePath: 'tracked.txt' })

      expect(outcome).toEqual({ status: 'failed', reason: 'path-not-found' })
      expect(readFileText('tracked.txt')).toBe('one\nSTAGED\n')
    })

    it('未追跡のファイルを「変更」として渡しても、消えない', async () => {
      commitInitial()
      writeFile('fresh.txt', 'brand new\n')

      const { outcome } = await discard({ group: 'unstaged', relativePath: 'fresh.txt' })

      expect(outcome).toEqual({ status: 'failed', reason: 'path-not-found' })
      expect(readFileText('fresh.txt')).toBe('brand new\n')
      expect(trashed).toEqual([])
    })
  })

  describe('未追跡（untracked）', () => {
    it('ごみ箱へ送られる（git は消さない）', async () => {
      commitInitial()
      writeFile('fresh.txt', 'brand new\n')

      const { outcome, changes } = await discard({
        group: 'untracked',
        relativePath: 'fresh.txt'
      })

      expect(outcome).toEqual({ status: 'applied' })
      expect(trashed).toEqual([join(root, 'fresh.txt')])
      expect(existsSync(join(root, 'fresh.txt'))).toBe(false)
      expect(pairs(changes.untracked)).toEqual([])
    })

    it('追跡済みのファイルには手が出ない', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nBROKEN\n')

      const { outcome } = await discard({ group: 'untracked', relativePath: 'tracked.txt' })

      expect(outcome).toEqual({ status: 'failed', reason: 'path-not-found' })
      expect(trashed).toEqual([])
      expect(readFileText('tracked.txt')).toBe('one\nBROKEN\n')
    })

    it('**フォルダ1件は断る**（数万件の削除に化けない）', async () => {
      commitInitial()
      mkdirSync(join(root, 'pile'))
      writeFile('pile/a.txt', 'a\n')
      writeFile('pile/b.txt', 'b\n')

      // `--untracked-files=normal` は、この状態を `pile/` 1件として返す。
      const { outcome } = await discard({ group: 'untracked', relativePath: 'pile' })

      expect(outcome).toEqual({ status: 'failed', reason: 'unsupported-target' })
      expect(trashed).toEqual([])
      expect(readFileText('pile/a.txt')).toBe('a\n')
      expect(readFileText('pile/b.txt')).toBe('b\n')
    })

    it('`.gitignore` の対象には手が出ない（一覧に出ていないもの）', async () => {
      commitInitial()
      writeFile('.gitignore', 'secret.txt\n')
      writeFile('secret.txt', 'do not touch\n')

      const { outcome } = await discard({ group: 'untracked', relativePath: 'secret.txt' })

      expect(outcome).toEqual({ status: 'failed', reason: 'path-not-found' })
      expect(trashed).toEqual([])
      expect(readFileText('secret.txt')).toBe('do not touch\n')
    })

    it('日本語の名前でも、指したものだけが消える', async () => {
      commitInitial()
      writeFile('メモ 帳.txt', 'にほんご\n')

      const { outcome } = await discard({ group: 'untracked', relativePath: 'メモ 帳.txt' })

      expect(outcome).toEqual({ status: 'applied' })
      expect(trashed).toEqual([join(root, 'メモ 帳.txt')])
      expect(readFileText('neighbour.txt')).toBe('keep me\n')
    })
  })

  describe('操作できない状態', () => {
    it('Workspace が閉じられていれば not-ready', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nBROKEN\n')
      workspace = null

      const result = await applyGitDiscard({ group: 'unstaged', relativePath: 'tracked.txt' })

      expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
      expect(trashed).toEqual([])
    })

    it('`.git` を指しても通らない', async () => {
      commitInitial()

      const result = await applyGitDiscard({
        group: 'untracked',
        relativePath: '.git/config'
      })

      expect(result.outcome).toEqual({ status: 'failed', reason: 'unknown' })
      expect(trashed).toEqual([])
      expect(existsSync(join(root, '.git', 'config'))).toBe(true)
    })
  })
})
