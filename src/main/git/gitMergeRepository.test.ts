import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
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
 * 本物の git に対するマージの開始 / 中止の検証（Session 3-8-20）。
 *
 * ## ここで固定したいのは「アプリが引数で決めたこと」と「その先が繋がること」
 *
 * 3-8-18 が固定したのは「git が通してしまうこと」（マーカー入りの add）
 * だったが、こちらの中心は**アプリが PC ごとの設定に振り回されないこと**に
 * ある。`merge.ff` も `merge.autoStash` も開発者の PC に入っていておかしくなく、
 * しかも**同じボタンの結果を変える**ものになる。
 *
 * 実物にしか確かめられないのは次の 18 個。
 *
 *  1. 早送りできるときは早送りする（**merge commit を作らない**）
 *  2. 枝分かれしていれば merge commit を1つ作る（親が2つ）
 *  3. `--no-edit` があるのでエディタ待ちにならない（＝上限まで走らない）
 *  4. 競合すると `partly-applied` / `completed: 'merge'` / `merge-conflict`
 *  5. そのとき競合の行が「競合」グループに並ぶ（3-8-2 の器のまま）
 *  6. 自動マージできたファイルはステージ済みへ入る
 *  7. そのとき `merging` が真になる（MERGE_HEAD がある）
 *  8. 3-8-18 の解決 → 3-8-4 の Commit でマージが完結する
 *  9. 作業ツリーの変更がマージを妨げるとき `local-changes-blocked`
 * 10. staged の変更がマージを妨げるときも安全に断る（MERGE_HEAD を残さない）
 * 11. detached HEAD は **git を動かす前に** `not-on-branch`
 * 12. 実在しないブランチは `branch-not-found`
 * 13. **tag / commit hash / remote-tracking ref をブランチとして受け取らない**
 * 14. 共通の履歴が無ければ `unrelated-histories`
 * 15. `merge.ff=false` でも `--ff` が勝つ（早送りのまま）
 * 16. `merge.ff=only` でも `--ff` が勝つ（merge commit を作る）
 * 17. `merge.autoStash=true` でも `--no-autostash` が勝つ（隠れた stash を作らない）
 * 18. 中止で MERGE_HEAD が消え、開始前の内容へ戻る（解決中に書いたものは消える）
 *
 * 13 が 3-8-20 でいちばん効く確かめにあたる ── `git merge` は tag も hash も
 * そのまま受け取るので、名前の**形**だけを見て通すと「ブランチのマージ」を
 * 名乗ったまま別のものが取り込まれる。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `applyGitMergeBranch` / `applyGitAbortMerge` で、その下の
 * runGit / gitCommands / gitQueue / gitFailure / gitRepository はすべて
 * 本番のものが動く。差し替えるのは2つだけ（electron の logger と、
 * 現在の Workspace）。
 *
 * 3-8-18 の続き（8）だけは `applyGitResolveConflict` と本番と同じ引数の
 * Commit も通す ── そこが繋がっていることが「3-8-20 で足したのは
 * 開始と中止の2手だけ」という判断の根拠そのものになる。
 *
 * git が入っていない環境ではこの塊ごと飛ばす。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

/**
 * 実 git を何本も起動するテストの待ち時間。
 *
 * 1件あたり 15 本前後の git プロセスが動く（準備の commit / switch に加えて、
 * 操作の前後の状態の読み直しがそれぞれ5本）── vitest の既定（5 秒）は
 * 並べて走らせたときに足りない。速さを確かめるテストではないので、
 * 上限は「本当に返ってこなくなったことに気づける」長さで足りる
 * （gitSyncRepository.test.ts と同じ判断）。
 */
const REAL_GIT_TIMEOUT_MS = 30_000

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

const { applyGitMergeBranch, applyGitAbortMerge } = await import('./gitMerge')
const { applyGitResolveConflict } = await import('./gitConflict')
const { applyGitCommit } = await import('./gitCommit')

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

/** 作業リポジトリにファイルを書く。 */
function write(relativePath: string, content: string): void {
  writeFileSync(join(root, relativePath), content, 'utf8')
}

/** 作業リポジトリのファイルを読む。 */
function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

/** 作業リポジトリに commit を1つ積む。 */
function commit(relativePath: string, content: string, message: string): void {
  write(relativePath, content)
  git('add', '--', relativePath)
  git('commit', '--quiet', '-m', message)
}

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

/** HEAD の親の数（1 なら早送り、2 なら merge commit）。 */
function parentCount(): number {
  const parents = git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/)

  // 先頭は HEAD 自身なので、残りが親になる。
  return parents.length - 1
}

/** MERGE_HEAD が在るか（テスト自身の確認用 ── 本番は git 経由で読む）。 */
function hasMergeHead(): boolean {
  return existsSync(join(root, '.git', 'MERGE_HEAD'))
}

/** 手元に積まれている commit の数。 */
function commitCount(): number {
  return Number.parseInt(git('rev-list', '--count', 'HEAD').trim(), 10)
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * `merge.ff` / `merge.autoStash` / `merge.conflictStyle` はどれも開発者の PC に
 * 入っていておかしくなく、しかも**この塊が確かめている振る舞いそのもの**を
 * 変えうる ── 見えなくしておかないと、通る PC と通らない PC が出る
 * （3-8-14 〜 3-8-18 と同じ構え）。設定を効かせて確かめる回だけ、
 * その中で明示的に `git config` する。
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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-merge-')))

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

/** 最初の commit を1つ置く（どの場面でも土台になる）。 */
function base(): void {
  commit('f.txt', 'line1\nline2\nline3\n', 'base')
}

/**
 * `feat` だけが先へ進んだ状態にする（＝ main から早送りできる）。
 */
function createFastForwardable(): void {
  base()
  git('switch', '--quiet', '--create', 'feat')
  commit('g.txt', 'from feat\n', 'feat')
  git('switch', '--quiet', 'main')
}

/**
 * `main` と `feat` が**別々のファイル**を足した状態にする（＝ 競合しない枝分かれ）。
 */
function createDiverged(): void {
  base()
  git('switch', '--quiet', '--create', 'feat')
  commit('a.txt', 'from feat\n', 'feat')
  git('switch', '--quiet', 'main')
  commit('b.txt', 'from main\n', 'main2')
}

/**
 * `main` と `feat` が**同じ行**を別々に変えた状態にする（＝ 競合する）。
 *
 * 自動でマージできる側（`x.txt`）も一緒に置いてある ── 競合したときに
 * 「できた分は入っている」ことを確かめるために要る。
 */
function createConflicting(): void {
  base()

  git('switch', '--quiet', '--create', 'feat')
  write('f.txt', 'line1\nFEAT\nline3\n')
  git('commit', '--quiet', '-am', 'feat')
  commit('x.txt', 'only in feat\n', 'feat x')

  git('switch', '--quiet', 'main')
  write('f.txt', 'line1\nMAIN\nline3\n')
  git('commit', '--quiet', '-am', 'main2')
}

describeWithGit('applyGitMergeBranch', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  describe('通ったとき', () => {
    /*
      3-8-20 の設計判断 1 の前半 ── 早送りできるなら早送りし、
      **不要な merge commit を作らない。**
    */
    it('早送りできるときは早送りする（merge commit を作らない）', async () => {
      createFastForwardable()

      const before = commitCount()
      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'applied' })
      // 進んだのは feat のぶんの1つだけ（merge commit は増えていない）。
      expect(commitCount()).toBe(before + 1)
      expect(parentCount()).toBe(1)
      expect(readyOf(result.repository).inProgress).toBeNull()
      expect(read('g.txt')).toBe('from feat\n')
    })

    it('枝分かれしていれば merge commit を作る', async () => {
      createDiverged()

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(parentCount()).toBe(2)
      // どちらの枝のファイルも揃っている。
      expect(read('a.txt')).toBe('from feat\n')
      expect(read('b.txt')).toBe('from main\n')
      expect(readyOf(result.repository).inProgress).toBeNull()
    })

    /*
      `--no-edit` が効いていることの確かめ。

      **エディタが開けば、この呼び出しは返ってこない**（上限まで待って
      `timeout` になる）── `core.editor` に「絶対に終わらないもの」を
      置いてあるので、返ってきた時点で `--no-edit` が効いている。
    */
    it('`--no-edit` があるのでエディタを待たない', async () => {
      createDiverged()

      /*
        Windows でも POSIX でも「入力を待ち続ける」形にする。
        `--no-edit` が外れていれば、ここで止まる。
      */
      git('config', 'core.editor', 'read -r _unused')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(parentCount()).toBe(2)
    })

    /*
      相手が既に取り込まれている（`Already up to date.`）。

      **区別しない**（設計判断 5）── git は 0 で終わり、こちらは
      普通の成功として返す。そのために結果の型も増やしていない。
    */
    it('取り込むものが無くても applied（Already up to date を分けない）', async () => {
      createFastForwardable()
      await applyGitMergeBranch('feat')

      const before = commitCount()
      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(commitCount()).toBe(before)
    })
  })

  describe('PC ごとの設定に左右されない', () => {
    /*
      設計判断 1 ── `merge.ff=false` の PC では、素の `git merge` は
      早送りできる場面でも merge commit を作る。`--ff` を明示してあるので
      そうならない。
    */
    it('merge.ff=false でも早送りのまま（--ff が勝つ）', async () => {
      createFastForwardable()
      git('config', 'merge.ff', 'false')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(parentCount()).toBe(1)
    })

    /*
      設計判断 1 の裏側 ── `merge.ff=only` の PC では、素の `git merge` は
      枝分かれしていると**断る。** `--ff` を明示してあるので取り込める。
    */
    it('merge.ff=only でも merge commit を作れる（--ff が勝つ）', async () => {
      createDiverged()
      git('config', 'merge.ff', 'only')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'applied' })
      expect(parentCount()).toBe(2)
    })

    /*
      設計判断 2 ── `merge.autoStash=true` の PC では、素の `git merge` は
      作業ツリーの変更を**勝手に退避して**からマージする。`--no-autostash` を
      明示してあるので、代わりに断る。

      **退避が1つも増えていない**ことがここで欲しい答えになる ── 増えると、
      利用者が作った覚えのない行が 3-8-15 の一覧に並ぶ。
    */
    it('merge.autoStash=true でも隠れた stash を作らない（--no-autostash が勝つ）', async () => {
      createConflicting()
      git('config', 'merge.autoStash', 'true')

      // マージが触るファイルを手元でも書き換えておく。
      write('f.txt', 'line1\nDIRTY\nline3\n')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'local-changes-blocked' })
      expect(git('stash', 'list').trim()).toBe('')
      // 書きかけはそのまま残っている（git は上書きせずに断る）。
      expect(read('f.txt')).toBe('line1\nDIRTY\nline3\n')
      expect(hasMergeHead()).toBe(false)
    })
  })

  describe('競合したとき（partly-applied）', () => {
    it('`partly-applied` / completed merge / merge-conflict として返る', async () => {
      createConflicting()

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({
        status: 'partly-applied',
        completed: 'merge',
        reason: 'merge-conflict'
      })
    })

    /*
      3-8-2 から在る「競合」グループにそのまま並ぶ ── 3-8-20 で
      新しい器を作っていないことの確かめになる。
    */
    it('競合したファイルが「競合」グループに並ぶ', async () => {
      createConflicting()

      const result = await applyGitMergeBranch('feat')
      const ready = readyOf(result.repository)

      expect(ready.changes.conflicted.map((change) => change.relativePath)).toEqual(['f.txt'])
    })

    /*
      「何も起きなかった」ではないことの中身 ── **自動でマージできた分は
      既に入っている。** これが `failed` に丸めない理由そのものにあたる。
    */
    it('自動でマージできたファイルはステージ済みへ入る', async () => {
      createConflicting()

      const result = await applyGitMergeBranch('feat')
      const ready = readyOf(result.repository)

      expect(ready.changes.staged.map((change) => change.relativePath)).toEqual(['x.txt'])
    })

    it('MERGE_HEAD があり、状態の merging が真になる', async () => {
      createConflicting()

      const result = await applyGitMergeBranch('feat')

      expect(hasMergeHead()).toBe(true)
      expect(readyOf(result.repository).inProgress).toBe('merge')
    })

    /*
      3-8-20 が「足したのは開始と中止の2手だけ」と言える根拠。

      競合の解決（3-8-18）も Commit（3-8-4）も**本番の関数をそのまま**通し、
      その先でマージが完結する（merge commit ができ、MERGE_HEAD が消える）。
    */
    it('3-8-18 の解決 → 3-8-4 の Commit でマージが完結する', async () => {
      createConflicting()

      const merged = await applyGitMergeBranch('feat')

      expect(merged.outcome.status).toBe('partly-applied')

      // 利用者がエディタで直したことにする（マーカーは消えている）。
      write('f.txt', 'line1\nRESOLVED\nline3\n')

      const resolved = await applyGitResolveConflict('f.txt')

      expect(resolved.outcome).toEqual({ status: 'applied' })
      expect(readyOf(resolved.repository).changes.conflicted).toEqual([])
      // 解決しても、Commit するまではマージの途中のまま。
      expect(readyOf(resolved.repository).inProgress).toBe('merge')

      const committed = await applyGitCommit('merge feat')

      expect(committed.outcome).toEqual({ status: 'applied' })
      expect(readyOf(committed.repository).inProgress).toBeNull()
      expect(hasMergeHead()).toBe(false)
      // マージ commit になっている（親が2つ）。
      expect(parentCount()).toBe(2)
      expect(read('f.txt')).toBe('line1\nRESOLVED\nline3\n')
    })
  })

  describe('git を動かす前に断ること', () => {
    /*
      detached では取り込み先のブランチが無い。git 自身は merge するが
      （どこにも属さない merge commit ができる）、アプリは動かす前に断る。
    */
    it('detached HEAD では not-on-branch（MERGE_HEAD を作らない）', async () => {
      createConflicting()
      git('switch', '--quiet', '--detach', 'HEAD')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'not-on-branch' })
      expect(hasMergeHead()).toBe(false)
    })

    it('今そこに居るブランチを選ぶと nothing-to-do', async () => {
      createFastForwardable()

      const result = await applyGitMergeBranch('main')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
    })

    it('実在しないブランチは branch-not-found', async () => {
      base()

      const result = await applyGitMergeBranch('no-such-branch')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
      expect(hasMergeHead()).toBe(false)
    })

    /*
      3-8-20 でいちばん効く確かめ。

      **`git merge` は tag も commit hash も remote-tracking ref もそのまま
      受け取る**（実物で確かめてある）── 名前の形だけを見て通すと、
      「ブランチのマージ」を名乗ったまま別のものが取り込まれる。
      `branch --list` で `refs/heads/` に在ることを確かめてから動かす。
    */
    it('tag をブランチとして受け取らない', async () => {
      createDiverged()
      git('tag', 'v1.0', 'feat')

      const result = await applyGitMergeBranch('v1.0')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
      expect(commitCount()).toBe(2)
      expect(hasMergeHead()).toBe(false)
    })

    it('commit hash をブランチとして受け取らない', async () => {
      createDiverged()

      const hash = git('rev-parse', '--short', 'feat').trim()
      const result = await applyGitMergeBranch(hash)

      expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
      expect(commitCount()).toBe(2)
    })

    it('remote-tracking ref をブランチとして受け取らない', async () => {
      createDiverged()

      /*
        `refs/remotes/origin/feat` を手で置く ── remote を繋がずに
        「一覧に出る名前」だけを作れる（3-8-19 の一覧が拾う形と同じ）。
      */
      git('update-ref', 'refs/remotes/origin/feat', 'feat')

      const result = await applyGitMergeBranch('origin/feat')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'branch-not-found' })
      expect(commitCount()).toBe(2)
    })

    /*
      既にマージの途中。git も断るが（`Merging is not possible because you
      have unmerged files`）、アプリは読んだ状態だけで先に分ける。

      **理由は 3-8-22A で `operation-in-progress` に変わった。** 3-8-20 では
      `findMergeBlockingState` が `merging` を見て `unresolved-conflicts` を
      返していたが、途中の操作そのものを断る表ができたのでそちらが先に断る
      （shared/git/inProgress.ts）── **競合が残っていなくても通さない**ので、
      こちらの理由の方が正確にあたる（解決し終えたマージでも同じ答えになる。
      下の確かめ）。
    */
    it('マージの途中は operation-in-progress', async () => {
      createConflicting()
      await applyGitMergeBranch('feat')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
    })

    /*
      競合を解決し終えても、Commit するまでは同じ理由で断る ── 3-8-20 の形
      （競合の件数を見る）では、ここで**通ってしまっていた。**
    */
    it('解決し終えた（競合が0件の）マージの途中でも断る', async () => {
      createConflicting()
      await applyGitMergeBranch('feat')

      write('f.txt', 'line1\nRESOLVED\nline3\n')
      git('add', '--', 'f.txt')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
      expect(readyOf(result.repository).changes.conflicted).toEqual([])
    })
  })

  describe('git が断ること', () => {
    it('作業ツリーの変更が邪魔なら local-changes-blocked（何も壊さない）', async () => {
      createConflicting()
      write('f.txt', 'line1\nDIRTY\nline3\n')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'local-changes-blocked' })
      expect(read('f.txt')).toBe('line1\nDIRTY\nline3\n')
      expect(hasMergeHead()).toBe(false)
    })

    /*
      staged の変更でも同じく断る（**MERGE_HEAD を残さない**）。

      git はここで終了コード 2 と `Merge with strategy ort failed.` を返す ──
      分類が `unknown` に落ちないことをここで固定しておく。
    */
    it('staged の変更が邪魔でも安全に断る', async () => {
      createConflicting()
      write('f.txt', 'line1\nSTAGED\nline3\n')
      git('add', '--', 'f.txt')

      const result = await applyGitMergeBranch('feat')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'local-changes-blocked' })
      expect(hasMergeHead()).toBe(false)
      // index に載せた中身はそのまま残っている。
      expect(git('show', ':f.txt')).toBe('line1\nSTAGED\nline3\n')
    })

    /*
      共通の祖先が無い。`--allow-unrelated-histories` を渡す欄が無いので、
      git は動かずに断る ── `diverged` と別の分類にしてあるのは、
      次の一手が「相手を確かめ直す」になるため。
    */
    it('共通の履歴が無ければ unrelated-histories', async () => {
      base()

      // まったく別のリポジトリを作り、その枝だけを手元へ持ってくる。
      const other = join(area, 'other')

      gitIn(area, 'init', '--quiet', '--initial-branch=other', 'other')
      configure(other)
      writeFileSync(join(other, 'z.txt'), 'z\n', 'utf8')
      gitIn(other, 'add', '--', 'z.txt')
      gitIn(other, 'commit', '--quiet', '-m', 'z')
      git('fetch', '--quiet', other, 'other:otherbranch')

      const result = await applyGitMergeBranch('otherbranch')

      expect(result.outcome).toEqual({ status: 'failed', reason: 'unrelated-histories' })
      expect(hasMergeHead()).toBe(false)
      expect(existsSync(join(root, 'z.txt'))).toBe(false)
    })
  })
})

describeWithGit('applyGitAbortMerge', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('中止すると MERGE_HEAD が消える', async () => {
    createConflicting()
    await applyGitMergeBranch('feat')

    expect(hasMergeHead()).toBe(true)

    const result = await applyGitAbortMerge()

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(hasMergeHead()).toBe(false)
    expect(readyOf(result.repository).inProgress).toBeNull()
  })

  it('中止するとマージ前のファイルの内容へ戻る', async () => {
    createConflicting()
    await applyGitMergeBranch('feat')

    // 競合のマーカーが書き込まれている。
    expect(read('f.txt')).toContain('<<<<<<<')

    const result = await applyGitAbortMerge()

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(read('f.txt')).toBe('line1\nMAIN\nline3\n')
    // 自動でマージできていた側も、マージ前に戻る（main には無かった）。
    expect(existsSync(join(root, 'x.txt'))).toBe(false)
    expect(readyOf(result.repository).changes.conflicted).toEqual([])
    expect(readyOf(result.repository).changes.staged).toEqual([])
  })

  /*
    確認を挟む理由そのもの（設計判断 7）。

    **マージを始める前から在った変更は残り、解決中に書いたものは消える。**
    2つを同じ1回で確かめておかないと、確認の文言（gitBranches.ts の
    `describeGitAbortMergeWarning`）がどちらか片方の嘘になる。
  */
  it('開始前の作業ツリーの変更は残り、解決中に書いた内容は消える', async () => {
    createConflicting()

    // マージが触らないファイルを1つ足しておく（追跡済み）。
    commit('keep.txt', 'kept\n', 'keep')
    // マージを始める前から在る書きかけ。
    write('keep.txt', 'kept\nBEFORE-MERGE\n')
    // マージを始める前から在る未追跡。
    write('untracked.txt', 'untracked before merge\n')

    await applyGitMergeBranch('feat')

    // 解決中に書いた内容（マーカーを消して、さらに stage までした）。
    write('f.txt', 'line1\nRESOLVED-BY-USER\nline3\n')
    await applyGitResolveConflict('f.txt')

    const result = await applyGitAbortMerge()

    expect(result.outcome).toEqual({ status: 'applied' })

    // 開始前から在ったものは残る。
    expect(read('keep.txt')).toBe('kept\nBEFORE-MERGE\n')
    expect(read('untracked.txt')).toBe('untracked before merge\n')
    // 解決中に書いた内容は消える。
    expect(read('f.txt')).toBe('line1\nMAIN\nline3\n')
  })

  /*
    設計判断（23）── MERGE_HEAD が無ければ**git を1回も動かさない。**

    git 自身は `fatal: There is no merge to abort` で終わるが、それは
    読んだ状態だけで先に分かる（§14.14 からの構え）。
  */
  it('マージ中でなければ nothing-to-do', async () => {
    base()

    const result = await applyGitAbortMerge()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'nothing-to-do' })
  })
})
