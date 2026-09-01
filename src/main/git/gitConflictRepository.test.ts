import { execFileSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
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
 * 本物の git に対する競合の解決の検証（Session 3-8-18）。
 *
 * ## ここで固定したいのは「git が通してしまうこと」と「その先が繋がること」
 *
 * 3-8-16 / 3-8-17 が確かめたのは remote まわりだったが、こちらの2つは
 * 性質が違う。
 *
 *   1. **git はマーカーが残ったままの `add` も Commit も通す**
 *      （つまり `<<<<<<<` が履歴に永久に残る）── だからアプリが手前で断る
 *   2. **解決した後、3-8-4 の Commit がそのままマージを完結させる**
 *      （マージ commit が作られ、MERGE_HEAD が消える）── だから 3-8-18 で
 *      足したのは1手だけで済む
 *
 * 2つめが「3方向マージのエディタを作らない」という判断の根拠そのものに
 * あたる ── 写しを相手にすると、その前提を自分で書くことになる。
 *
 * 実物にしか確かめられないのは次の 12 個。
 *
 *  1. `stash pop` の競合が `u UU` を作る（**アプリ自身が競合を生む唯一の経路**）
 *  2. マーカーを消して保存しても、`add` するまで `u UU` のまま
 *  3. 「解決済みにする」で index の3段が1段に畳まれ、ステージ済みへ移る
 *  4. その後、本番と同じ引数の Commit が通る
 *  5. マージの途中では、その Commit が**マージ commit**を作り MERGE_HEAD が消える
 *  6. **git はマーカーが残ったままの `add` を通す**が、こちらは断る
 *  7. 断ったとき、index は1段も動いていない
 *  8. `git diff --check` は空白の誤りも同じ終了コードで報告する（＝行を読む理由）
 *  9. `.gitattributes` の `whitespace=` は `-c core.whitespace=` より強い（同上）
 * 10. 片方が削除された競合（`UD`）にはマーカーが無く、そのまま解決できる
 * 11. バイナリの競合にもマーカーが無く、そのまま解決できる
 * 12. `git reset HEAD` は**競合を復元しない**（＝取り消しを置かない根拠）
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `applyGitResolveConflict` で、その下の runGit / gitCommands /
 * gitQueue / gitFailure / gitOutput / gitPathspec はすべて本番のものが動く。
 * 差し替えるのは2つだけ（electron の logger と、現在の Workspace）。
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

const { applyGitResolveConflict } = await import('./gitConflict')

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

/** `git status --porcelain=v2 -z` の生の並び（テスト自身の確認用）。 */
function statusRecords(): readonly string[] {
  return git('status', '--porcelain=v2', '-z')
    .split('\0')
    .filter((record) => record.length > 0)
}

/** その位置が今どういう状態で index に載っているか（`u` / `1` / 無し）。 */
function stateOf(relativePath: string): string | null {
  const record = statusRecords().find((entry) => entry.endsWith(relativePath))

  return record === undefined ? null : record.slice(0, record.indexOf(' '))
}

/** index に載っている段の数（競合なら 3、解決済みなら 0 件になる）。 */
function unmergedStages(relativePath: string): number {
  return git('ls-files', '-u', '--', relativePath)
    .split('\n')
    .filter((line) => line.trim().length > 0).length
}

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

/**
 * この PC の git 設定を、テストの間だけ見えなくする。
 *
 * `merge.conflictStyle`（`diff3` / `zdiff3`）は開発者の PC に入っていて
 * おかしくなく、**マーカーの行数そのものを変える** ── 見えなくしておかないと、
 * 通る PC と通らない PC が出る（3-8-14 〜 3-8-17 と同じ構え）。
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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-conflict-')))

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

/**
 * 内容の競合を1件作る（マージ）。
 *
 * `main` と `feat` が同じ行を別々に変えた状態にしてから merge する。
 */
function createMergeConflict(): void {
  write('f.txt', 'line1\nline2\nline3\n')
  git('add', '--', 'f.txt')
  git('commit', '--quiet', '-m', 'base')

  git('switch', '--quiet', '--create', 'feat')
  write('f.txt', 'line1\nFEAT\nline3\n')
  git('commit', '--quiet', '-am', 'feat')

  git('switch', '--quiet', 'main')
  write('f.txt', 'line1\nMAIN\nline3\n')
  git('commit', '--quiet', '-am', 'main2')

  // 競合するので非0で終わる（それがここで欲しい状態にあたる）。
  try {
    git('merge', 'feat')
  } catch {
    // 競合したこと自体は下の expect で確かめる。
  }
}

/**
 * 退避を戻したときの競合を1件作る（`stash pop`）。
 *
 * **アプリ自身が競合を生む唯一の経路**にあたる ── Pull は `--ff-only` 固定で
 * 競合せず、切り替えは競合しそうなら git が断る（main/git/gitCommands.ts）。
 */
function createStashPopConflict(): void {
  write('f.txt', 'line1\nline2\nline3\n')
  git('add', '--', 'f.txt')
  git('commit', '--quiet', '-m', 'base')

  write('f.txt', 'line1\nSTASHED\nline3\n')
  git('stash', 'push', '--quiet')

  write('f.txt', 'line1\nOTHER\nline3\n')
  git('commit', '--quiet', '-am', 'other')

  try {
    git('stash', 'pop')
  } catch {
    // 競合したこと自体は下の expect で確かめる。
  }
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

describeWithGit('applyGitResolveConflict', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /*
    アプリ自身が作れる競合。3-8-15 の pop が `partly-applied` として返す
    状態がこれで、そこから出る道が 3-8-18 まで無かった。
  */
  it('`stash pop` の競合が、解決の対象になる（アプリが作れる唯一の競合）', async () => {
    createStashPopConflict()

    expect(stateOf('f.txt')).toBe('u')
    expect(unmergedStages('f.txt')).toBe(3)
    // 退避は残っている（3-8-15 の「捨てずに残す」）。
    expect(git('stash', 'list').trim().length).toBeGreaterThan(0)
  })

  /*
    3-8-18 が埋めた穴そのもの ── マーカーを消して保存しても、
    Git へ伝えるまでは競合のままになる。
  */
  it('マーカーを消して保存しても、伝えるまでは競合のまま', () => {
    createMergeConflict()

    expect(stateOf('f.txt')).toBe('u')

    write('f.txt', 'line1\nRESOLVED\nline3\n')

    expect(stateOf('f.txt')).toBe('u')
    expect(unmergedStages('f.txt')).toBe(3)
  })

  it('解決済みにすると、3段が1段に畳まれてステージ済みへ移る', async () => {
    createMergeConflict()
    write('f.txt', 'line1\nRESOLVED\nline3\n')

    const result = await applyGitResolveConflict('f.txt')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(unmergedStages('f.txt')).toBe(0)

    const ready = readyOf(result.repository)

    expect(ready.changes.conflicted).toEqual([])
    expect(ready.changes.staged.map((change) => change.relativePath)).toEqual(['f.txt'])
  })

  /*
    ここが「3方向マージのエディタを作らない」という判断の根拠になる ──
    解決の先は 3-8-4 で既に出来上がっていて、**本番と同じ引数**が
    マージを完結させる。
  */
  it('解決した後、本番と同じ引数の Commit がマージを完結させる', async () => {
    createMergeConflict()
    write('f.txt', 'line1\nRESOLVED\nline3\n')

    expect((await applyGitResolveConflict('f.txt')).outcome).toEqual({ status: 'applied' })

    // マージの途中であること（MERGE_HEAD が在る）。
    expect(() => git('rev-parse', '--verify', 'MERGE_HEAD')).not.toThrow()

    // main/git/gitCommands.ts の `commitStagedChanges` とまったく同じ引数。
    execFileSync(
      gitExecutable as string,
      ['commit', '--quiet', '--cleanup=whitespace', '--file=-'],
      {
        cwd: root,
        env: createGitEnvironment(process.env),
        input: 'resolve merge',
        encoding: 'utf8',
        windowsHide: true
      }
    )

    // 親が2つ ＝ マージ commit になった。
    expect(git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/)).toHaveLength(3)
    // 途中で止まっている印が消えている。
    expect(() => git('rev-parse', '--verify', 'MERGE_HEAD')).toThrow()
    expect(git('status', '--porcelain').trim()).toBe('')
  })

  it('退避の競合でも、解決してそのまま Commit できる', async () => {
    createStashPopConflict()
    write('f.txt', 'line1\nRESOLVED\nline3\n')

    expect((await applyGitResolveConflict('f.txt')).outcome).toEqual({ status: 'applied' })

    // こちらはマージではないので、普通の commit になる（親は1つ）。
    execFileSync(
      gitExecutable as string,
      ['commit', '--quiet', '--cleanup=whitespace', '--file=-'],
      {
        cwd: root,
        env: createGitEnvironment(process.env),
        input: 'resolve stash',
        encoding: 'utf8',
        windowsHide: true
      }
    )

    expect(git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/)).toHaveLength(2)
  })

  /*
    **この塊でいちばん大事な1件。**

    git はマーカーが残ったままの `add` も、その後の Commit も通す ──
    つまり `<<<<<<< HEAD` がそのまま履歴に残る。だからアプリが手前で断る。
  */
  it('git はマーカーが残ったままの add と commit を通す（＝断る理由）', () => {
    createMergeConflict()

    // 解決せず、マーカーを残したまま。
    git('add', '--', 'f.txt')

    expect(unmergedStages('f.txt')).toBe(0)

    execFileSync(
      gitExecutable as string,
      ['commit', '--quiet', '--cleanup=whitespace', '--file=-'],
      {
        cwd: root,
        env: createGitEnvironment(process.env),
        input: 'oops',
        encoding: 'utf8',
        windowsHide: true
      }
    )

    // マーカーが履歴に入ってしまった。
    expect(git('show', 'HEAD:f.txt')).toContain('<<<<<<<')
  })

  it('マーカーが残っていれば断り、index は1段も動かない', async () => {
    createMergeConflict()

    const result = await applyGitResolveConflict('f.txt')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'conflict-markers-present' })
    // 断ったので、競合はそのまま残っている。
    expect(unmergedStages('f.txt')).toBe(3)
    expect(stateOf('f.txt')).toBe('u')
    expect(readyOf(result.repository).changes.conflicted.map((c) => c.relativePath)).toEqual([
      'f.txt'
    ])
  })

  it('一部だけ消した（片方のマーカーが残っている）場合も断る', async () => {
    createMergeConflict()

    // `=======` と `>>>>>>>` だけ消して、`<<<<<<<` を残した。
    write('f.txt', 'line1\n<<<<<<< HEAD\nMAIN\nline3\n')

    expect((await applyGitResolveConflict('f.txt')).outcome).toEqual({
      status: 'failed',
      reason: 'conflict-markers-present'
    })
    expect(unmergedStages('f.txt')).toBe(3)
  })

  /*
    競合していない位置に `git add` を当てると、それはただの Stage になる ──
    別の口として分けた意味がそこで消えるので、Main が読み直した状態で確かめる
    （3-8-9 の破棄と同じ構え）。
  */
  it('競合していない位置は受け取らない（ただの Stage にしない）', async () => {
    write('a.txt', 'one\n')
    git('add', '--', 'a.txt')
    git('commit', '--quiet', '-m', 'base')
    write('a.txt', 'two\n')

    const result = await applyGitResolveConflict('a.txt')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'path-not-found' })
    // Stage されていない（`.M` のまま ＝ 作業ツリー側だけが変わっている）。
    expect(readyOf(result.repository).changes.staged).toEqual([])
    expect(readyOf(result.repository).changes.unstaged.map((c) => c.relativePath)).toEqual([
      'a.txt'
    ])
  })

  it('押すまでの間に端末で解決されていたら、git を動かさず断る', async () => {
    createMergeConflict()
    write('f.txt', 'line1\nRESOLVED\nline3\n')
    // 端末で先に解決された。
    git('add', '--', 'f.txt')

    expect((await applyGitResolveConflict('f.txt')).outcome).toEqual({
      status: 'failed',
      reason: 'path-not-found'
    })
  })

  /*
    片方が削除された競合（`UD`）。マーカーはそもそも無いので、
    **断ってはいけない** ── 作業ツリーに在る中身をそのまま残す解決になる。
  */
  it('片方が削除された競合（UD）は、マーカーが無いのでそのまま解決できる', async () => {
    write('d.txt', 'a\nb\n')
    git('add', '--', 'd.txt')
    git('commit', '--quiet', '-m', 'base')

    git('switch', '--quiet', '--create', 'feat')
    git('rm', '--quiet', '--', 'd.txt')
    git('commit', '--quiet', '-m', 'del')

    git('switch', '--quiet', 'main')
    write('d.txt', 'a\nCHANGED\n')
    git('commit', '--quiet', '-am', 'mod')

    try {
      git('merge', 'feat')
    } catch {
      // 競合する。
    }

    expect(stateOf('d.txt')).toBe('u')

    const result = await applyGitResolveConflict('d.txt')

    expect(result.outcome).toEqual({ status: 'applied' })
    expect(unmergedStages('d.txt')).toBe(0)
  })

  /*
    両方が同じ位置を新しく足した競合（`AA`。Session 3-8-22A）。

    共通の元（stage 1）が無い形で、**マーカーは書かれる** ── そこは `UU` と
    同じで、消さずに押せば断られる側になる。
  */
  it('両方が足した競合（AA）は、マーカーを消せば解決できる', async () => {
    write('base.txt', 'x\n')
    git('add', '--', 'base.txt')
    git('commit', '--quiet', '-m', 'base')

    git('switch', '--quiet', '--create', 'feat')
    write('new.txt', 'THEIRS\n')
    git('add', '--', 'new.txt')
    git('commit', '--quiet', '-m', 'theirs')

    git('switch', '--quiet', 'main')
    write('new.txt', 'OURS\n')
    git('add', '--', 'new.txt')
    git('commit', '--quiet', '-m', 'ours')

    try {
      git('merge', 'feat')
    } catch {
      // 競合する。
    }

    expect(stateOf('new.txt')).toBe('u')
    // 共通の元が無いので、段は 2 つ（ours / theirs）だけになる。
    expect(unmergedStages('new.txt')).toBe(2)

    // マーカーが残っている間は断る（`UU` とまったく同じ扱い）。
    expect((await applyGitResolveConflict('new.txt')).outcome).toEqual({
      status: 'failed',
      reason: 'conflict-markers-present'
    })

    write('new.txt', 'OURS\n')

    expect((await applyGitResolveConflict('new.txt')).outcome).toEqual({ status: 'applied' })
    expect(unmergedStages('new.txt')).toBe(0)
  })

  /*
    rename / rename の競合（Session 3-8-22A）。

    **1回のマージで3つの形が同時に出る**（実物で確かめてある）──

      `DD` … 元の位置（両方が動かしたので、そこには何も無い）
      `AU` … ours が付けた新しい位置
      `UA` … theirs が付けた新しい位置

    3-8-22A で確かめたいのはこの3つの解決で、とくに `DD` は
    **作業ツリーにファイルが無いまま `git add` を通す**ことになる。
  */
  it('rename / rename の競合（DD / AU / UA）を、3件とも解決できる', async () => {
    write('orig.txt', 'a\nb\n')
    git('add', '--', 'orig.txt')
    git('commit', '--quiet', '-m', 'base')

    git('switch', '--quiet', '--create', 'feat')
    git('mv', 'orig.txt', 'theirs.txt')
    git('commit', '--quiet', '-m', 'rename-theirs')

    git('switch', '--quiet', 'main')
    git('mv', 'orig.txt', 'ours.txt')
    git('commit', '--quiet', '-m', 'rename-ours')

    try {
      git('merge', 'feat')
    } catch {
      // 競合する。
    }

    expect(stateOf('orig.txt')).toBe('u')
    expect(stateOf('ours.txt')).toBe('u')
    expect(stateOf('theirs.txt')).toBe('u')

    /*
      段の数がそのまま形を表す（`gitBlob.ts` の `toGitConflictShape` と
      同じ読み方）── 元の位置は共通の元だけ、新しい位置は片側だけになる。
    */
    expect(unmergedStages('orig.txt')).toBe(1)
    expect(unmergedStages('ours.txt')).toBe(1)
    expect(unmergedStages('theirs.txt')).toBe(1)

    /*
      `DD` の位置には**ファイルが無い。** ここが 3-8-22A で
      `canOpenGitChange` を直した理由そのものにあたる
      （renderer/src/git/gitChanges.ts）。
    */
    expect(existsSync(join(root, 'orig.txt'))).toBe(false)
    expect(existsSync(join(root, 'ours.txt'))).toBe(true)
    expect(existsSync(join(root, 'theirs.txt'))).toBe(true)

    /*
      3件とも通る。**`DD` も通る**のが確かめたいところで、
      `git add` は消えている位置に対して「削除を記録する」として働く
      （通らなければ、利用者はこの競合から出られない）。
    */
    for (const path of ['orig.txt', 'ours.txt', 'theirs.txt']) {
      expect((await applyGitResolveConflict(path)).outcome, path).toEqual({ status: 'applied' })
      expect(unmergedStages(path), path).toBe(0)
    }

    // 3件とも畳めば、競合は1件も残らない（次は Commit で完結する）。
    expect(statusRecords().filter((record) => record.startsWith('u '))).toHaveLength(0)
  })

  /*
    バイナリの競合。git はマーカーを書き込めないので `--check` は何も言わない ──
    ここでも断ってはいけない。
  */
  it('バイナリの競合も、マーカーが無いのでそのまま解決できる', async () => {
    writeFileSync(join(root, 'b.dat'), Buffer.from([0, 1, 2, 3]))
    git('add', '--', 'b.dat')
    git('commit', '--quiet', '-m', 'base')

    git('switch', '--quiet', '--create', 'feat')
    writeFileSync(join(root, 'b.dat'), Buffer.from([0, 9, 9, 3]))
    git('commit', '--quiet', '-am', 'feat')

    git('switch', '--quiet', 'main')
    writeFileSync(join(root, 'b.dat'), Buffer.from([0, 5, 5, 3]))
    git('commit', '--quiet', '-am', 'main2')

    try {
      git('merge', 'feat')
    } catch {
      // 競合する。
    }

    expect(stateOf('b.dat')).toBe('u')
    expect((await applyGitResolveConflict('b.dat')).outcome).toEqual({ status: 'applied' })
  })

  it('Workspace が閉じられていれば git を動かさない', async () => {
    workspace = null

    const result = await applyGitResolveConflict('f.txt')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'not-ready' })
  })
})

/**
 * `git diff --check` の振る舞いそのもの（Session 3-8-18）。
 *
 * ここだけ確かめる相手が git になる ── **終了コードでは決められない**ことが、
 * 出力の行を読む（`countLeftoverConflictMarkers`）という判断の根拠にあたる。
 */
describeWithGit('git diff --check の振る舞い', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  function conflictAndResolve(): void {
    write('f.txt', 'a\nb\nc\n')
    write('g.txt', 'x\ny\nz\n')
    git('add', '--', 'f.txt')
    git('add', '--', 'g.txt')
    git('commit', '--quiet', '-m', 'base')

    git('switch', '--quiet', '--create', 'feat')
    write('f.txt', 'a\nFEAT\nc\n')
    write('g.txt', 'x\nFEAT2\nz\n')
    git('commit', '--quiet', '-am', 'feat')

    git('switch', '--quiet', 'main')
    write('f.txt', 'a\nMAIN\nc\n')
    write('g.txt', 'x\nMAIN2\nz\n')
    git('commit', '--quiet', '-am', 'main2')

    try {
      git('merge', 'feat')
    } catch {
      // 競合する。
    }
  }

  /** `--check` を動かして、終了コードと出力を取る（非0でも投げない）。 */
  function check(...args: readonly string[]): { code: number; stdout: string } {
    try {
      return { code: 0, stdout: gitIn(root, ...args) }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string }

      return { code: failure.status ?? -1, stdout: failure.stdout ?? '' }
    }
  }

  it('マーカーが残っていれば、その行を報告する', () => {
    conflictAndResolve()

    const result = check('diff', '--check', '--', 'f.txt')

    expect(result.code).not.toBe(0)
    expect(result.stdout).toContain('leftover conflict marker')
  })

  it('pathspec で絞れる（別のファイルのマーカーで断られない）', () => {
    conflictAndResolve()
    write('f.txt', 'a\nRESOLVED\nc\n')

    // g.txt にはまだマーカーが残っているが、f.txt に絞れば何も出ない。
    expect(check('diff', '--check', '--', 'f.txt').code).toBe(0)
    expect(check('diff', '--check', '--', 'g.txt').code).not.toBe(0)
  })

  /*
    **終了コードでは決められない理由そのもの。**

    行末に空白があるだけの（解決し終えた）ファイルが、マーカーと同じ
    終了コードで報告される ── 終了コードだけを見ると、解決したのに断られる。
  */
  it('空白の誤りも同じ終了コードで報告する（＝行を読む理由）', () => {
    conflictAndResolve()
    // 解決したが、行末に空白を残した。
    write('g.txt', 'x\nOK2   \nz\n')

    const result = check('diff', '--check', '--', 'g.txt')

    expect(result.code).not.toBe(0)
    expect(result.stdout).toContain('trailing whitespace')
    // マーカーは1つも無い ── だから読む側は言い回しで分ける。
    expect(result.stdout).not.toContain('leftover conflict marker')
  })

  /*
    `-c core.whitespace=-...` で空白の検査を切る手もあるが、
    `.gitattributes` の `whitespace=` は**その `-c` より強い** ──
    つまり設定次第で誤検知が戻る。出力を読む形なら、どちらでも答えが変わらない。
  */
  it('`.gitattributes` の whitespace は `-c core.whitespace` より強い', () => {
    conflictAndResolve()
    write('g.txt', 'x\nOK2   \nz\n')
    write('.gitattributes', '*.txt whitespace=blank-at-eol\n')

    const disabled =
      '-blank-at-eol,-space-before-tab,-indent-with-non-tab,-blank-at-eof,-tab-in-indent,-cr-at-eol'
    const result = check('-c', `core.whitespace=${disabled}`, 'diff', '--check', '--', 'g.txt')

    // 切ったつもりでも報告される（＝この手は当てにできない）。
    expect(result.code).not.toBe(0)
    expect(result.stdout).toContain('trailing whitespace')
  })
})

/**
 * 取り消しを置かない根拠（Session 3-8-18）。
 *
 * 「解決済みにする」の取り消しを作らないと決めたのは、git に**戻す手立てが
 * 無い**ためではなく、**戻したことにならない手立てしか無い**ためになる。
 */
describeWithGit('解決を取り消せない理由', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  function resolved(): void {
    write('f.txt', 'a\nb\nc\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'base')

    git('switch', '--quiet', '--create', 'feat')
    write('f.txt', 'a\nFEAT\nc\n')
    git('commit', '--quiet', '-am', 'feat')

    git('switch', '--quiet', 'main')
    write('f.txt', 'a\nMAIN\nc\n')
    git('commit', '--quiet', '-am', 'main2')

    try {
      git('merge', 'feat')
    } catch {
      // 競合する。
    }

    write('f.txt', 'a\nRESOLVED\nc\n')
    git('add', '--', 'f.txt')
  }

  /*
    **本番の Unstage（`reset HEAD`）は競合を復元しない。**

    3段が畳まれたただの変更として残る ── これを「取り消し」として出すと、
    押した人は戻ったつもりで競合の情報を失う。だから解決した行に
    `−` を出さない（renderer/src/git/gitChanges.ts）。
  */
  it('`git reset HEAD` は競合を復元しない（ただの変更になる）', () => {
    resolved()

    expect(unmergedStages('f.txt')).toBe(0)

    // main/git/gitCommands.ts の `unstagePathsFromHead` とまったく同じ引数。
    git('reset', '--quiet', 'HEAD', '--', 'f.txt')

    // 競合は戻っていない。
    expect(unmergedStages('f.txt')).toBe(0)
    expect(stateOf('f.txt')).toBe('1')
    // 利用者が書いた中身はそのまま残っている。
    expect(git('show', ':f.txt')).not.toContain('RESOLVED')
  })

  /*
    `checkout --merge` なら競合そのものは戻せるが、**利用者が書いた解決内容を
    上書きする** ── これも「取り消し」として出せる振る舞いではない。
  */
  it('`git checkout --merge` は競合を戻すが、書いた解決内容を消す', () => {
    resolved()

    git('checkout', '--merge', '--', 'f.txt')

    expect(unmergedStages('f.txt')).toBe(3)
    // 書いたものは残っていない（マーカーで上書きされた）。
    expect(git('show', ':2:f.txt')).not.toContain('RESOLVED')
  })
})
