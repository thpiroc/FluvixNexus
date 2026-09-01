import type {
  GitOperationFailureReason,
  GitOperationOutcome,
  GitRepositoryState,
  GitStashListing
} from '@shared/git'
import { GIT_STASH_LIMIT } from '@shared/git'
import { createLogger } from '../logger'
import {
  dropStashEntry,
  listStashEntries,
  popStashEntry,
  pushStashEntry,
  showStashObject,
  type GitCommand
} from './gitCommands'
import {
  classifyGitStashDropFailure,
  classifyGitStashPopFailure,
  classifyGitStashPushFailure,
  summarizeGitStderr
} from './gitFailure'
import {
  finishGitOperation,
  guardGitInProgress,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { readStashEntries, readStashPopConflict } from './gitOutput'
import { runGitExclusively } from './gitQueue'
import { hasGitHeadCommit, readGitRepositoryOutcome } from './gitRepository'
import { GIT_CHECKOUT_TIMEOUT_MS, runGit } from './runGit'

/**
 * 退避（stash）の一覧 / 退避 / 戻す / 捨てる（Session 3-8-15）。
 *
 * 部品の分担はブランチ（gitBranches.ts）・履歴（gitHistory.ts）とまったく同じで、
 * ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   出力の読み … gitOutput.ts（純粋・テスト対象）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit / Push と共有）
 *
 * ## ここが埋めるのは、3-8-5 / 3-8-6 が開けたままにしていた穴になる
 *
 * `local-changes-blocked` の文言は 3-8-5 の時点から
 * 「**Commit するか退避してから**お試しください」と書いていた
 * （renderer/src/git/gitChanges.ts）。Pull もブランチの切り替えも、
 * 書きかけがあると git が断る ── アプリはその判断を上書きしない、というのが
 * 3-8-6 の「自動 stash を渡さない」の中身だった（§14.14）。
 *
 * 3-8-15 で足すのは**自動ではない退避**で、その判断は1つも動かない ──
 * 押すのは利用者で、押した内容は一覧に残り、その場で戻せる。
 * 「git の判断を黙って上書きする」ことと「利用者が明示的に避ける」ことは
 * 別のものになる。
 *
 * ## 3種類の git が動く（3-8-14 で2種類になった続き）
 *
 *   `stash list` … 読み取り。何も書き換えない（`listGitStashes`）
 *   `stash push` / `stash pop` … **作業ツリーをまるごと書き換える**
 *   `stash drop` … reflog の1件を消すだけ（作業ツリーに触らない）
 *
 * 待ち時間の上限がそこで分かれるのは 3-8-14 と同じ形になる
 * （`runStashWorktreeCommand` / `runStashRefCommand`）。
 *
 * ## 番号を信じない、という1点だけが新しい
 *
 * ブランチは名前で、commit は hash で指せた ── どちらも**指した先が
 * ひとりでに変わらない。** 退避を指す `stash@{N}` は上から数えた位置で、
 * 退避を1つ作れば全部が1つずつ後ろへずれる（実物で確かめてある。
 * gitStashRepository.test.ts）。
 *
 * したがって pop / drop では、git を動かす前に**その位置を解いて、
 * 一覧の行が持っていた hash と突き合わせる**（`resolveStashEntry`）。
 * 3-8-14 が `--force` を立てる前に「相手は自分自身か」を確かめたのと
 * 同じ構えで、**戻せない操作の直前にもう一度だけ確かめる**ことになる。
 */

const log = createLogger('git')

/** Git 操作を始められる状態（この層が扱うのはこれだけ）。 */
type ReadyRepository = Extract<GitRepositoryState, { status: 'ready' }>

/* ------------------------------------------------------------------------ 一覧 */

/** 一覧の問い合わせの答え（IPC の応答がそのまま持つ形）。 */
export interface GitStashListingOutcome {
  readonly workspaceId: string | null
  readonly listing: GitStashListing
}

/**
 * 退避を一覧する。
 *
 * ## 順番待ちを通す
 *
 * 読み取りだけだが、枠を取る（`listGitBranches` / `listGitCommits` と同じ理由）──
 * 退避の最中に読むと、**どちらでもない一瞬**の写しが返りうる。しかもここでは
 * その写しに**番号**が載っている（shared/git/stash.ts）ため、ずれた一覧は
 * そのまま押し間違いになる。
 *
 * ## 先に「操作してよい状態か」を確かめる
 *
 * `stash list` は Workspace root がリポジトリ root でなくても答えるが、
 * その手前で止める ── 一覧を出すということは**戻す／捨てる相手を選ばせる**
 * ことで、Git 操作を行わないと決めた状態（`nested` など。設計判断 10）で
 * 選ばせる形にはできない。確かめ方は他の操作と同じ `readGitRepositoryOutcome`
 * にしてある。
 */
export async function listGitStashes(): Promise<GitStashListingOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return { workspaceId: before.workspaceId, listing: { status: 'not-ready' } as const }
    }

    return { workspaceId: before.workspaceId, listing: await readStashListing() }
  })
}

/**
 * `stash list` を1回動かして、一覧として読む。
 *
 * **読めなかったことを失敗の分類に落とさない**（`failed` の1種類だけ）──
 * 一覧が出せないときに利用者が取れる手は「開き直す」しか無く、理由で
 * 次の一手が変わらないため（分類の粒度の基準は gitFailure.ts）。
 *
 * 履歴（`listGitCommits`）と違い、**HEAD の有無を先に確かめる必要が無い** ──
 * `stash list` は commit が1つも無いリポジトリでも 0 で終わり、空を返す
 * （実物で確かめてある）。空はそのまま「1件も退避していない」という
 * 正しい答えになる。
 */
async function readStashListing(): Promise<GitStashListing> {
  const outcome = await runGit(listStashEntries(GIT_STASH_LIMIT))

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      // 問い合わせている間に閉じられた／git が消えた。次に開いたときは案内が出る。
      return { status: 'not-ready' }

    case 'failed':
      return { status: 'failed' }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    log.info(`git stash list exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`)
    return { status: 'failed' }
  }

  const reading = readStashEntries(outcome.stdout, GIT_STASH_LIMIT)

  return { status: 'ready', entries: reading.entries, truncated: reading.truncated }
}

/* ------------------------------------------------------------------------ 退避 */

/**
 * 作業ツリーと index の変更を退避する。
 *
 * ## 動かす前に分かることを、先に分ける
 *
 * `findStashPushBlockingState` が見る2つは、どちらも読んだ状態だけで決まる
 * （切り替えで `nothing-to-do` と `unresolved-conflicts` を先に分けたのと
 * 同じ形。§14.14）。とくに1つめは**そうしなければ答えが出せない** ──
 * `git stash push` は退避するものが無くても
 * `No local changes to save` と言って**0 で終わる**ため、終了コードからは
 * 「押したのに何も起きなかった」を知りようが無い（実物で確かめてある）。
 *
 * ## commit が1つも無いリポジトリ
 *
 * `git stash` は最初の commit の**上に**中身を積むため、HEAD の指す先が
 * 無いと動かない。履歴（gitHistory.ts）と同じ `hasGitHeadCommit` で分ける ──
 * 同じ問いに対して別の判定を新しく置かない。
 *
 * 分からなかった場合（null）は**そのまま動かす** ── 履歴が `failed` に
 * 倒したのは「空の履歴として出すと嘘になる」ためだったが、こちらは
 * 動かせば git が答えを出す（`no-commit` として分類される。gitFailure.ts）。
 * 分からないことを理由に、通るはずの退避を止めない。
 */
export async function applyGitStashPush(): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    /*
      途中の操作があるあいだは退避しない（Session 3-8-22A）。競合が残っている
      間は git も断るが、解決し終えたマージでは**通ってしまう** ── index ごと
      退避されて MERGE_HEAD が落ちる（shared/git/inProgress.ts）。
    */
    const guarded = guardGitInProgress(before, 'stash-push')

    if (guarded !== null) {
      return guarded
    }

    const blocked = findStashPushBlockingState(before.repository)

    if (blocked !== null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: blocked })
    }

    if ((await hasGitHeadCommit()) === false) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'no-commit'
      })
    }

    const outcome = await runStashWorktreeCommand(pushStashEntry(), classifyGitStashPushFailure)

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/**
 * 読んだ状態だけで分かる「退避できない理由」。無ければ null。
 *
 * ## 未追跡は数えない
 *
 * `-u` を渡していない（gitCommands.ts）ので、未追跡のファイルは退避の対象に
 * ならない ── したがって「未追跡だけがある」状態は、git にとって
 * **何も無いのと同じ**になる。ここで数えてしまうと、押しても
 * `No local changes to save` で 0 が返り、「退避しました」と出したうえで
 * 一覧に何も増えないことになる。
 *
 * ## 競合が残っている間は動かさない
 *
 * merge の途中で `git stash push` を動かすと `error: could not write index` で
 * 断られる（実物で確かめてある）── その文言は分類の役に立たないうえ、
 * 押す前に分かることにあたる。切り替え（§14.14）と Pull が同じ判断を
 * している。
 */
function findStashPushBlockingState(repository: ReadyRepository): GitOperationFailureReason | null {
  if (repository.changes.conflicted.length > 0) {
    return 'unresolved-conflicts'
  }

  if (repository.changes.staged.length === 0 && repository.changes.unstaged.length === 0) {
    return 'nothing-to-do'
  }

  return null
}

/* ------------------------------------------------------------------ 戻す / 捨てる */

/**
 * 指した退避を作業ツリーへ戻し、一覧から取り除く。
 *
 * ## 競合は「失敗」ではなく「途中まで通った」になる
 *
 * `pop` は merge なので、中身が作業ツリーへ**書き込まれたうえで**競合しうる。
 * そのとき git は退避を捨てず、終了コードだけが 1 になる ── これを
 * `failed` に丸めると、利用者は「何も起きなかった」と読んで押し直し、
 * 今度は「作業ツリーの変更が上書きされる」として断られる
 * （shared/git/operation.ts の `stash-apply`）。
 *
 * 見分けるのは stdout になる（`readStashPopConflict`）。**stderr の分類を
 * 先に見て、当たらなかったときだけ** stdout を見るのは、上書きで
 * 何も起きなかった場合にも `The stash entry is kept ...` が stdout に
 * 出るため ── そちらは stderr に理由が出るので、順番でほどける。
 */
export async function applyGitStashPop(
  index: number,
  shortHash: string
): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    // 退避すると同じ線（Session 3-8-22A）── 戻すのも index を入れ替える側になる。
    const guarded = guardGitInProgress(before, 'stash-pop')

    if (guarded !== null) {
      return guarded
    }

    /*
      競合が残っている間は動かさない（退避と同じ判断）── merge の途中に
      別の merge を重ねることになり、git も断る。
    */
    if (before.repository.changes.conflicted.length > 0) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'unresolved-conflicts'
      })
    }

    if (!(await resolveStashEntry(index, shortHash))) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'stash-not-found'
      })
    }

    return await finishGitOperation(before.workspaceId, await runStashPop(index))
  })
}

/**
 * 指した退避を捨てる。
 *
 * 作業ツリーには1文字も触らないため、待ち時間の上限は既定のまま
 * （`runStashRefCommand`）── 3-8-14 で削除と rename を `git branch` の側へ
 * 分けたのとまったく同じ切り分けになる。
 *
 * **確認はここに無い。** 尋ねるのは面の側で（GitStashOverlay.tsx）、
 * ここへ来るのは既に尋ね終えたものになる ── 破棄（§14.16）・ブランチの
 * 削除（§14.22）と同じ分担にしてある。
 */
export async function applyGitStashDrop(
  index: number,
  shortHash: string
): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    /*
      捨てるのはマージの途中でも通す（作業ツリーにも index にも触らない）。
      rebase / cherry-pick / revert では止める（shared/git/inProgress.ts）。
    */
    const guarded = guardGitInProgress(before, 'stash-drop')

    if (guarded !== null) {
      return guarded
    }

    if (!(await resolveStashEntry(index, shortHash))) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'stash-not-found'
      })
    }

    const outcome = await runStashRefCommand(dropStashEntry(index), classifyGitStashDropFailure)

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/**
 * その位置に居るのが、画面に出ていたあの退避かどうか。
 *
 * ## なぜ確かめるのか
 *
 * `stash@{N}` は名前ではなく**上から数えた位置**で、一覧を出してから押すまでの
 * 間に端末で `git stash` を1回打たれると、全部が1つずつ後ろへずれる
 * （shared/git/stash.ts）── そのまま drop すると、**押した人が見ていない
 * 退避が消える。** それは戻せない。
 *
 * ## 完全な hash に、短い hash を前方一致で当てる
 *
 * 短縮の桁数はリポジトリの大きさで変わるため、短い形どうしを等しさで比べると
 * 「変わっていないものを変わった」と読みうる（gitCommands.ts の
 * `showStashObject`）。前方一致は、短い hash の意味（先頭何桁か）そのものになる。
 *
 * 一覧が返す `shortHash` は 16進の形を確かめてある（gitOutput.ts）ので、
 * ここで比べる2つはどちらも 16進の文字列になる ── 大文字小文字だけを揃える。
 *
 * ## 確かめられなかったときは false に倒す
 *
 * git が動かなかった・非0で終わった・hash が読めなかった、はどれも
 * 「そこに在ると言い切れない」にあたる。倒しておけば、最悪でも
 * 「一覧を開き直してください」で済む ── 3-8-14 の
 * `needsForceForCaseOnlyRename` とまったく同じ倒し方になる。
 */
async function resolveStashEntry(index: number, shortHash: string): Promise<boolean> {
  const outcome = await runGit(showStashObject(index))

  if (outcome.status !== 'completed' || outcome.exitCode !== 0) {
    return false
  }

  const resolved = outcome.stdout.trim().toLowerCase()

  return /^[0-9a-f]{40,64}$/.test(resolved) && resolved.startsWith(shortHash.toLowerCase())
}

/* ------------------------------------------------------------------------ 共通 */

/**
 * `git stash pop` を1回動かして、結末に翻訳する。
 *
 * ## この1本だけ、stdout が分類に関わる
 *
 * 他のどの操作でも、終了コードが非0のときに読むのは stderr だけだった
 * （生の stderr は境界を越えず、分類だけが渡る。§14.6）。pop が例外なのは、
 * **merge の結果が失敗ではないので stdout に出る**ためになる。
 *
 * 順番は「stderr の分類 → 当たらなければ stdout」で、どちらも当たらなければ
 * stderr の分類（`unknown`）がそのまま結末になる。
 */
async function runStashPop(index: number): Promise<GitOperationOutcome> {
  const command = popStashEntry(index)
  const outcome = await runGit(command, { timeoutMs: GIT_CHECKOUT_TIMEOUT_MS })

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'failed', reason: 'not-ready' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown' }

    case 'completed':
      break
  }

  if (outcome.exitCode === 0) {
    return { status: 'applied' }
  }

  const reason = classifyGitStashPopFailure(outcome.stderr)

  /*
    stdout は分類には使わない、という 3-8-1 からの線をここでだけ緩める。
    緩めてよいのは、見ているのが「失敗の説明」ではなく**merge の結果**
    だからになる（main/git/gitOutput.ts の `readStashPopConflict`）。
  */
  if (reason === 'unknown' && readStashPopConflict(outcome.stdout)) {
    log.info(`git stash pop conflicted: ${summarizeGitStderr(outcome.stdout)}`)

    return { status: 'partly-applied', completed: 'stash-apply', reason: 'unresolved-conflicts' }
  }

  logTrailingStdout(command, outcome.stdout)

  return { status: 'failed', reason }
}

/**
 * `stash push` / `stash pop` を1回動かして、結末に翻訳する。
 *
 * 待ち時間の上限が長いのは、ここで**作業ツリーが実際に書き換わる**ため
 * （切り替えと同じ `GIT_CHECKOUT_TIMEOUT_MS`）── ファイル数もウイルス対策
 * ソフトもネットワークドライブも効いてくる。
 */
async function runStashWorktreeCommand(
  command: GitCommand,
  classify: (stderr: string) => GitOperationFailureReason
): Promise<GitOperationOutcome> {
  return await runStashCommand(command, classify, GIT_CHECKOUT_TIMEOUT_MS)
}

/**
 * `stash drop` を1回動かして、結末に翻訳する。
 *
 * 待ち時間の上限が既定のままなのは、書き換えるのが reflog の1件だけで、
 * 作業ツリーに1文字も触らないため ── 3-8-14 が `runBranchRefCommand` を
 * 分けたのとまったく同じ切り分けになる（即答するはずの操作に2分を掛けると、
 * 本当に返ってこなくなった場合の逃げ道がその分だけ遠くなる）。
 */
async function runStashRefCommand(
  command: GitCommand,
  classify: (stderr: string) => GitOperationFailureReason
): Promise<GitOperationOutcome> {
  return await runStashCommand(command, classify, undefined)
}

/**
 * 1回動かして結末に翻訳する共通部分。
 *
 * 分類の関数は必ず呼ぶ側が渡す（3-8-14 の `runBranchRefCommand` と同じ）──
 * 退避と捨てるでは起こりうることが重ならず、既定を1つ決めると
 * 「渡し忘れた側が、起こりえない分類を返す」形が残る。
 */
async function runStashCommand(
  command: GitCommand,
  classify: (stderr: string) => GitOperationFailureReason,
  timeoutMs: number | undefined
): Promise<GitOperationOutcome> {
  const outcome = await runGit(command, timeoutMs === undefined ? undefined : { timeoutMs })

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'failed', reason: 'not-ready' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown' }

    case 'completed':
      break
  }

  logTrailingStdout(command, outcome.stdout)

  return outcome.exitCode === 0
    ? { status: 'applied' }
    : { status: 'failed', reason: classify(outcome.stderr) }
}

/**
 * stdout に残った1行をログへ落とす。
 *
 * 捨てたときの `Dropped stash@{0} (<完全な hash>)` は stdout に出る ──
 * **捨てた中身がどの commit だったか**は、後から `git fsck --unreachable` で
 * 拾い直す前の唯一の手掛かりになる（3-8-14 が削除の `Deleted branch x (was …)` を
 * 残したのと同じ理由）。Renderer へは渡さない（分類だけが境界を越える）。
 */
function logTrailingStdout(command: GitCommand, stdout: string): void {
  const trailing = stdout.trim()

  if (trailing.length > 0) {
    log.info(`git ${command.label}: ${summarizeGitStderr(trailing)}`)
  }
}
