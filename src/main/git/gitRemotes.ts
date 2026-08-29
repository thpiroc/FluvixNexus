import type { GitOperationFailureReason, GitOperationOutcome, GitRemoteListing } from '@shared/git'
import { GIT_REMOTE_LIMIT } from '@shared/git'
import { createLogger } from '../logger'
import {
  addRemote,
  listRemoteUrls,
  removeRemote,
  renameRemote,
  setRemoteUrl,
  type GitCommand
} from './gitCommands'
import {
  classifyGitAddRemoteFailure,
  classifyGitRemoveRemoteFailure,
  classifyGitRenameRemoteFailure,
  classifyGitSetRemoteUrlFailure,
  summarizeGitStderr
} from './gitFailure'
import {
  finishGitOperation,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { readRemoteEntries } from './gitOutput'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * remote の一覧 / 追加 / 削除（Session 3-8-16）と、
 * URL の変更 / rename（Session 3-8-17）。
 *
 * 部品の分担はブランチ（gitBranches.ts）・退避（gitStash.ts）とまったく同じで、
 * ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   値の検証   … shared/git/remoteName.ts / remoteUrl.ts（純粋・Renderer と共有）
 *   ラベル     … gitRemoteLabel.ts（純粋・**Main だけが持つ**）
 *   出力の読み … gitOutput.ts（純粋・テスト対象）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit / Push と共有）
 *
 * ## 3-8-5 から引いていた「remote を指せる欄を作らない」を、初めて緩める
 *
 * ただし**緩めたのは1箇所だけ**になる。
 *
 *   足す / 消す … 名前で指せる（このファイル）
 *   送る / 受ける … 今も指せない。`git:push` / `git:pull` の要求は `void` のまま
 *
 * つまり増えたのは**登録簿を編集する口**で、「どこへ送るか」を選ぶ口ではない ──
 * 送り先を決めるのは今もリポジトリの設定（`branch.<名前>.remote` / upstream）で、
 * それを読むのは Main になる（main/git/gitSync.ts）。この線を保つ限り、
 * 「画面に出ているブランチとは別のものへ送れる欄」は生まれない。
 *
 * ## 動く git は2種類で、どちらもネットワークへ出ない
 *
 *   `remote --verbose` … 読み取り。何も書き換えない（`listGitRemotes`）
 *   `remote add` / `set-url` / `rename` / `remove`
 *                      … `.git/config` と `refs/remotes/` を書き換える
 *
 * 3-8-14 / 3-8-15 では待ち時間の上限がコマンドの性質で分かれたが、
 * ここでは**5つとも既定のまま**になる ── 作業ツリーに触らず、ネットワークにも
 * 出ないため、`GIT_CHECKOUT_TIMEOUT_MS` も `GIT_NETWORK_TIMEOUT_MS` も要らない。
 * 即答するはずの操作に長い上限を掛けると、本当に返ってこなくなった場合の
 * 逃げ道がその分だけ遠くなる（gitBranches.ts の `runBranchRefCommand` と同じ判断）。
 *
 * ## 「押す前に分かること」は、3-8-17 で1つだけ増えた
 *
 * 3-8-14 の削除は「今そこに居るブランチか」を、3-8-15 の pop / drop は
 * 「番号がずれていないか」を、git を動かす前に確かめていた。3-8-16 の
 * 3つ（一覧 / 追加 / 削除）には、それに当たるものが1つも無かった。
 *
 *   同じ名前があるか   … 手元の設定を見ないと分からない（git が答える）
 *   その remote があるか … 同上
 *   追っているブランチがあるか … **見るが、止めはしない**（下記）
 *   **大文字小文字だけの rename か** … **渡された2つの文字列だけで決まる**（3-8-17）
 *
 * 3つめが 3-8-14 との違いになる ── 追跡先が消えることは削除を
 * 止める理由ではなく、**押す前に伝えるべきこと**にあたる（確認の文言として
 * 出す。renderer/src/git/gitRemotes.ts）。git を動かす前に断ると、
 * 「消したいのに消せない remote」が生まれる。
 *
 * 4つめ（3-8-17）だけは逆で、**git を動かすと壊れる**ため手前で断つ ──
 * git が途中まで適用したまま落ちる唯一の経路にあたる
 * （`applyGitRenameRemote`）。
 *
 * ## 3-8-17 で増えたのも、やはり「登録簿を編集する口」だけ
 *
 * URL の変更も rename も、**送り先を選ぶ口ではない** ── 変えるのは
 * 登録簿に書いてある値そのもので、`git:push` / `git:pull` の要求は
 * 今も `void` のままになる。3-8-5 の判断は 3-8-17 でも撤回していない。
 *
 * ## 一覧に「今どれが使われているか」を出さない
 *
 * 出せはする（`branch.<名前>.remote` を読めばよい）が、出さない ──
 * 出すと、その隣に「これを使う」を置きたくなる（shared/git/remote.ts）。
 * この層が読むのは remote の名前と URL だけで、branch の設定は見ない。
 */

const log = createLogger('git')

/* ------------------------------------------------------------------------ 一覧 */

/** 一覧の問い合わせの答え（IPC の応答がそのまま持つ形）。 */
export interface GitRemoteListingOutcome {
  readonly workspaceId: string | null
  readonly listing: GitRemoteListing
}

/**
 * remote を一覧する。
 *
 * ## 順番待ちを通す
 *
 * 読み取りだけだが、枠を取る（`listGitBranches` / `listGitStashes` と同じ理由）──
 * 追加 / 削除の最中に読むと、**どちらでもない一瞬**の写しが返りうる。
 *
 * ## 先に「操作してよい状態か」を確かめる
 *
 * `git remote --verbose` は Workspace root がリポジトリ root でなくても答えるが、
 * その手前で止める ── 一覧を出すということは**消す相手を選ばせる**ことで、
 * Git 操作を行わないと決めた状態（`nested` など。設計判断 10）で選ばせる
 * 形にはできない。確かめ方は他の操作と同じ `readGitRepositoryOutcome` にしてある。
 */
export async function listGitRemotes(): Promise<GitRemoteListingOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return { workspaceId: before.workspaceId, listing: { status: 'not-ready' } as const }
    }

    return { workspaceId: before.workspaceId, listing: await readRemoteListing() }
  })
}

/**
 * `remote --verbose` を1回動かして、一覧として読む。
 *
 * **読めなかったことを失敗の分類に落とさない**（`failed` の1種類だけ）──
 * ブランチ・退避の一覧と同じで、一覧が出せないときに利用者が取れる手は
 * 「開き直す」しか無く、理由で次の一手が変わらないため。
 */
async function readRemoteListing(): Promise<GitRemoteListing> {
  const outcome = await runGit(listRemoteUrls())

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
    log.info(
      `git remote --verbose exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`
    )
    return { status: 'failed' }
  }

  const reading = readRemoteEntries(outcome.stdout, GIT_REMOTE_LIMIT)

  /*
    0件は失敗ではない ── `git remote --verbose` は remote が1つも無くても
    0 で終わって何も出さない（実物で確かめてある）。空はそのまま
    「まだ1つも登録していない」という正しい答えになる（退避と同じ側）。
  */
  return { status: 'ready', remotes: reading.remotes, truncated: reading.truncated }
}

/* ------------------------------------------------------------------------ 追加 */

/**
 * remote を1つ追加する。
 *
 * `name` と `url` は検証済み（ハンドラが `normalizeGitRemoteName` /
 * `normalizeGitRemoteUrl` を通している）。ここへ来るのは**そのまま引数として
 * 渡せる形**の文字列だけになる。
 *
 * ## 事前に確かめることが1つも無い
 *
 * 3-8-6 の「ブランチの作成」とまったく同じ形になる ── 手元の状態から分かる
 * 「追加できない理由」が無い。
 *
 *   同じ名前がある … 手元の設定を見ないと分からない（git が `remote-exists` を返す）
 *   届かない URL   … ネットワークへ出ないので、この1回では分からない（出さない）
 *   commit が無い  … 関係が無い。remote は commit より先に登録できる
 *
 * 形だけは手前（IPC ハンドラ）で確かめてある ── そこは「利用者が打った
 * 文字列」であって、リポジトリの状態ではない。
 */
export async function applyGitAddRemote(name: string, url: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const outcome = await runRemoteCommand(addRemote(name, url), classifyGitAddRemoteFailure)

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/* -------------------------------------------------------- URL の変更（3-8-17） */

/**
 * remote の URL を差し替える（Session 3-8-17）。
 *
 * `name` と `url` は検証済み（ハンドラが `normalizeGitRemoteName` /
 * `normalizeGitRemoteUrl` を通している ── **追加とまったく同じ2つの関数**に
 * なる）。
 *
 * ## 追加と同じく、事前に確かめることが1つも無い
 *
 *   その remote があるか … 手元の設定を見ないと分からない（git が
 *                          `remote-not-found` を返す）
 *   届く URL か         … ネットワークへ出ないので、この1回では分からない
 *   今と同じ URL か     … **確かめない**（下記）
 *
 * ## 同じ URL を渡されても `nothing-to-do` にしない
 *
 * 3-8-6 の「今のブランチを選んだ」は Renderer が持っている値で判定できたが、
 * ここは違う ── 一覧に載るのはラベルだけで、**Renderer は今の URL を
 * 持っていない**（shared/git/remote.ts）。Main で判定するには
 * `git remote get-url` を1回増やすことになり、得られるのは文言だけになる。
 *
 * 変わらない値で上書きしても、壊れるものも失われるものも無い ──
 * そのまま git へ渡して成功として返す。「押したのに何も起きない」を
 * 避けるために git を1本増やす釣り合いが取れていない。
 *
 * ## 消える ref は1つも無い
 *
 * 変わるのは `remote.<名前>.url` の1行だけで、refspec も
 * `refs/remotes/<名前>/*` も `branch.*.remote` も動かない（実物で
 * 確かめてある。gitRemoteRepository.test.ts）── つまり**削除とは正反対**で、
 * 失われるものが1つも無い代わりに、前の送り先から取ってきた
 * remote-tracking ref がそのまま残る。
 *
 * それを消しに行くことはしない（`--prune` を渡さない）── ref を消す操作が
 * ここに混ざると、削除との境目が消える。残った ref は次の Pull で揃い、
 * それまでの間 `↑2 ↓1` が前の相手と比べた数であることは、
 * **押す前の確認で伝える**（renderer/src/git/gitRemotes.ts）。
 */
export async function applyGitSetRemoteUrl(name: string, url: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const outcome = await runRemoteCommand(setRemoteUrl(name, url), classifyGitSetRemoteUrlFailure)

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/* ---------------------------------------------------------- rename（3-8-17） */

/**
 * remote の名前を変える（Session 3-8-17）。
 *
 * `name` と `newName` はどちらも検証済み（ハンドラが**同じ**
 * `normalizeGitRemoteName` を通している）── 入口を分けると「元の名前と
 * しては通るが、新しい名前としては通らない」形が生まれる（3-8-14 と同じ）。
 *
 * ## 失われるものが1つも無い ── だから確認を挟まない
 *
 * `git remote rename` は必要なものを全部追随させる（実物で確かめてある。
 * gitRemoteRepository.test.ts）。
 *
 *   `remote.<新名>.url` / `.fetch`  … 設定ごと移り、refspec の行き先も変わる
 *   `refs/remotes/<新名>/*`         … remote-tracking ref も改名される
 *   `branch.*.remote`               … 追っていたブランチの追跡先も追随する
 *   `remote.pushDefault`            … 指していれば、それも追随する
 *
 * したがって画面の `↑2 ↓1` は消えず、rename の後の Push もそのまま通る ──
 * 削除（`applyGitRemoveRemote`）とはそこが決定的に違う。3-8-14 で
 * ブランチの rename に確認を置かなかったのとまったく同じ判断になる。
 *
 * **remove + add で代用しない。** 結果だけ見れば同じに見えるが、あちらは
 * 追跡先を失う。しかも2段のうち後半が失敗すると、remote が1つも無い
 * リポジトリが残る ── アプリが途中で止まりうる手順を組み立てない
 * （3-8-10 の `git init` と同じ線）。
 *
 * ## 押す前に分かる「絶対に通らない理由」が、remote で初めて1つできる
 *
 * 3-8-16 の追加 / 削除には1つも無かった（同じ名前があるかも、その remote が
 * 在るかも、手元の設定を見ないと分からない）。rename には**渡された2つの
 * 文字列だけで決まる**ものが1つある ── 大文字小文字だけの違いになる。
 *
 * Windows では `refs/remotes/origin/…` と `refs/remotes/Origin/…` が
 * 同じファイルになるため、git は `cannot lock ref` で落ちる ── しかも
 * **途中まで適用したまま**止まり、`remote.<新名>.url` だけが書かれて
 * refspec も remote-tracking ref も `branch.*.remote` も古い名前を指した
 * ままになる（実物で確かめてある）。つまり「失敗したのでやり直せる」では
 * なく、**1回目で壊れる。**
 *
 * ブランチ（3-8-14）ではそこを `--force` で通したが、
 * **`git remote rename` に force は無い。** 同じ問いに逆の答えを出して
 * いるのは、git が用意している逃げ道の有無がそこで分かれるためになる。
 *
 * Renderer 側でも押せなくしてあるが（renderer/src/git/gitRemotes.ts）、
 * ここでも見る ── 3-8-14 の「同じ名前を打った」と同じ二重の備えで、
 * **画面が古いまま押された1回**で壊れないようにする。
 */
export async function applyGitRenameRemote(
  name: string,
  newName: string
): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    /*
      同じ名前を打った。git は `remote <名前> already exists` として断るが、
      それは「別のものが在る」という意味の文で、起きたこととは違う ──
      3-8-14 の rename と同じ形で、押した意味が無かったことはそう伝える。
    */
    if (name === newName) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'nothing-to-do'
      })
    }

    /*
      大文字小文字だけの改名。git を動かすと**途中まで適用されて壊れる**ので、
      ここで断つ（このファイルの冒頭）── 待っても・やり直しても変わらない
      ため `unsupported-target` にする（`nothing-to-do` ではない ── 押した
      意味が無かったのではなく、この経路では行えない）。
    */
    if (name.toLowerCase() === newName.toLowerCase()) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'unsupported-target'
      })
    }

    const outcome = await runRemoteCommand(
      renameRemote(name, newName),
      classifyGitRenameRemoteFailure
    )

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/* ------------------------------------------------------------------------ 削除 */

/**
 * remote を1つ削除する。
 *
 * ## 追っているブランチが在っても、止めない
 *
 * `git remote remove` は、その remote を追っていたブランチの
 * `branch.<名前>.remote` / `.merge` まで消す（実物で確かめてある。
 * gitRemoteRepository.test.ts）── だが**それは断る理由ではない。**
 *
 * 3-8-14 でチェックアウト中のブランチの削除を止めたのは、git が必ず断る
 * ものだったから（押しても絶対に通らない）。こちらは git が通すもので、
 * しかも「追跡先が消えるのは承知のうえで消したい」は普通の使い方にあたる ──
 * 止めると、**消したいのに消せない remote** が生まれる。
 *
 * 伝えるのは押す前の確認の文言で行う（renderer/src/git/gitRemotes.ts）。
 * §12.6 の「失われるものがある操作に確認を挟む」はそこで果たされる。
 *
 * ## 事前に見るのは、状態が `ready` かどうかだけ
 *
 * 「その remote が在るか」は確かめない ── 一覧を開いてから押すまでの間に
 * 消えていることはあり、それは git が `remote-not-found` として答える。
 * 先に確かめる形にすると git を2回動かしたうえ、確かめてから消すまでの間に
 * 消える余地（その1回ぶんの隙間）を自分で作ることになる（3-8-13 と同じ判断）。
 */
export async function applyGitRemoveRemote(name: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const outcome = await runRemoteCommand(removeRemote(name), classifyGitRemoveRemoteFailure)

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/* ------------------------------------------------------------------------ 共通 */

/**
 * `git remote` を1回動かして、結末に翻訳する。
 *
 * ## 待ち時間の上限は既定のまま
 *
 * 書き換えるのは `.git/config` の数行と `refs/remotes/` の下だけで、
 * 作業ツリーにもネットワークにも触らない ── `runBranchRefCommand`
 * （`git branch`）と同じ性質にあたる（main/git/gitBranches.ts）。
 *
 * ## 分類の関数は必ず呼ぶ側が渡す
 *
 * 4つの書き込み（追加 / URL の変更 / rename / 削除）で起こりうることが
 * 重ならないため（3-8-14 の `runBranchRefCommand` と同じ判断）── 既定を
 * 1つ決めると、「渡し忘れた側が、起こりえない分類を返す」形が残る。
 *
 * 重ならなさは 3-8-17 で1段はっきりした ── 追加にしか
 * 「既にある」は無く、削除と URL の変更にしか「見つからない」は無く、
 * **rename にだけ両方がある**（main/git/gitFailure.ts）。
 */
async function runRemoteCommand(
  command: GitCommand,
  classify: (stderr: string) => GitOperationFailureReason
): Promise<GitOperationOutcome> {
  const outcome = await runGit(command)

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'failed', reason: 'not-ready' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown' }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    return { status: 'failed', reason: classify(outcome.stderr) }
  }

  /*
    通ったときの `git remote add` / `remove` は何も出さない（実物で確かめた）。
    それでも stdout を見てログへ落とすのは、hook や設定で何かが出た場合に
    原因を追える手立てを残すため ── Renderer へ渡るのは分類だけ、という
    方針は 3-8-1 のまま（gitBranches.ts と同じ形）。
  */
  const trailing = outcome.stdout.trim()

  if (trailing.length > 0) {
    log.info(`git ${command.label}: ${summarizeGitStderr(trailing)}`)
  }

  return { status: 'applied' }
}
