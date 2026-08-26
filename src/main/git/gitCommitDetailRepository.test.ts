import { execFileSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  GIT_COMMIT_FILE_LIMIT,
  type GitCommitDetail,
  type GitCommitFileChange,
  type GitCommitFileDiff
} from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する commit 1件の詳細の検証（Session 3-8-12）。
 *
 * ## ここで固定したいのは「git が実際に何を返すか」
 *
 * `gitOutput.test.ts`（`readCommitFileChanges`）が固定するのは「この塊をこう読む」
 * までで、**git が本当にその形を出すのか**は誰も確かめていない ── `--raw` の
 * 欄の並びも、`-z` の区切り方も、`--find-renames` が rename を1件に畳むことも、
 * 決めるのは実装ではなく git になる（3-8-2 以降の各セッションと同じ立て付け）。
 *
 * 実物でしか確かめられないのは次の7つ。
 *
 *   - `--raw` の1件から、両側の **object 名**が取れること（差分がそこから読める）
 *   - `--find-renames` で rename が**1件**として返ること（2件に割れない）
 *   - `--root` で、**履歴のいちばん最初の commit**が全部追加として返ること
 *   - マージ commit が `merge` として返ること（`diff-tree` が空を返す形に落ちない）
 *   - 短い hash を渡して commit が**解けること**、解けないときに `not-found` になること
 *   - 上限（500）で切られ、切られたことが分かること
 *   - `--end-of-options` の後ろに hash を置いた形が、実 git で通ること
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `readGitCommitDetail` / `readGitCommitFileDiff` で、その下の runGit /
 * gitCommands / gitQueue / gitRepository / gitOutput / gitDiffSide はすべて本番の
 * ものが動く。差し替えるのは2つだけ（electron の logger と、現在の Workspace）。
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

const { readGitCommitDetail, readGitCommitFileDiff } = await import('./gitCommitDetail')

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

/** 作業リポジトリに commit を1つ積んで、その短い hash を返す。 */
function commit(message: string): string {
  git('add', '--all', '--', '.')
  git('commit', '--quiet', '--allow-empty', '--allow-empty-message', '-m', message)

  return git('rev-parse', '--short', 'HEAD').trim()
}

/** ファイルを1つ書く。 */
function write(relativePath: string, content: string): void {
  writeFileSync(join(root, relativePath), content, 'utf8')
}

/** 応答を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(detail: GitCommitDetail): Extract<GitCommitDetail, { status: 'ready' }> {
  expect(detail.status, `ready ではない詳細: ${JSON.stringify(detail)}`).toBe('ready')

  return detail as Extract<GitCommitDetail, { status: 'ready' }>
}

/** 差分を `ready` として取り出す（そうでなければ不合格）。 */
function diffReadyOf(diff: GitCommitFileDiff): Extract<GitCommitFileDiff, { status: 'ready' }> {
  expect(diff.status, `ready ではない差分: ${JSON.stringify(diff)}`).toBe('ready')

  return diff as Extract<GitCommitFileDiff, { status: 'ready' }>
}

/** 位置だけを取り出す（並びの確認用）。 */
function pathsOf(files: readonly GitCommitFileChange[]): readonly string[] {
  return files.map((file) => file.relativePath)
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * 開発者の PC に入っている設定（`diff.renames` / `diff.external` /
 * `log.showSignature`）は、**この塊が確かめている振る舞いそのもの**を変えうる ──
 * とくに `diff.renames=false` を置いている PC では、`--find-renames` を
 * 明示していなければ rename が2件に割れる（gitHistoryRepository.test.ts と同じ構え）。
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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-commit-')))

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

describeWithGit('readGitCommitDetail', () => {
  it('追加・変更・削除を、変更ファイルの一覧と同じ語で返す', async () => {
    write('keep.txt', 'v1\n')
    write('gone.txt', 'x\n')
    commit('first')

    write('keep.txt', 'v2\n')
    write('added.txt', 'new\n')
    git('rm', '--quiet', '--', 'gone.txt')
    const hash = commit('second')

    const detail = readyOf((await readGitCommitDetail({ shortHash: hash })).detail)

    expect(detail.commit.shortHash).toBe(hash)
    expect(detail.commit.subject).toBe('second')
    expect(detail.truncated).toBe(false)
    expect(detail.files.map((file) => [file.relativePath, file.kind, file.originalPath])).toEqual([
      ['added.txt', 'added', null],
      ['gone.txt', 'deleted', null],
      ['keep.txt', 'modified', null]
    ])
  })

  /*
    `--find-renames` が効いていること。plumbing（`diff-tree`）の既定では
    rename 検出が行われず、**「消えた」と「足された」の2件**として返る ──
    その形だと、画面の件数が `git show --stat` と食い違う。
  */
  it('rename を1件として返す（元の位置つき）', async () => {
    write('old.txt', 'stable content\nsecond line\n')
    commit('first')

    git('mv', 'old.txt', 'new.txt')
    const hash = commit('rename')

    const detail = readyOf((await readGitCommitDetail({ shortHash: hash })).detail)

    expect(detail.files).toEqual([
      { relativePath: 'new.txt', kind: 'renamed', originalPath: 'old.txt' }
    ])
  })

  /*
    `--root` が効いていること。付けていないと、履歴のいちばん最初の commit で
    `diff-tree` は**何も出力しない**（比べる親が無い）── そのまま流すと
    「最初の commit では何も変わっていない」という嘘になる。
  */
  it('履歴のいちばん最初の commit を、全部追加として返す', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    const hash = commit('root commit')

    const detail = readyOf((await readGitCommitDetail({ shortHash: hash })).detail)

    expect(pathsOf(detail.files)).toEqual(['a.txt', 'b.txt'])
    expect(detail.files.every((file) => file.kind === 'added')).toBe(true)
    expect(detail.commit.parentCount).toBe(0)
  })

  /*
    マージ commit。`diff-tree` は**何も出さずに 0 で終わる**ので、
    動かす前に親の数で分けておかないと「変更が1件も無い commit」に見える。
  */
  it('マージ commit を merge として返す（空の一覧にしない）', async () => {
    write('a.txt', 'a\n')
    commit('first')

    git('switch', '--quiet', '--create', 'side')
    write('side.txt', 'side\n')
    commit('side')

    git('switch', '--quiet', 'main')
    write('main.txt', 'main\n')
    commit('main side')

    git('merge', '--quiet', '--no-ff', '-m', 'merge side', 'side')
    const hash = git('rev-parse', '--short', 'HEAD').trim()

    const detail = (await readGitCommitDetail({ shortHash: hash })).detail

    expect(detail).toEqual({ status: 'unavailable', reason: 'merge' })
  })

  it('解けない hash は not-found として返す（失敗にしない）', async () => {
    write('a.txt', 'a\n')
    commit('first')

    const detail = (await readGitCommitDetail({ shortHash: 'deadbee' })).detail

    expect(detail).toEqual({ status: 'unavailable', reason: 'not-found' })
  })

  it('rev 表記は届いた時点で断る（形が通らない）', async () => {
    write('a.txt', 'a\n')
    commit('first')

    for (const rev of ['HEAD', 'HEAD~1', 'main']) {
      const detail = (await readGitCommitDetail({ shortHash: rev })).detail

      expect(detail, rev).toEqual({ status: 'unavailable', reason: 'not-found' })
    }
  })

  it('上限で切り、切ったことを伝える', async () => {
    const count = GIT_COMMIT_FILE_LIMIT + 3

    for (let index = 0; index < count; index += 1) {
      write(`file-${String(index).padStart(4, '0')}.txt`, `${index}\n`)
    }

    const hash = commit('many files')

    const detail = readyOf((await readGitCommitDetail({ shortHash: hash })).detail)

    expect(detail.files).toHaveLength(GIT_COMMIT_FILE_LIMIT)
    expect(detail.truncated).toBe(true)
  }, 30_000)

  it('要約が空の commit でも、名乗りごと読める', async () => {
    write('a.txt', 'a\n')
    git('add', '--all', '--', '.')
    git('commit', '--quiet', '--allow-empty-message', '-m', '')
    const hash = git('rev-parse', '--short', 'HEAD').trim()

    const detail = readyOf((await readGitCommitDetail({ shortHash: hash })).detail)

    expect(detail.commit.subject).toBe('')
    expect(detail.commit.authorName).toBe('Fluvix Nexus Test')
  })

  it('何も変えていない commit を、失敗ではなく空で返す', async () => {
    write('a.txt', 'a\n')
    commit('first')

    git('commit', '--quiet', '--allow-empty', '-m', 'empty')
    const hash = git('rev-parse', '--short', 'HEAD').trim()

    const detail = readyOf((await readGitCommitDetail({ shortHash: hash })).detail)

    expect(detail.files).toEqual([])
    expect(detail.truncated).toBe(false)
  })
})

describeWithGit('readGitCommitFileDiff', () => {
  it('親の中身と、この commit の中身を返す', async () => {
    write('a.txt', 'before\n')
    commit('first')

    write('a.txt', 'after\n')
    const hash = commit('second')

    const diff = diffReadyOf(
      (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'a.txt' })).diff
    )

    expect(diff.original).toBe('before\n')
    expect(diff.modified).toBe('after\n')
    expect(diff.kind).toBe('modified')
    expect(diff.originalPath).toBeNull()
  })

  it('追加では左が空、削除では右が空になる', async () => {
    write('gone.txt', 'x\n')
    commit('first')

    write('added.txt', 'new\n')
    git('rm', '--quiet', '--', 'gone.txt')
    const hash = commit('second')

    const added = diffReadyOf(
      (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'added.txt' })).diff
    )
    const deleted = diffReadyOf(
      (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'gone.txt' })).diff
    )

    expect(added.original).toBe('')
    expect(added.modified).toBe('new\n')
    expect(deleted.original).toBe('x\n')
    expect(deleted.modified).toBe('')
  })

  /*
    rename では、押されるのは**先の位置**になる（一覧の行がそれを持つ）。
    左側に出すのは元の位置の中身で、そこを取り違えると
    「全部が追加された」差分になる。
  */
  it('rename では、元の位置の中身を左に出す', async () => {
    write('old.txt', 'stable content\nsecond line\n')
    commit('first')

    git('mv', 'old.txt', 'new.txt')
    write('new.txt', 'stable content\nchanged line\n')
    const hash = commit('rename and edit')

    const diff = diffReadyOf(
      (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'new.txt' })).diff
    )

    expect(diff.originalPath).toBe('old.txt')
    expect(diff.original).toBe('stable content\nsecond line\n')
    expect(diff.modified).toBe('stable content\nchanged line\n')
  })

  it('履歴のいちばん最初の commit では、左が空になる', async () => {
    write('a.txt', 'first\n')
    const hash = commit('root commit')

    const diff = diffReadyOf(
      (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'a.txt' })).diff
    )

    expect(diff.original).toBe('')
    expect(diff.modified).toBe('first\n')
  })

  it('その commit に無い位置は not-found として返す', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    commit('first')

    write('a.txt', 'a2\n')
    const hash = commit('second')

    // b.txt はリポジトリに在るが、**この commit では変わっていない**。
    const diff = (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'b.txt' })).diff

    expect(diff).toEqual({ status: 'unavailable', reason: 'not-found' })
  })

  it('バイナリは理由として返す（失敗にしない）', async () => {
    write('a.txt', 'a\n')
    commit('first')

    writeFileSync(join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]))
    const hash = commit('binary')

    const diff = (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'blob.bin' })).diff

    expect(diff).toEqual({ status: 'unavailable', reason: 'binary' })
  })

  /*
    submodule（gitlink）。中身は blob ではないので `cat-file blob` は失敗する ──
    失敗として出すより「差分の対象ではない」として扱う方が近い。
    一覧の側には出す（`git show --stat` に出る件数と食い違わせない）。
  */
  it('submodule は一覧に出し、差分では unsupported-target として返す', async () => {
    write('a.txt', 'a\n')
    const first = commit('first')

    git('update-index', '--add', `--cacheinfo`, `160000,${git('rev-parse', 'HEAD').trim()},sub`)
    git('commit', '--quiet', '-m', 'add gitlink')
    const hash = git('rev-parse', '--short', 'HEAD').trim()

    expect(first).not.toBe(hash)

    const detail = readyOf((await readGitCommitDetail({ shortHash: hash })).detail)

    expect(pathsOf(detail.files)).toEqual(['sub'])

    const diff = (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'sub' })).diff

    expect(diff).toEqual({ status: 'unavailable', reason: 'unsupported-target' })
  })

  it('マージ commit の差分は断る（詳細と同じ線）', async () => {
    write('a.txt', 'a\n')
    commit('first')

    git('switch', '--quiet', '--create', 'side')
    write('side.txt', 'side\n')
    commit('side')

    git('switch', '--quiet', 'main')
    write('main.txt', 'main\n')
    commit('main side')

    git('merge', '--quiet', '--no-ff', '-m', 'merge side', 'side')
    const hash = git('rev-parse', '--short', 'HEAD').trim()

    const diff = (await readGitCommitFileDiff({ shortHash: hash, relativePath: 'side.txt' })).diff

    expect(diff).toEqual({ status: 'unavailable', reason: 'not-found' })
  })
})
