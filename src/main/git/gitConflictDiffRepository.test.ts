import { execFileSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitConflictFileDiff } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する競合の差分の検証（Session 3-8-21）。
 *
 * ## ここで固定したいのは「段の在り方が、そのまま画面の形になる」こと
 *
 * 3-8-18 が確かめたのは「git が通してしまうこと」と「その先が繋がること」
 * だった。3-8-21 で確かめたいのは向きが違い、**index の3段が、実際に
 * どういう組み合わせで現れるか**になる。
 *
 * 競合の形（`UU` / `AA` / `UD` / `DU` / `DD` / `AU` / `UA`）は、写しを
 * 相手にすると**自分で書いた前提を自分で確かめる**ことになる ── どの操作が
 * どの段の組み合わせを作るのかは git が決めていて、こちらの推測ではない。
 * とくに `DD`（両方で削除）と `AU` / `UA` は「そんな状態が本当に起こるのか」
 * 自体が実物でしか言えない。
 *
 * 実物にしか確かめられないのは次の 14 個。
 *
 *  1. 内容の競合（`UU`）で、左に ours・右に theirs の中身がそのまま出る
 *  2. その中身が**作業ツリーの中身とは違う**（マーカー入りのファイルではない）
 *  3. `AA`（両方が追加）には base が無く、両側に中身がある
 *  4. `UD`（theirs が削除）では**右が空**になる ── 失敗にしない
 *  5. `DU`（ours が削除）では**左が空**になる
 *  6. 改名先が食い違うと `DD` / `UA` / `AU` が**同時に**現れる（3行）
 *  7. `DD` では両側とも空、`UA` / `AU` では片側だけが空になる
 *  8. 「rename と削除」は `DD` ではなく**改名先の `DU`** になる（推測が外れた形）
 *  9. バイナリの競合が `binary` として返る（失敗にしない）
 * 10. submodule（mode 160000）の競合が `unsupported-target` として返る
 * 11. 競合していない位置は `not-found`（差分の口が別なことの裏取り）
 * 12. 解決済みにした後、同じ位置は `not-found` になる（段が畳まれる）
 * 13. `merge --abort` の後も `not-found` になる
 * 14. **読むだけで、index も作業ツリーも1バイトも動かない**
 *
 * 8 番目は、実際にこのセッションで**推測が外れた**ところになる ──
 * 「片方が rename・片方が削除すれば元の位置が DD になる」と書いて空振りし、
 * 実物が「改名先に DU を置く」と答えた。写しを相手にしていたら、
 * 外れた推測の方をテストに書いていたことになる。
 *
 * 14 番目がこのセッションの線そのものになる ── 3-8-21 は
 * `checkout --ours` / `--theirs` を持たないと決めており、それは
 * 「置かなかった」ではなく「この経路では起こらない」として測れる。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `readGitConflictFileDiff` で、その下の runGit / gitCommands /
 * gitQueue / gitBlob / gitDiffSide / gitPathspec / gitRepository はすべて
 * 本番のものが動く。差し替えるのは2つだけ（electron の logger と、
 * 現在の Workspace）。
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

const { readGitConflictFileDiff } = await import('./gitConflictDiff')

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

/** 作業リポジトリにバイト列を書く（バイナリの競合を作る）。 */
function writeBytes(relativePath: string, bytes: Uint8Array): void {
  writeFileSync(join(root, relativePath), bytes)
}

/** index に載っている段の数（競合なら 1〜3、解決済みなら 0 件）。 */
function unmergedStages(relativePath: string): number {
  return git('ls-files', '-u', '--', relativePath)
    .split('\n')
    .filter((line) => line.trim().length > 0).length
}

/** 応答の差分を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(diff: GitConflictFileDiff): Extract<GitConflictFileDiff, { status: 'ready' }> {
  expect(diff.status, `ready ではない差分: ${JSON.stringify(diff)}`).toBe('ready')

  return diff as Extract<GitConflictFileDiff, { status: 'ready' }>
}

/** 本番の経路で競合の差分を読む。 */
async function readDiff(relativePath: string): Promise<GitConflictFileDiff> {
  const outcome = await readGitConflictFileDiff({ relativePath })

  return outcome.diff
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * `merge.conflictStyle` も `core.autocrlf` も開発者の PC に入っていて
 * おかしくない ── 前者は作業ツリーのマーカーの形を、後者は読み取った
 * 中身の改行を変える（3-8-14 〜 3-8-20 と同じ構え）。
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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-conflict-diff-')))

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

/** 競合するはずのマージを走らせる（非0で終わるのが正しい）。 */
function mergeExpectingConflict(branch: string): void {
  try {
    git('merge', branch)
  } catch {
    // 競合したこと自体は各テストの expect で確かめる。
  }
}

/**
 * 最初の commit（両方の枝の共通の元）。
 *
 * ここに置いたファイルが merge base（stage 1）になる ── `UU` と `AA` の
 * 違いは、その段が在るかどうかそのものにあたる。
 */
function commitBase(): void {
  write('base.txt', 'base\n')
  git('add', '--', 'base.txt')
  git('commit', '--quiet', '-m', 'base')
}

/**
 * 実 git を何本も起動するテストの待ち時間（Session 3-8-20 で明示した）。
 *
 * 1件あたり 10 本前後の git プロセスを起動する ── 準備の commit / switch に
 * 加えて、`readGitConflictFileDiff` は状態を読み直し（`rev-parse` /
 * `symbolic-ref` / `remote` / `rev-parse MERGE_HEAD` / `status`）、
 * その後に `ls-files --stage` と、段ごとの `cat-file -s` / `cat-file blob` を
 * 動かす。vitest の既定（5 秒）では、100 本を超えるテストファイルを並べた
 * ときに落ちる（docs/DEVELOPMENT.md §4）。
 */
const REAL_GIT_TIMEOUT_MS = 30_000

describeWithGit('readGitConflictFileDiff', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /* ------------------------------------------------------- 両側に中身がある形 */

  it('内容の競合（UU）で、左に ours・右に theirs の中身が出る', async () => {
    commitBase()
    write('f.txt', 'line1\nline2\nline3\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    write('f.txt', 'line1\nFEAT\nline3\n')
    git('commit', '--quiet', '-am', 'feat')

    git('switch', '--quiet', 'main')
    write('f.txt', 'line1\nMAIN\nline3\n')
    git('commit', '--quiet', '-am', 'main2')

    mergeExpectingConflict('feat')
    expect(unmergedStages('f.txt')).toBe(3)

    const diff = readyOf(await readDiff('f.txt'))

    expect(diff.shape).toBe('both-modified')
    expect(diff.original).toBe('line1\nMAIN\nline3\n')
    expect(diff.modified).toBe('line1\nFEAT\nline3\n')
  })

  /*
    3-8-21 でいちばん取り違えやすいところ。

    作業ツリーのファイルには `<<<<<<<` の入った**混ざった中身**が入って
    いる ── それを左右に出すと「解決作業の途中の姿」を2回見せることに
    なる。出すのは index の段そのものになる。
  */
  it('出すのは index の段で、作業ツリーの中身（マーカー入り）ではない', async () => {
    commitBase()
    write('f.txt', 'a\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    write('f.txt', 'THEIRS\n')
    git('commit', '--quiet', '-am', 'feat')

    git('switch', '--quiet', 'main')
    write('f.txt', 'OURS\n')
    git('commit', '--quiet', '-am', 'main2')

    mergeExpectingConflict('feat')

    const diff = readyOf(await readDiff('f.txt'))

    expect(diff.original).toBe('OURS\n')
    expect(diff.modified).toBe('THEIRS\n')
    expect(diff.original).not.toContain('<<<<<<<')
    expect(diff.modified).not.toContain('<<<<<<<')
  })

  it('両方が同じ位置に別々に追加すると（AA）、base が無く両側に中身がある', async () => {
    commitBase()

    git('switch', '--quiet', '--create', 'feat')
    write('new.txt', 'FROM FEAT\n')
    git('add', '--', 'new.txt')
    git('commit', '--quiet', '-m', 'feat adds')

    git('switch', '--quiet', 'main')
    write('new.txt', 'FROM MAIN\n')
    git('add', '--', 'new.txt')
    git('commit', '--quiet', '-m', 'main adds')

    mergeExpectingConflict('feat')

    // base（stage 1）が無いので、段は2つになる。
    expect(unmergedStages('new.txt')).toBe(2)

    const diff = readyOf(await readDiff('new.txt'))

    expect(diff.shape).toBe('both-added')
    expect(diff.original).toBe('FROM MAIN\n')
    expect(diff.modified).toBe('FROM FEAT\n')
  })

  /* --------------------------------------------------------- 片側が無い形 */

  it('theirs で削除された競合（UD）では、右が空になる ── 失敗にしない', async () => {
    commitBase()
    write('f.txt', 'a\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    git('rm', '--quiet', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'feat deletes')

    git('switch', '--quiet', 'main')
    write('f.txt', 'CHANGED\n')
    git('commit', '--quiet', '-am', 'main changes')

    mergeExpectingConflict('feat')

    const diff = readyOf(await readDiff('f.txt'))

    expect(diff.shape).toBe('deleted-by-them')
    expect(diff.original).toBe('CHANGED\n')
    expect(diff.modified).toBe('')
  })

  it('ours で削除された競合（DU）では、左が空になる', async () => {
    commitBase()
    write('f.txt', 'a\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    write('f.txt', 'CHANGED\n')
    git('commit', '--quiet', '-am', 'feat changes')

    git('switch', '--quiet', 'main')
    git('rm', '--quiet', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'main deletes')

    mergeExpectingConflict('feat')

    const diff = readyOf(await readDiff('f.txt'))

    expect(diff.shape).toBe('deleted-by-us')
    expect(diff.original).toBe('')
    expect(diff.modified).toBe('CHANGED\n')
  })

  /*
    `DD` / `AU` / `UA` は、rename と削除・rename どうしの食い違いで現れる。

    **本当に起こるのか自体が実物でしか言えない**ので、ここで作り方ごと
    固定してある ── 段が1つ（または base だけ）という状態が index に
    在りうることが、片側欠落の表示を作った根拠そのものになる。
  */
  /*
    `DD` / `AU` / `UA` の3つは、**同じ1回のマージで同時に現れる。**

    片方が `f.txt` を `x.txt` へ、もう片方が `y.txt` へ改名すると、git は
    3行の競合を作る（実物で確かめてある）。

      `f.txt` … stage 1 だけ（両方で消えた ＝ DD）
      `x.txt` … stage 3 だけ（theirs だけが作った ＝ UA）
      `y.txt` … stage 2 だけ（ours だけが作った ＝ AU）

    **こう書くまでに1回空振りしている** ── 最初は「片方が rename・片方が
    削除」で `DD` を作ろうとしたが、git はそれを改名先の位置に `DU` として
    置く（元の位置には競合が残らない）。どの操作がどの段を作るかは git が
    決めていて、こちらの推測ではない、というのがこのファイルの存在理由に
    あたる。

    この3行を1つに束ねて見せる UI は Session 3-8-21 の範囲外で、
    ここで確かめているのは**3行それぞれが差分を開ける**ことになる。
  */
  it('改名先が食い違うと、DD / UA / AU の3つが同時に現れる', async () => {
    commitBase()
    write('f.txt', 'a\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    git('mv', 'f.txt', 'x.txt')
    git('commit', '--quiet', '-m', 'feat renames to x')

    git('switch', '--quiet', 'main')
    git('mv', 'f.txt', 'y.txt')
    git('commit', '--quiet', '-m', 'main renames to y')

    mergeExpectingConflict('feat')

    // 元の位置は段が1つ（base）だけ残る。
    expect(unmergedStages('f.txt')).toBe(1)
    expect(unmergedStages('x.txt')).toBe(1)
    expect(unmergedStages('y.txt')).toBe(1)

    /*
      両方で消えた（DD）── **両側とも空**になる。押しても何も出ない
      ボタンにしないのがこの形の要点で、面の側は
      「どちらにもファイルが存在しません」と言えるだけの情報を受け取る。
    */
    const removed = readyOf(await readDiff('f.txt'))

    expect(removed.shape).toBe('both-deleted')
    expect(removed.original).toBe('')
    expect(removed.modified).toBe('')

    // theirs だけが作った（UA）── 左が空。
    const theirsOnly = readyOf(await readDiff('x.txt'))

    expect(theirsOnly.shape).toBe('added-by-them')
    expect(theirsOnly.original).toBe('')
    expect(theirsOnly.modified).toBe('a\n')

    // ours だけが作った（AU）── 右が空。
    const oursOnly = readyOf(await readDiff('y.txt'))

    expect(oursOnly.shape).toBe('added-by-us')
    expect(oursOnly.original).toBe('a\n')
    expect(oursOnly.modified).toBe('')
  })

  /*
    「片方が rename・片方が削除」は `DD` ではなく、**改名先の `DU`** になる。

    上のテストで空振りした形そのものを、答えの側から固定してある ──
    元の位置（`f.txt`）にはもう競合が無く、そこを押す口も一覧に出ない。
  */
  it('片方が rename・片方が削除すると、改名先が「ours で削除」の形になる', async () => {
    commitBase()
    write('f.txt', 'a\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    git('mv', 'f.txt', 'renamed.txt')
    git('commit', '--quiet', '-m', 'feat renames')

    git('switch', '--quiet', 'main')
    git('rm', '--quiet', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'main deletes')

    mergeExpectingConflict('feat')

    // 元の位置には競合が残らない。
    expect(unmergedStages('f.txt')).toBe(0)
    expect(await readDiff('f.txt')).toEqual({ status: 'unavailable', reason: 'not-found' })

    const diff = readyOf(await readDiff('renamed.txt'))

    expect(diff.shape).toBe('deleted-by-us')
    expect(diff.original).toBe('')
    expect(diff.modified).toBe('a\n')
  })

  /* ------------------------------------------------------- 出せないもの */

  it('バイナリの競合は `binary` として返る（失敗にしない）', async () => {
    commitBase()
    writeBytes('b.bin', new Uint8Array([0, 1, 2, 3]))
    git('add', '--', 'b.bin')
    git('commit', '--quiet', '-m', 'add bin')

    git('switch', '--quiet', '--create', 'feat')
    writeBytes('b.bin', new Uint8Array([0, 9, 9, 9]))
    git('commit', '--quiet', '-am', 'feat bin')

    git('switch', '--quiet', 'main')
    writeBytes('b.bin', new Uint8Array([0, 7, 7, 7]))
    git('commit', '--quiet', '-am', 'main bin')

    mergeExpectingConflict('feat')
    expect(unmergedStages('b.bin')).toBe(3)

    expect(await readDiff('b.bin')).toEqual({ status: 'unavailable', reason: 'binary' })
  })

  it('submodule の競合は `unsupported-target` として返る', async () => {
    // 取り込まれる側の repository を2つ作る（指す commit を食い違わせる）。
    const libPath = join(area, 'lib')

    gitIn(area, 'init', '--quiet', '--initial-branch=main', 'lib')
    configure(libPath)
    writeFileSync(join(libPath, 'a.txt'), 'one\n', 'utf8')
    gitIn(libPath, 'add', '--', 'a.txt')
    gitIn(libPath, 'commit', '--quiet', '-m', 'one')

    commitBase()

    /*
      `-c protocol.file.allow=always` を引数で渡す。

      同じ PC のパスを submodule にするのは CVE-2022-39253 の対策で既定では
      断られる（`fatal: transport 'file' not allowed`）── そしてこの設定は
      **local config に書いても効かない**（clone を行う子プロセスへ引き継が
      れない）。テストの準備でだけ立てるもので、本番の引数の表
      （main/git/gitCommands.ts）には1つも入らない。
    */
    git('-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', libPath, 'vendor')
    git('commit', '--quiet', '-m', 'add submodule')

    /*
      lib 側の2つの commit を**枝分かれさせる**。

      一直線に積むと（one → two → three）、片方がもう片方の子孫になり、
      **git が submodule を勝手に早送りして競合しない**（実物で確かめてある。
      最初こう書いて空振りした）。段を3つ作るには、共通の元から
      別々に伸びている必要がある。
    */
    gitIn(libPath, 'switch', '--quiet', '--create', 'side')
    writeFileSync(join(libPath, 'a.txt'), 'side\n', 'utf8')
    gitIn(libPath, 'commit', '--quiet', '-am', 'side')

    gitIn(libPath, 'switch', '--quiet', 'main')
    writeFileSync(join(libPath, 'a.txt'), 'main2\n', 'utf8')
    gitIn(libPath, 'commit', '--quiet', '-am', 'main2')

    // feat 側は lib の `side` を指す。
    git('switch', '--quiet', '--create', 'feat')
    gitIn(join(root, 'vendor'), 'fetch', '--quiet')
    gitIn(join(root, 'vendor'), 'checkout', '--quiet', 'origin/side')
    git('add', '--', 'vendor')
    git('commit', '--quiet', '-m', 'feat bumps submodule')

    // main 側は lib の `main` を指す（`side` の子孫でも祖先でもない）。
    git('switch', '--quiet', 'main')
    gitIn(join(root, 'vendor'), 'checkout', '--quiet', 'origin/main')
    git('add', '--', 'vendor')
    git('commit', '--quiet', '-m', 'main bumps submodule')

    mergeExpectingConflict('feat')

    /*
      段が3つ揃うことをまず確かめる ── ここが 0 のまま素通りすると、
      「submodule を弾いている」ではなく「そもそも競合していない」を
      通してしまう（このテストがいちばん空振りしやすいところ）。
    */
    expect(unmergedStages('vendor')).toBe(3)

    expect(await readDiff('vendor')).toEqual({
      status: 'unavailable',
      reason: 'unsupported-target'
    })
  })

  /* ------------------------------------- 競合でなくなったら、答えない */

  it('競合していない位置は `not-found`（差分の口が別なことの裏取り）', async () => {
    commitBase()
    write('base.txt', 'changed\n')

    expect(await readDiff('base.txt')).toEqual({ status: 'unavailable', reason: 'not-found' })
  })

  it('解決済みにした後は `not-found`（段が1段に畳まれる）', async () => {
    commitBase()
    write('f.txt', 'a\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    write('f.txt', 'THEIRS\n')
    git('commit', '--quiet', '-am', 'feat')

    git('switch', '--quiet', 'main')
    write('f.txt', 'OURS\n')
    git('commit', '--quiet', '-am', 'main2')

    mergeExpectingConflict('feat')
    expect(readyOf(await readDiff('f.txt')).shape).toBe('both-modified')

    write('f.txt', 'RESOLVED\n')
    git('add', '--', 'f.txt')

    expect(unmergedStages('f.txt')).toBe(0)
    expect(await readDiff('f.txt')).toEqual({ status: 'unavailable', reason: 'not-found' })
  })

  it('マージを中止した後も `not-found`（3-8-20 の中止が壊れない）', async () => {
    commitBase()
    write('f.txt', 'a\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    write('f.txt', 'THEIRS\n')
    git('commit', '--quiet', '-am', 'feat')

    git('switch', '--quiet', 'main')
    write('f.txt', 'OURS\n')
    git('commit', '--quiet', '-am', 'main2')

    mergeExpectingConflict('feat')
    expect(readyOf(await readDiff('f.txt')).shape).toBe('both-modified')

    git('merge', '--abort')

    expect(await readDiff('f.txt')).toEqual({ status: 'unavailable', reason: 'not-found' })
  })

  /* ------------------------------------------- 読むだけで、何も動かさない */

  /*
    Session 3-8-21 の線そのもの。

    `checkout --ours` / `--theirs` を置かないと決めた以上、この経路が
    リポジトリを1バイトも動かさないことは**測れる** ── 段の中身も、
    作業ツリーのファイルも、MERGE_HEAD も、差分を読む前後で同じになる。
  */
  it('差分を読んでも、index の段も作業ツリーも動かない', async () => {
    commitBase()
    write('f.txt', 'a\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'add f')

    git('switch', '--quiet', '--create', 'feat')
    write('f.txt', 'THEIRS\n')
    git('commit', '--quiet', '-am', 'feat')

    git('switch', '--quiet', 'main')
    write('f.txt', 'OURS\n')
    git('commit', '--quiet', '-am', 'main2')

    mergeExpectingConflict('feat')

    const stagesBefore = git('ls-files', '-u', '--', 'f.txt')
    const worktreeBefore = git('status', '--porcelain=v2', '-z')

    readyOf(await readDiff('f.txt'))

    expect(git('ls-files', '-u', '--', 'f.txt')).toBe(stagesBefore)
    expect(git('status', '--porcelain=v2', '-z')).toBe(worktreeBefore)
    // マージの途中であることも動かない（3-8-20 の帯が消えない）。
    expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(true)
  })
})
