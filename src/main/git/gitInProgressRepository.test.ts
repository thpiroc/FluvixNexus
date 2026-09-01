import { execFileSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GitInProgressOperation, GitRepositoryState } from '@shared/git'
import type { WorkspaceFolder } from '@shared/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform } from '../platform'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'

/**
 * 本物の git に対する「途中の操作」の検出と禁止の検証（Session 3-8-22A）。
 *
 * ## ここで固定したいのは、禁止の**根拠**そのもの
 *
 * 3-8-20 は `MERGE_HEAD` を読むようになったが、それで止めていたのは
 * もう1度マージすることだけだった。切り替え・作成・退避は素通りしていて、
 * 「競合が残っている間は git が断るから実害が無い」というのがその理由になる。
 *
 * **その理由が成り立たない一瞬がある。** 競合を全部解決して `git add` まで
 * 済ませ、まだ Commit していない状態では index がきれいなので、
 * git は `stash push` を通してしまう ── 通ると `MERGE_HEAD` は黙って消え、
 * 解決に費やした作業ごとマージが無かったことになる。
 *
 * これは**実物にしか確かめられない**（写しを相手にすると、アプリが手前で
 * 断つ理由そのものを自分で書くことになる。3-8-16 の `ext::`・3-8-20 の
 * tag / hash と同じ側）。実際、**書く前の見立ては半分外れていた** ──
 * 切り替えも同じように通ると見ていたが、git 2.54 は解決後でも
 * `cannot switch branch while merging` で断る。実物に聞いていなければ、
 * 事実と違う根拠がコメントに残っていた。
 *
 * もう1つ、**もっと危ない見立て違い**も実物が教えてくれた ── rebase を
 * 他の3つと揃えて `REBASE_HEAD` で読もうとしていたが、**その ref は rebase が
 * 完了しても消えない。** そのまま出していたら、1度 rebase を完了した時点から
 * Git パネルが永久に「rebase の途中です」になり、帯が出たまま書き込みが
 * 1つも通らなくなっていた（下の 3 / 4 がその記録になる）。
 *
 * 実物でしか確かめられないのは次の 16 個。
 *
 *  1. `MERGE_HEAD` があるあいだ `inProgress` が `merge`
 *  2. rebase が止まっているあいだ `inProgress` が `rebase`（HEAD は detached）
 *  3. **rebase が完了すると `REBASE_HEAD` は残るのに、途中ではなくなる**
 *  4. rebase を中止すると `REBASE_HEAD` も消える（消え方が2通りある）
 *  5. cherry-pick が止まっているあいだ `inProgress` が `cherry-pick`
 *  6. revert が止まっているあいだ `inProgress` が `revert`
 *  7. **解決し終えた（index がきれいな）マージでも `inProgress` は `merge` のまま**
 *  8. 逆に `stash pop` の競合では、競合があっても `inProgress` は null
 *  9. **そこで git は `stash push` を通してしまう**（＝アプリが手前で断つ理由）
 * 10. 一方 `switch` は git が最後まで断る（**退避とは振る舞いが違う**）
 * 11. アプリの `switch` / `create-branch` / `stash push` / `pull` は
 *     `operation-in-progress` として断り、ref も退避も1つも増えない
 * 12. **Stage / 解決 / Commit は断らない**（マージの出口に要る手）── 通せば
 *     マージ commit（親が2つ）ができて `MERGE_HEAD` が消える
 * 13. fetch はマージの途中では通り、rebase の途中では断る
 * 14. rebase の途中では Stage も Commit も解決も断り、HEAD が1mm も動かない
 * 15. rebase を終えれば、また通るようになる
 * 16. マージ commit の既定メッセージが読め、コメント行が落ちている
 *
 * 9 がこの回の要点にあたる ── ここが「git が断るから任せてよい」を
 * 否定する証拠で、これが無いと 3-8-22A の禁止表は**過剰な用心**にしか
 * 見えない。10 はその逆で、**それでも手前で断つ理由**（git の版に寄りかからない・
 * 断り方を1つに揃える）を支える。
 *
 * ## 本番の経路をそのまま通す
 *
 * 呼ぶのは `applyGit*` / `describeGitRepository` / `describeGitMergeMessage` で、
 * その下の runGit / gitCommands / gitQueue / gitFailure / gitRepository /
 * gitOperationResult はすべて本番のものが動く。差し替えるのは2つだけ
 * （electron の logger と、現在の Workspace）。
 *
 * rebase / cherry-pick / revert は**アプリから始められない**（始める機能を
 * 持たない。DESIGN.md）ので、その状態は素の git で作る ── 端末から始めた
 * ものをアプリが見つける、という実際の経路と同じ形になる。
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

const { applyGitSwitchBranch, applyGitCreateBranch } = await import('./gitBranches')
const { applyGitCommit } = await import('./gitCommit')
const { applyGitResolveConflict } = await import('./gitConflict')
const { applyGitFetch } = await import('./gitFetch')
const { describeGitMergeMessage } = await import('./gitMergeMessage')
const { describeGitRepository } = await import('./gitRepository')
const { applyGitStage } = await import('./gitStage')
const { applyGitStashPush } = await import('./gitStash')
const { applyGitPull } = await import('./gitSync')

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

/** 失敗してもよい git（競合させる準備で使う）。 */
function gitAllowingFailure(...args: readonly string[]): void {
  try {
    git(...args)
  } catch {
    // 競合して非0で終わるのが、ここで欲しい状態にあたる。
  }
}

/** 作業リポジトリにファイルを書く。 */
function write(relativePath: string, content: string): void {
  writeFileSync(join(root, relativePath), content, 'utf8')
}

/** 応答に載っている状態を `ready` として取り出す（そうでなければ不合格）。 */
function readyOf(repository: GitRepositoryState): Extract<GitRepositoryState, { status: 'ready' }> {
  expect(repository.status, `ready ではない状態: ${JSON.stringify(repository)}`).toBe('ready')

  return repository as Extract<GitRepositoryState, { status: 'ready' }>
}

/** 今アプリから見えている「途中の操作」。 */
async function currentInProgress(): Promise<GitInProgressOperation | null> {
  const outcome = await describeGitRepository()

  return readyOf(outcome.repository).inProgress
}

/** その pseudo-ref が今あるか（テスト自身の確認用）。 */
function hasRef(name: string): boolean {
  try {
    git('rev-parse', '--verify', '--quiet', name)
    return true
  } catch {
    return false
  }
}

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
  area = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-inprogress-')))

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
 * `main` と `feat` が同じ行を別々に変えた状態を作る（マージすれば競合する）。
 */
function createDivergedBranches(): void {
  write('f.txt', 'line1\nline2\nline3\n')
  git('add', '--', 'f.txt')
  git('commit', '--quiet', '-m', 'base')

  git('switch', '--quiet', '--create', 'feat')
  write('f.txt', 'line1\nFEAT\nline3\n')
  git('commit', '--quiet', '-am', 'feat')

  git('switch', '--quiet', 'main')
  write('f.txt', 'line1\nMAIN\nline3\n')
  git('commit', '--quiet', '-am', 'main2')
}

/** 競合したマージの途中にする。 */
function startConflictedMerge(): void {
  createDivergedBranches()
  gitAllowingFailure('merge', 'feat')
}

/**
 * 競合を解決し終えた（index がきれいな）マージの途中にする。
 *
 * **ここが 3-8-22A で塞いだ穴そのもの**にあたる ── 競合が残っていないので、
 * git から見れば「普通の、ただし MERGE_HEAD がある」状態になる。
 */
function startResolvedMerge(): void {
  startConflictedMerge()
  write('f.txt', 'line1\nRESOLVED\nline3\n')
  git('add', '--', 'f.txt')
}

/** 止まっている rebase を作る（アプリからは始められないので素の git で）。 */
function startConflictedRebase(): void {
  createDivergedBranches()
  gitAllowingFailure('rebase', 'feat')
}

/** 止まっている cherry-pick を作る。 */
function startConflictedCherryPick(): void {
  createDivergedBranches()
  gitAllowingFailure('cherry-pick', 'feat')
}

/** 止まっている revert を作る。 */
function startConflictedRevert(): void {
  write('f.txt', 'a\n')
  git('add', '--', 'f.txt')
  git('commit', '--quiet', '-m', 'c1')
  write('f.txt', 'b\n')
  git('commit', '--quiet', '-am', 'c2')
  write('f.txt', 'c\n')
  git('commit', '--quiet', '-am', 'c3')

  gitAllowingFailure('revert', '--no-edit', 'HEAD~1')
}

/**
 * 実 git を何本も起動するテストの待ち時間。
 *
 * 3-8-22A で状態の読み取りは最大4本増えた（`rev-parse` ×4。何も途中でない
 * ときだけ4回で、見つかればそこで止まる。main/git/gitRepository.ts）──
 * 1件あたりの git プロセスは 3-8-20 の頃より多い。上限は 3-8-20 で決めた
 * 理由（本当に返ってこなくなったことに気づけるまで）のまま据え置く。
 */
const REAL_GIT_TIMEOUT_MS = 30_000

describeWithGit('途中の操作の検出', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('何も途中でなければ null', async () => {
    createDivergedBranches()

    expect(await currentInProgress()).toBeNull()
  })

  it('マージの途中は merge', async () => {
    startConflictedMerge()

    expect(hasRef('MERGE_HEAD')).toBe(true)
    expect(await currentInProgress()).toBe('merge')
  })

  /*
    3-8-20 の形（`MERGE_HEAD` だけを読む）では、この3つがすべて
    「何も途中でない」に見えていた ── 帯も出ず、Stage も Commit も素通りする。
  */
  it('rebase の途中は rebase（HEAD は detached になっている）', async () => {
    startConflictedRebase()

    // rebase 中は MERGE_HEAD が無い ── 3-8-20 が見落としていた理由そのもの。
    expect(hasRef('MERGE_HEAD')).toBe(false)

    const outcome = await describeGitRepository()
    const ready = readyOf(outcome.repository)

    expect(ready.inProgress).toBe('rebase')
    expect(ready.head.kind).toBe('detached')
  })

  /*
    **3-8-22A でいちばん危なかった誤検出。**

    他の3つと揃えて `REBASE_HEAD` で読もうとしていたが、**rebase が完了しても
    この ref は消えない**（`--abort` では消える）── そのまま使っていたら、
    1度 rebase を完了した時点から Git パネルが永久に「rebase の途中です」に
    なり、帯が出たまま書き込みが1つも通らなくなっていた。

    ここで固定するのは、**ref が残っていても `inProgress` が null であること**に
    なる（読んでいるのが ref ではなく作業場所のフォルダだ、という主張そのもの。
    main/git/gitRepository.ts の `isRebaseInProgress`）。
  */
  it('rebase が完了すると、REBASE_HEAD が残っていても途中ではない', async () => {
    startConflictedRebase()
    write('f.txt', 'line1\nRESOLVED\nline3\n')
    git('add', '--', 'f.txt')
    gitAllowingFailure('-c', 'core.editor=true', 'rebase', '--continue')

    // git が残していく ── これを見て判定してはいけない、という証拠になる。
    expect(hasRef('REBASE_HEAD')).toBe(true)
    // 作業場所は片付いている（git 自身が「途中ではない」と決めている根拠）。
    expect(existsSync(join(root, git('rev-parse', '--git-path', 'rebase-merge').trim()))).toBe(
      false
    )

    expect(await currentInProgress()).toBeNull()
  })

  /* `--abort` の側では ref も消える（消え方が2通りある、ということ自体の記録）。 */
  it('rebase を中止すると、REBASE_HEAD も消える', async () => {
    startConflictedRebase()
    gitAllowingFailure('rebase', '--abort')

    expect(hasRef('REBASE_HEAD')).toBe(false)
    expect(await currentInProgress()).toBeNull()
  })

  it('cherry-pick の途中は cherry-pick', async () => {
    startConflictedCherryPick()

    expect(hasRef('CHERRY_PICK_HEAD')).toBe(true)
    expect(await currentInProgress()).toBe('cherry-pick')
  })

  it('revert の途中は revert', async () => {
    startConflictedRevert()

    expect(hasRef('REVERT_HEAD')).toBe(true)
    expect(await currentInProgress()).toBe('revert')
  })

  /*
    競合の行が0件でも、Commit するまでは途中のまま ── 「競合しているファイルが
    あるか」から導けない、という shared/git/repository.ts の主張がこれになる。
  */
  it('解決し終えた（index がきれいな）マージでも merge のまま', async () => {
    startResolvedMerge()

    const outcome = await describeGitRepository()
    const ready = readyOf(outcome.repository)

    expect(ready.inProgress).toBe('merge')
    expect(ready.changes.conflicted).toEqual([])
    expect(ready.changes.staged.length).toBeGreaterThan(0)
  })

  /*
    逆向き ── 途中でなくても競合はありうる（`stash pop`。3-8-15）。
    ここで `merge` を返してしまうと、マージしていないのに中止の口が出る。
  */
  it('`stash pop` の競合では、途中の操作は無い', async () => {
    write('f.txt', 'line1\nline2\n')
    git('add', '--', 'f.txt')
    git('commit', '--quiet', '-m', 'base')

    write('f.txt', 'line1\nSTASHED\n')
    git('stash', 'push', '--quiet')

    write('f.txt', 'line1\nOTHER\n')
    git('commit', '--quiet', '-am', 'other')

    gitAllowingFailure('stash', 'pop')

    const ready = readyOf((await describeGitRepository()).repository)

    expect(ready.inProgress).toBeNull()
    expect(ready.changes.conflicted.length).toBeGreaterThan(0)
  })
})

describeWithGit('git 自身が通してしまうこと（＝手前で断つ理由）', () => {
  /*
    **3-8-22A でいちばん効く確かめ。**

    競合が残っている間は `git stash push` も断られる。だが解決し終えた
    （index がきれいな）マージでは**通ってしまい、`MERGE_HEAD` が黙って
    消える** ── 利用者が解決に費やした作業ごと、マージが無かったことになる。
    しかも 3-8-20 が merge commit を作った後の取り消しを持たないのと同じで、
    これを戻す口も無い。

    これが「git が断るから任せてよい」を否定する証拠にあたる ── 無ければ
    3-8-22A の禁止表は過剰な用心にしか見えない。
  */
  it(
    '解決し終えたマージでは、素の git が stash push を通して MERGE_HEAD を消す',
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      startResolvedMerge()

      expect(hasRef('MERGE_HEAD')).toBe(true)

      // 断られない（競合が残っていれば断られる ── 下の確かめと対になる）。
      git('stash', 'push', '--quiet')

      expect(hasRef('MERGE_HEAD')).toBe(false)
    }
  )

  it(
    '競合が残っている間は、素の git が stash push を断る',
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      startConflictedMerge()

      expect(() => git('stash', 'push', '--quiet')).toThrow()
      expect(hasRef('MERGE_HEAD')).toBe(true)
    }
  )

  /*
    **切り替えは、git が最後まで断る**（実測で分かったこと）。

    3-8-22A の設計を書いた時点では「解決し終えていれば `switch` も通って
    しまう」と見ていたが、git 2.54 は解決後でも
    `fatal: cannot switch branch while merging` で断る ── 退避（上）とは
    振る舞いが違う。

    **それでもアプリは手前で断つ。** 理由は3つあり、どれも
    「git が断るなら任せてよい」には落ちない。

      - git の断り方は状態ごとにばらばらで、`operation-in-progress` という
        1つの理由には集約されない（3-8-1 からの「生の stderr を渡さない」）
      - 押せてしまうボタンが1つ残る ── 押した先で必ず失敗するボタンは、
        3-8-2 からの「押しても何も起きない操作を置かない」に反する
      - **git の版に依存する。** この振る舞いは git が決めていて、
        アプリの側で確かめずに寄りかかると、版が変わった日に黙って穴が開く

    確かめておくのは、**アプリの断りが git より手前で効いていること**の
    裏付けになる（下の「マージの途中の禁止」で、応答が
    `operation-in-progress` であることを見ている ── git の文言ではない）。
  */
  it(
    '解決し終えたマージでも、素の git は switch を断る（退避とはここが違う）',
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      startResolvedMerge()

      expect(() => git('switch', '--quiet', 'feat')).toThrow()
      expect(hasRef('MERGE_HEAD')).toBe(true)
    }
  )
})

describeWithGit('マージの途中の禁止', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /*
    アプリは、git が通してしまう状態でも断る ── 断り方は
    `operation-in-progress` で、git を1回も動かさない
    （main/git/gitOperationResult.ts の `guardGitInProgress`）。
  */
  it('切り替えを断り、MERGE_HEAD はそのまま残る', async () => {
    startResolvedMerge()

    const result = await applyGitSwitchBranch('feat')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
    expect(hasRef('MERGE_HEAD')).toBe(true)
    // 応答に載る状態も「まだマージの途中」のままになる。
    expect(readyOf(result.repository).inProgress).toBe('merge')
  })

  it('ブランチの作成も断る（作って切り替えるため）', async () => {
    startResolvedMerge()

    const result = await applyGitCreateBranch('new-branch', null)

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
    // ref が作られていないことまで測る（断りの文だけでは何も言えない）。
    expect(hasRef('refs/heads/new-branch')).toBe(false)
  })

  it('退避を断り、退避は1件も作られない', async () => {
    startResolvedMerge()

    const result = await applyGitStashPush()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
    expect(hasRef('MERGE_HEAD')).toBe(true)
    expect(git('stash', 'list').trim()).toBe('')
  })

  it('Pull も断る（取り込む先が定まらない）', async () => {
    startResolvedMerge()

    const result = await applyGitPull()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
  })

  /*
    **通す側**。ここを止めると、利用者はマージから出られなくなる
    （中止しか道が無くなる）── shared/git/inProgress.ts の表がマージだけを
    例外にしている理由がこれになる。
  */
  it('Stage と Commit は通り、マージが完結する', async () => {
    startConflictedMerge()

    // 解決 → Stage → Commit の順に、3-8-18 / 3-8-3 / 3-8-4 の経路をそのまま通す。
    write('f.txt', 'line1\nRESOLVED\nline3\n')

    expect((await applyGitResolveConflict('f.txt')).outcome).toEqual({ status: 'applied' })

    write('g.txt', 'extra\n')
    expect((await applyGitStage({ kind: 'file', relativePath: 'g.txt' })).outcome).toEqual({
      status: 'applied'
    })

    const committed = await applyGitCommit('merge feat into main')

    expect(committed.outcome).toEqual({ status: 'applied' })
    expect(hasRef('MERGE_HEAD')).toBe(false)
    expect(readyOf(committed.repository).inProgress).toBeNull()
    // 親が2つ ＝ マージ commit として記録されている。
    expect(git('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/)).toHaveLength(3)
  })

  /*
    fetch はマージの途中でも通す ── 動くのは remote-tracking ref だけで、
    index にも作業ツリーにも HEAD にも触らない。remote が1つも無いので
    取ってくるものは無いが、**断られないこと**がここで確かめたいことになる。
  */
  it('fetch は通す（MERGE_HEAD に触らない）', async () => {
    startResolvedMerge()

    const result = await applyGitFetch()

    expect(result.outcome).not.toEqual({ status: 'failed', reason: 'operation-in-progress' })
    expect(hasRef('MERGE_HEAD')).toBe(true)
  })
})

describeWithGit('rebase の途中の禁止', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /*
    マージと違い、**書き込みを1つも通さない** ── アプリは rebase を始められず、
    終わらせる口（`--continue` / `--abort`）も持たない。出口が無いのに
    Stage や Commit だけを通すと、終わらない道の途中まで案内することになる。
  */
  it('Stage を断る', async () => {
    startConflictedRebase()
    write('h.txt', 'x\n')

    const result = await applyGitStage({ kind: 'file', relativePath: 'h.txt' })

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
  })

  it('Commit を断る（detached HEAD に commit を積ませない）', async () => {
    startConflictedRebase()

    const before = git('rev-parse', 'HEAD').trim()
    const result = await applyGitCommit('should not happen')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
    // HEAD が1mm も動いていないことまで測る。
    expect(git('rev-parse', 'HEAD').trim()).toBe(before)
  })

  it('競合の解決も断る（解決しても続きがアプリに無い）', async () => {
    startConflictedRebase()
    write('f.txt', 'line1\nRESOLVED\nline3\n')

    const result = await applyGitResolveConflict('f.txt')

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
  })

  it('fetch も断る（マージとはここが違う）', async () => {
    startConflictedRebase()

    const result = await applyGitFetch()

    expect(result.outcome).toEqual({ status: 'failed', reason: 'operation-in-progress' })
  })

  it('rebase を終えれば、また通るようになる', async () => {
    startConflictedRebase()
    write('f.txt', 'line1\nRESOLVED\nline3\n')
    git('add', '--', 'f.txt')

    /*
      `rebase --continue` は commit メッセージのエディタを開く ── テストの
      中では開く相手が居ないので、何もしないエディタを指しておく
      （`true` は 0 で終わるだけのコマンド）。**アプリはこの経路を持たない**
      ので、ここは「端末で終わらせた」を再現しているだけになる。
    */
    gitAllowingFailure('-c', 'core.editor=true', 'rebase', '--continue')

    expect(await currentInProgress()).toBeNull()

    write('h.txt', 'x\n')

    expect((await applyGitStage({ kind: 'file', relativePath: 'h.txt' })).outcome).toEqual({
      status: 'applied'
    })
  })
})

describeWithGit('マージ commit の既定メッセージ', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /*
    3-8-20 が残していた「白紙の Commit 欄」を埋める（Session 3-8-22A）。
    読むのは git が指した場所で、`.git/MERGE_MSG` と決め打ちしない
    （main/git/gitMergeMessage.ts）。
  */
  it('競合したマージでは、`Merge branch` の既定メッセージが読める', async () => {
    startConflictedMerge()

    const outcome = await describeGitMergeMessage()

    expect(outcome.message).toContain("Merge branch 'feat'")
  })

  /*
    **コメント行が落ちている**ことがここでいちばん効く ── アプリの Commit は
    `--cleanup=whitespace` 固定で、git はコメントを落とさない（3-8-4）。
    落とさずに欄へ出すと、`# Conflicts:` の行がそのまま履歴に入る。
  */
  it('git が書いたコメント行（`# Conflicts:`）は落ちている', async () => {
    startConflictedMerge()

    // 生のファイルにはコメント行が在る（落としているのがアプリだと分かる形）。
    const rawPath = join(root, git('rev-parse', '--git-path', 'MERGE_MSG').trim())

    expect(existsSync(rawPath)).toBe(true)

    const outcome = await describeGitMergeMessage()

    expect(outcome.message).not.toContain('#')
    expect(outcome.message).not.toContain('Conflicts')
  })

  /*
    マージの途中でなければ null ── 「在るかどうか」ではなく状態で決めている
    （main/git/gitMergeMessage.ts）。
  */
  it('マージの途中でなければ null', async () => {
    createDivergedBranches()

    expect((await describeGitMergeMessage()).message).toBeNull()
  })

  it('Commit してマージが終われば null に戻る', async () => {
    startResolvedMerge()

    expect((await describeGitMergeMessage()).message).not.toBeNull()

    expect((await applyGitCommit('merged')).outcome).toEqual({ status: 'applied' })

    expect((await describeGitMergeMessage()).message).toBeNull()
  })
})
