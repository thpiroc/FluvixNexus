import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FILES_FILE_MAX_BYTES } from '@shared/files'
import type { GitDiffGroup, GitFileDiff } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する差分の検証（Session 3-8-9）。
 *
 * ## なぜ実物を使うか
 *
 * gitBlob.test.ts が固定するのは「この出力をどう読むか」までで、**git が
 * 実際にどの出力を返すか**は誰も確かめていない。差分では、そこが答えの
 * ほとんどを占める。
 *
 *   - 「どの側を、どこから取るか」の表（HEAD / index / 作業ツリー）が
 *     **種類ごとに正しいか** ── rename の左が元の位置の中身になること、
 *     削除の右が空になること、追加の左が空になること
 *   - **初回 commit 前**（HEAD がまだ無い）でも staged の差分が出せること
 *   - 同じファイルが2つのグループに並んでいるとき、**押した行ごとに
 *     違う差分**が返ること
 *   - `core.autocrlf` の効いている環境で、**1行も書き換えていないのに
 *     全行変更として出ない**こと
 *   - バイナリ・2MB 超・消えた位置が、失敗ではなく理由として返ること
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `readGitFileDiff` で、その下の runGit / gitCommands / gitBlob /
 * gitPathspec / gitQueue / readWorkspaceFile はすべて本番のものが動く。
 * 差し替えるのは2つだけ（gitStageRepository.test.ts と同じ）。
 *
 *   electron … logger が `app.isPackaged` を見るため
 *   現在の Workspace … 一時リポジトリを指させるため
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

let root: string
let workspace: WorkspaceFolder | null = null

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: (): WorkspaceFolder | null => workspace
}))

const { readGitFileDiff } = await import('./gitDiff')

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

function writeBytes(relativePath: string, bytes: Uint8Array): void {
  writeFileSync(join(root, relativePath), bytes)
}

async function diffOf(group: GitDiffGroup, relativePath: string): Promise<GitFileDiff> {
  const outcome = await readGitFileDiff({ group, relativePath })

  return outcome.diff
}

/** `ready` であることを確かめたうえで中身を取り出す（そうでなければ不合格）。 */
function ready(diff: GitFileDiff): Extract<GitFileDiff, { status: 'ready' }> {
  expect(diff.status, `ready ではない差分: ${JSON.stringify(diff)}`).toBe('ready')

  return diff as Extract<GitFileDiff, { status: 'ready' }>
}

/** 出せなかった理由（`ready` なら不合格）。 */
function reasonOf(diff: GitFileDiff): string {
  expect(diff.status, 'unavailable ではない').toBe('unavailable')

  return (diff as Extract<GitFileDiff, { status: 'unavailable' }>).reason
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-diff-')))

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

describeWithGit('readGitFileDiff', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  function commitInitial(): void {
    writeFile('tracked.txt', 'one\ntwo\n')
    git('add', '--', 'tracked.txt')
    git('commit', '--quiet', '-m', 'initial')
  }

  describe('変更（unstaged）', () => {
    it('左は index、右は作業ツリーの中身になる', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nTWO\n')

      const diff = ready(await diffOf('unstaged', 'tracked.txt'))

      expect(diff.original).toBe('one\ntwo\n')
      expect(diff.modified).toBe('one\nTWO\n')
      expect(diff.kind).toBe('modified')
      expect(diff.group).toBe('unstaged')
      expect(diff.originalPath).toBeNull()
    })

    it('作業ツリーから消えたファイルは、右が空になる', async () => {
      commitInitial()
      unlinkSync(join(root, 'tracked.txt'))

      const diff = ready(await diffOf('unstaged', 'tracked.txt'))

      expect(diff.kind).toBe('deleted')
      expect(diff.original).toBe('one\ntwo\n')
      expect(diff.modified).toBe('')
    })

    it('index を書き換えた後は、左がその index の中身になる', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nSTAGED\n')
      git('add', '--', 'tracked.txt')
      writeFile('tracked.txt', 'one\nWORKTREE\n')

      const diff = ready(await diffOf('unstaged', 'tracked.txt'))

      // HEAD（`one\ntwo\n`）ではない。押したのは「変更」の行にあたる。
      expect(diff.original).toBe('one\nSTAGED\n')
      expect(diff.modified).toBe('one\nWORKTREE\n')
    })
  })

  describe('ステージ済み（staged）', () => {
    it('左は HEAD、右は index の中身になる', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nSTAGED\n')
      git('add', '--', 'tracked.txt')
      // 作業ツリーをさらに書き換えても、ステージ済みの右は index のまま。
      writeFile('tracked.txt', 'one\nWORKTREE\n')

      const diff = ready(await diffOf('staged', 'tracked.txt'))

      expect(diff.original).toBe('one\ntwo\n')
      expect(diff.modified).toBe('one\nSTAGED\n')
    })

    it('追加されたファイルは、左が空になる', async () => {
      commitInitial()
      writeFile('added.txt', 'new\n')
      git('add', '--', 'added.txt')

      const diff = ready(await diffOf('staged', 'added.txt'))

      expect(diff.kind).toBe('added')
      expect(diff.original).toBe('')
      expect(diff.modified).toBe('new\n')
    })

    it('削除されたファイルは、右が空になる', async () => {
      commitInitial()
      git('rm', '--quiet', '--', 'tracked.txt')

      const diff = ready(await diffOf('staged', 'tracked.txt'))

      expect(diff.kind).toBe('deleted')
      expect(diff.original).toBe('one\ntwo\n')
      expect(diff.modified).toBe('')
    })

    it('rename では、左が**元の位置**の中身になる', async () => {
      commitInitial()
      git('mv', 'tracked.txt', 'moved.txt')

      const diff = ready(await diffOf('staged', 'moved.txt'))

      expect(diff.kind).toBe('renamed')
      expect(diff.originalPath).toBe('tracked.txt')
      // 元の位置の中身が左に出る（見つからずに「全部が追加」にならないこと）。
      expect(diff.original).toBe('one\ntwo\n')
      expect(diff.modified).toBe('one\ntwo\n')
    })

    it('rename と同時に中身も変わっていれば、その差分が出る', async () => {
      commitInitial()
      git('mv', 'tracked.txt', 'moved.txt')
      writeFile('moved.txt', 'one\nTWO\n')
      git('add', '--', 'moved.txt')

      const diff = ready(await diffOf('staged', 'moved.txt'))

      expect(diff.originalPath).toBe('tracked.txt')
      expect(diff.original).toBe('one\ntwo\n')
      expect(diff.modified).toBe('one\nTWO\n')
    })

    it('初回 commit 前でも、左を空にして差分を出せる', async () => {
      writeFile('first.txt', 'hello\n')
      git('add', '--', 'first.txt')

      const diff = ready(await diffOf('staged', 'first.txt'))

      expect(diff.kind).toBe('added')
      expect(diff.original).toBe('')
      expect(diff.modified).toBe('hello\n')
    })
  })

  describe('未追跡（untracked）', () => {
    it('左は空、右は作業ツリーの中身になる', async () => {
      commitInitial()
      writeFile('fresh.txt', 'brand new\n')

      const diff = ready(await diffOf('untracked', 'fresh.txt'))

      expect(diff.kind).toBe('untracked')
      expect(diff.original).toBe('')
      expect(diff.modified).toBe('brand new\n')
    })

    it('フォルダ1件は、差分の対象にならない', async () => {
      commitInitial()
      mkdirSync(join(root, 'pile'))
      writeFile('pile/a.txt', 'a\n')
      writeFile('pile/b.txt', 'b\n')

      // `--untracked-files=normal` は、この状態を `pile/` 1件として返す。
      expect(reasonOf(await diffOf('untracked', 'pile'))).toBe('unsupported-target')
    })

    it('日本語の名前でも中身が取れる', async () => {
      commitInitial()
      writeFile('メモ 帳.txt', 'にほんご\n')

      const diff = ready(await diffOf('untracked', 'メモ 帳.txt'))

      expect(diff.modified).toBe('にほんご\n')
    })
  })

  describe('同じファイルが2つのグループに並ぶとき', () => {
    it('押した行ごとに、違う差分が返る', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nSTAGED\n')
      git('add', '--', 'tracked.txt')
      writeFile('tracked.txt', 'one\nWORKTREE\n')

      const staged = ready(await diffOf('staged', 'tracked.txt'))
      const unstaged = ready(await diffOf('unstaged', 'tracked.txt'))

      expect([staged.original, staged.modified]).toEqual(['one\ntwo\n', 'one\nSTAGED\n'])
      expect([unstaged.original, unstaged.modified]).toEqual(['one\nSTAGED\n', 'one\nWORKTREE\n'])
    })
  })

  describe('出せないもの', () => {
    it('そのグループに居ない位置は not-found', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nTWO\n')

      // 変わっているのは作業ツリー側だけ。ステージ済みの行は存在しない。
      expect(reasonOf(await diffOf('staged', 'tracked.txt'))).toBe('not-found')
    })

    it('他のグループへ移った位置も not-found', async () => {
      commitInitial()
      writeFile('tracked.txt', 'one\nTWO\n')
      // 端末で Stage された、を模す。押した「変更」の行はもう無い。
      git('add', '--', 'tracked.txt')

      expect(reasonOf(await diffOf('unstaged', 'tracked.txt'))).toBe('not-found')
    })

    it('衝突しているファイルは、どのグループにも居ない', async () => {
      commitInitial()
      git('switch', '--quiet', '--create', 'other')
      writeFile('tracked.txt', 'one\nTHEIRS\n')
      git('commit', '--quiet', '--all', '-m', 'theirs')
      git('switch', '--quiet', 'main')
      writeFile('tracked.txt', 'one\nOURS\n')
      git('commit', '--quiet', '--all', '-m', 'ours')

      try {
        git('merge', '--quiet', 'other')
      } catch {
        // 衝突で非0になるのが目的。
      }

      expect(reasonOf(await diffOf('unstaged', 'tracked.txt'))).toBe('not-found')
      expect(reasonOf(await diffOf('staged', 'tracked.txt'))).toBe('not-found')
    })

    it('バイナリは binary（作業ツリー側）', async () => {
      commitInitial()
      writeBytes('blob.bin', Uint8Array.from([0x00, 0x01, 0x02, 0x00, 0x41]))

      expect(reasonOf(await diffOf('untracked', 'blob.bin'))).toBe('binary')
    })

    it('バイナリは binary（index 側）', async () => {
      writeBytes('blob.bin', Uint8Array.from([0x00, 0x01, 0x02, 0x00, 0x41]))
      git('add', '--', 'blob.bin')

      expect(reasonOf(await diffOf('staged', 'blob.bin'))).toBe('binary')
    })

    it('2MB を超えるものは too-large（作業ツリー側）', async () => {
      commitInitial()
      writeFile('big.txt', 'x'.repeat(FILES_FILE_MAX_BYTES + 1))

      expect(reasonOf(await diffOf('untracked', 'big.txt'))).toBe('too-large')
    })

    it('2MB を超えるものは too-large（index 側）', async () => {
      writeFile('big.txt', 'x'.repeat(FILES_FILE_MAX_BYTES + 1))
      git('add', '--', 'big.txt')

      expect(reasonOf(await diffOf('staged', 'big.txt'))).toBe('too-large')
    })

    it('Workspace が閉じられていれば not-ready', async () => {
      commitInitial()
      workspace = null

      expect(reasonOf(await diffOf('unstaged', 'tracked.txt'))).toBe('not-ready')
    })
  })

  describe('改行', () => {
    /*
      `core.autocrlf` が効いていると、index は LF・作業ツリーは CRLF になる。
      均していないと、1行も書き換えていないファイルが全行変更として出る
      （shared/git/diff.ts）。
    */
    it('改行の食い違いは、差分にならない', async () => {
      git('config', 'core.autocrlf', 'true')
      writeFile('crlf.txt', 'one\ntwo\nthree\n')
      git('add', '--', 'crlf.txt')
      git('commit', '--quiet', '-m', 'initial')

      // checkout し直して、作業ツリー側を CRLF にする。
      unlinkSync(join(root, 'crlf.txt'))
      git('checkout', '--', 'crlf.txt')
      // 中身は変えず、末尾に1行だけ足す（CRLF で書く）。
      writeFile('crlf.txt', 'one\r\ntwo\r\nthree\r\nfour\r\n')

      const diff = ready(await diffOf('unstaged', 'crlf.txt'))

      expect(diff.original).toBe('one\ntwo\nthree\n')
      expect(diff.modified).toBe('one\ntwo\nthree\nfour\n')
    })
  })
})
