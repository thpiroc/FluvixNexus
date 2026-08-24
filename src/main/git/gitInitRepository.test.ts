import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
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
 * 本物の git に対する `git init` の検証（Session 3-8-10）。
 *
 * ## なぜ実物を使うか
 *
 * 確かめたいのが「**git が実際に何を作るか**」だからになる。
 *
 *   - 初期ブランチ名を渡していないこと（`init.defaultBranch` がそのまま効く）
 *   - **commit も `.gitignore` も remote も作られない**こと
 *   - 初期化の直後に、Git パネルが `ready` として立つこと
 *
 * どれも写しを相手にすると、答えを自分で書くことになる。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `applyGitInit` で、その下の runGit / gitCommands / gitQueue /
 * gitRepository はすべて本番のものが動く。差し替えるのは2つだけ
 * （electron の logger と、現在の Workspace）── gitSyncRepository.test.ts と
 * 同じ形にしてある。
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

/** 利用者が開いているフォルダ。 */
let root: string

/** Main が持つ「今の Workspace」。 */
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { applyGitInit } = await import('./gitInit')

/** 指定した場所で git を1回動かす（テスト自身の確認用）。 */
function gitIn(cwd: string, ...args: readonly string[]): string {
  return execFileSync(gitExecutable as string, [...args], {
    cwd,
    env: createGitEnvironment(process.env),
    encoding: 'utf8',
    windowsHide: true
  })
}

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-init-')))
  workspace = {
    id: 'workspace-1',
    rootPath: root,
    displayName: 'workspace',
    openedAt: Date.now(),
    exists: true
  }
})

afterEach(async () => {
  workspace = null
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
})

describeWithGit('applyGitInit', () => {
  it('まだリポジトリではないフォルダを、その場でリポジトリにする', async () => {
    writeFileSync(join(root, 'a.txt'), 'a\n', 'utf8')

    const result = await applyGitInit()

    expect(result.outcome).toEqual({ status: 'applied' })

    const ready = readyOf(result.repository)

    // 初期化の直後は commit が無く、置いてあったファイルは未追跡として並ぶ。
    expect(ready.changes.untracked.map((change) => change.relativePath)).toEqual(['a.txt'])
    expect(ready.changes.staged).toEqual([])
    expect(ready.upstream).toBeNull()
  })

  /*
    この操作の範囲そのもの ── 初回 Commit も `.gitignore` も remote も、
    アプリは作らない（main/git/gitInit.ts）。
  */
  it('commit も .gitignore も remote も作らない', async () => {
    writeFileSync(join(root, 'a.txt'), 'a\n', 'utf8')

    const result = await applyGitInit()

    expect(result.outcome.status).toBe('applied')
    expect(existsSync(join(root, '.gitignore'))).toBe(false)
    expect(gitIn(root, 'remote').trim()).toBe('')
    expect(readyOf(result.repository).hasRemote).toBe(false)

    // commit は1つも無い（`rev-parse --verify HEAD` が断る）。
    expect(() => gitIn(root, 'rev-parse', '--verify', '--quiet', 'HEAD')).toThrow()
  })

  /*
    初期ブランチ名を渡していないので、その PC の git の既定がそのまま効く
    （`-b main` を付けると、`init.defaultBranch` を設定した人の意図を
    アプリの中でだけ上書きすることになる）。
  */
  it('初期ブランチ名をアプリが決めない', async () => {
    const result = await applyGitInit()
    const head = readyOf(result.repository).head

    expect(head.kind).toBe('branch')

    const expected = gitIn(root, 'symbolic-ref', '--short', 'HEAD').trim()

    expect(head.kind === 'branch' ? head.name : null).toBe(expected)
  })

  it('作業ツリーのファイルは1つも変わらない', async () => {
    writeFileSync(join(root, 'a.txt'), 'keep\n', 'utf8')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'b.txt'), 'keep too\n', 'utf8')

    await applyGitInit()

    expect(existsSync(join(root, 'a.txt'))).toBe(true)
    expect(existsSync(join(root, 'sub', 'b.txt'))).toBe(true)
  })

  /*
    押すまでの間に他の経路（端末）で初期化された場合。git を動かさずに
    「押した意味が無かった」として返る（shared/git/operation.ts）。
  */
  it('既にリポジトリなら nothing-to-do（作り直さない）', async () => {
    gitIn(root, 'init', '--quiet')
    const before = gitIn(root, 'rev-parse', '--absolute-git-dir').trim()

    const result = await applyGitInit()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    expect(result.repository.status).toBe('ready')
    expect(gitIn(root, 'rev-parse', '--absolute-git-dir').trim()).toBe(before)
  })

  /*
    リポジトリの一部だけを開いている状態（`nested`）で初期化すると、
    **入れ子のリポジトリ**ができる ── 外側から見ると中身が丸ごと消えたように
    見える形になるため、git を1回も動かさずに断る。
  */
  it('リポジトリの中のサブフォルダでは初期化しない', async () => {
    gitIn(root, 'init', '--quiet')

    const nested = join(root, 'sub')
    mkdirSync(nested)
    workspace = {
      id: 'workspace-2',
      rootPath: nested,
      displayName: 'sub',
      openedAt: Date.now(),
      exists: true
    }

    const result = await applyGitInit()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
    expect(result.repository.status).toBe('nested')
    expect(existsSync(join(nested, '.git'))).toBe(false)
  })

  it('Workspace が開かれていなければ何も起きない', async () => {
    workspace = null

    const result = await applyGitInit()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
    expect(result.repository).toEqual({ status: 'no-workspace' })
  })
})
