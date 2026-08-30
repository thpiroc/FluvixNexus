import { describe, expect, it } from 'vitest'
import {
  classifyGitAddRemoteFailure,
  classifyGitBranchFailure,
  classifyGitCommitFailure,
  classifyGitCreateBranchFailure,
  classifyGitDeleteBranchFailure,
  classifyGitFailure,
  classifyGitFetchFailure,
  classifyGitAbortMergeFailure,
  classifyGitMergeBranchFailure,
  classifyGitMergeFailure,
  classifyGitOperationFailure,
  classifyGitPushFailure,
  classifyGitRemoveRemoteFailure,
  classifyGitRenameBranchFailure,
  classifyGitRenameRemoteFailure,
  classifyGitResolveConflictFailure,
  classifyGitSetRemoteUrlFailure,
  classifyGitStashDropFailure,
  classifyGitStashPopFailure,
  classifyGitStashPushFailure,
  isNotARepositoryMessage,
  summarizeGitStderr
} from './gitFailure'

/**
 * git の stderr の分類（gitFailure.ts）。
 *
 * ここが決めるのは、利用者が読む案内の**内容**にほかならない
 * （renderer/src/git/gitRepositoryMessage.ts が分類ごとの文言を持つ）。
 * 当てにいって外すと、間違った直し方を案内することになる。
 */
describe('classifyGitFailure', () => {
  it('所有者を信頼できない（Windows で最も多い）', () => {
    const stderr = [
      "fatal: detected dubious ownership in repository at 'D:/work/app'",
      "'D:/work/app' is owned by someone else"
    ].join('\n')

    expect(classifyGitFailure(stderr)).toBe('dubious-ownership')
  })

  it('safe.directory の助言だけでも読み取る', () => {
    const stderr =
      'To add an exception for this directory, call:\n\tgit config --global --add safe.directory D:/work/app'

    expect(classifyGitFailure(stderr)).toBe('dubious-ownership')
  })

  it('作業ツリーが無い（bare リポジトリ）', () => {
    const stderr = 'fatal: this operation must be run in a work tree'

    expect(classifyGitFailure(stderr)).toBe('no-work-tree')
  })

  it('権限が無い', () => {
    expect(classifyGitFailure('error: Permission denied')).toBe('permission-denied')
    expect(classifyGitFailure('fatal: Access is denied.')).toBe('permission-denied')
  })

  it('大文字小文字は問わない', () => {
    expect(classifyGitFailure('FATAL: DETECTED DUBIOUS OWNERSHIP')).toBe('dubious-ownership')
  })

  /*
    知らない文章を近そうな分類へ寄せない。間違った案内を出すより、
    「もう一度お試しください」で留める方がよい。
  */
  it('知らない文章は unknown', () => {
    expect(classifyGitFailure('fatal: bad object HEAD')).toBe('unknown')
    expect(classifyGitFailure('')).toBe('unknown')
  })
})

describe('isNotARepositoryMessage', () => {
  /*
    「リポジトリではない」は失敗ではなく答えの1つ。失敗の分類とは別の関数に
    してあるのはそのため（gitFailure.ts の冒頭）。
  */
  it('未初期化のフォルダを見分ける', () => {
    expect(
      isNotARepositoryMessage(
        'fatal: not a git repository (or any of the parent directories): .git'
      )
    ).toBe(true)
  })

  it('他の失敗を巻き込まない', () => {
    expect(isNotARepositoryMessage('fatal: detected dubious ownership in repository')).toBe(false)
    expect(isNotARepositoryMessage('')).toBe(false)
  })
})

/**
 * 書き込み操作の失敗の分類（Session 3-8-3）。
 *
 * こちらは Git パネル全体を差し替えるための分類ではなく、**一覧を出したまま
 * 添える1行**のための分類になる（shared/git/operation.ts）。
 */
describe('classifyGitOperationFailure', () => {
  it('index が他のプロセスに握られている', () => {
    const stderr = [
      "fatal: Unable to create 'D:/work/app/.git/index.lock': File exists.",
      'Another git process seems to be running in this repository.'
    ].join('\n')

    expect(classifyGitOperationFailure(stderr)).toBe('index-locked')
  })

  it('対象が見つからない', () => {
    expect(classifyGitOperationFailure("fatal: pathspec 'gone.txt' did not match any files")).toBe(
      'path-not-found'
    )
  })

  it('権限が無い', () => {
    expect(classifyGitOperationFailure('error: open("a.txt"): Permission denied')).toBe(
      'permission-denied'
    )
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitOperationFailure('error: something new happened')).toBe('unknown')
    expect(classifyGitOperationFailure('')).toBe('unknown')
  })

  /*
    index.lock は pathspec より先に見る。git は同じ stderr の中で両方に触れることが
    あり、順番が逆だと「他の git が動いている」が「見つからない」に化ける
    ── 前者は待てば通るが、後者は一覧を見直せという案内になる。
  */
  it('index.lock の方を先に採る', () => {
    const stderr = [
      "fatal: Unable to create '.git/index.lock': File exists.",
      "fatal: pathspec 'a.txt' did not match any files"
    ].join('\n')

    expect(classifyGitOperationFailure(stderr)).toBe('index-locked')
  })
})

/**
 * Commit の失敗の分類（Session 3-8-4）。
 *
 * 文言はどれも**実際の git 2.54 が出したもの**を写してある（probe で確かめた）。
 * hook が止めた場合に git 自身が何も言わないことも、そこで確かめた事実にあたる。
 */
describe('classifyGitCommitFailure', () => {
  it('名乗りが何も設定されていない', () => {
    const stderr = [
      'Author identity unknown',
      '',
      '*** Please tell me who you are.',
      '',
      "fatal: unable to auto-detect email address (got 'user@host.(none)')"
    ].join('\n')

    expect(classifyGitCommitFailure(128, stderr)).toBe('identity-missing')
  })

  it('user.name が空文字', () => {
    expect(
      classifyGitCommitFailure(128, 'fatal: empty ident name (for <t@example.com>) not allowed')
    ).toBe('identity-missing')
  })

  it('未解決の競合が残っている', () => {
    const stderr = [
      'error: Committing is not possible because you have unmerged files.',
      "hint: Fix them up in the work tree, and then use 'git add/rm <file>'",
      'fatal: Exiting because of an unresolved conflict.'
    ].join('\n')

    expect(classifyGitCommitFailure(128, stderr)).toBe('unresolved-conflicts')
  })

  it('index が他の git に握られている', () => {
    expect(
      classifyGitCommitFailure(128, "fatal: Unable to create '.git/index.lock': File exists.")
    ).toBe('index-locked')
  })

  /*
    hook が止めたとき、git 自身は何も言わない（出るのは hook の出力だけ）。
    文言で当てにいく相手が居ないため、終わり方の形で見分ける。
  */
  it('何も言わずに 1 で終わったら hook', () => {
    expect(classifyGitCommitFailure(1, '')).toBe('hook-rejected')
  })

  it('hook 自身の出力があっても hook', () => {
    expect(classifyGitCommitFailure(1, 'lint failed: 3 problems\n')).toBe('hook-rejected')
  })

  /*
    hook の中で走ったプログラムが `permission denied` と言うことはある。
    git がそう言った（`fatal:` 付き）のでない限り、フォルダの権限を見るよう
    案内するのは的を外す。
  */
  it('hook の出力に含まれる permission denied を git の権限エラーにしない', () => {
    expect(classifyGitCommitFailure(1, 'sh: ./scripts/lint: permission denied')).toBe(
      'hook-rejected'
    )
  })

  it('git 自身の権限エラーは permission-denied', () => {
    expect(
      classifyGitCommitFailure(128, "fatal: cannot open '.git/COMMIT_EDITMSG': Permission denied")
    ).toBe('permission-denied')
  })

  it('git が fatal を書いて断ったなら、知らない文章は unknown に倒す', () => {
    expect(classifyGitCommitFailure(128, 'fatal: something new happened')).toBe('unknown')
  })
})

/**
 * Push の失敗の分類（Session 3-8-5）。
 *
 * ここでいちばん大事なのは**断られ方の2つを取り違えないこと**にあたる ──
 * 「先に Pull してください」と案内した先で押しても何も変わらない状態
 * （保護ブランチ）を作ると、利用者は同じところを回り続ける。
 */
describe('classifyGitPushFailure', () => {
  it('remote に新しい変更があって断られた（次の一手は Pull）', () => {
    const stderr = [
      'To https://example.com/app.git',
      ' ! [rejected]        main -> main (fetch first)',
      'error: failed to push some refs to https://example.com/app.git',
      'hint: Updates were rejected because the remote contains work that you do'
    ].join('\n')

    expect(classifyGitPushFailure(stderr)).toBe('push-rejected')
  })

  it('non-fast-forward という言い方でも読み取る', () => {
    const stderr = ' ! [rejected]        main -> main (non-fast-forward)'

    expect(classifyGitPushFailure(stderr)).toBe('push-rejected')
  })

  /*
    `[remote rejected]` は「rejected」を含む。順番を逆にすると、
    何度 Pull しても送れない失敗が「Pull してください」と案内される。
  */
  it('保護ブランチの拒否を push-rejected と取り違えない', () => {
    const stderr = [
      'remote: error: GH006: Protected branch update failed for refs/heads/main.',
      ' ! [remote rejected] main -> main (protected branch hook declined)',
      'error: failed to push some refs to https://example.com/app.git'
    ].join('\n')

    expect(classifyGitPushFailure(stderr)).toBe('remote-rejected')
  })

  it('サーバー側の pre-receive hook が断った', () => {
    const stderr = ' ! [remote rejected] main -> main (pre-receive hook declined)'

    expect(classifyGitPushFailure(stderr)).toBe('remote-rejected')
  })

  it('認証が必要', () => {
    const stderr = [
      'remote: Support for password authentication was removed on August 13, 2021.',
      "fatal: Authentication failed for 'https://example.com/app.git/'"
    ].join('\n')

    expect(classifyGitPushFailure(stderr)).toBe('auth-required')
  })

  /*
    `credential.interactive=false` / `GIT_TERMINAL_PROMPT=0` が効いた形。
    尋ねずに即座に落ちるのが正しい振る舞いで、これは待たされた結果ではない。
  */
  it('対話を止めてあるために認証を尋ねられなかった', () => {
    const stderr =
      "fatal: could not read Username for 'https://example.com': terminal prompts disabled"

    expect(classifyGitPushFailure(stderr)).toBe('auth-required')
  })

  it('ssh の鍵で断られた場合も認証として扱う', () => {
    const stderr = [
      'git@example.com: Permission denied (publickey).',
      'fatal: Could not read from remote repository.'
    ].join('\n')

    expect(classifyGitPushFailure(stderr)).toBe('auth-required')
  })

  /*
    403 は `unable to access` に包まれて出る。ネットワーク側を先に見ると
    「回線を確認してください」という的外れな案内になる。
  */
  it('403 をネットワークの失敗と取り違えない', () => {
    const stderr =
      "fatal: unable to access 'https://example.com/app.git/': The requested URL returned error: 403"

    expect(classifyGitPushFailure(stderr)).toBe('auth-required')
  })

  it('相手へ届かなかった', () => {
    const stderr =
      "fatal: unable to access 'https://example.com/app.git/': Could not resolve host: example.com"

    expect(classifyGitPushFailure(stderr)).toBe('network-unavailable')
  })

  it('送り先が決まっていない', () => {
    const stderr = 'fatal: No configured push destination.'

    expect(classifyGitPushFailure(stderr)).toBe('no-remote')
  })

  it('知らない文章は unknown に倒す（当てにいかない）', () => {
    expect(classifyGitPushFailure('error: something entirely new')).toBe('unknown')
  })
})

/**
 * Fetch の失敗の分類（Session 3-8-5）。
 *
 * Push と別の関数にしてあるのは、**起こりうる結末の集合が違う**ため ──
 * 取ってくるだけの操作に「断られた」は無い。
 */
describe('classifyGitFetchFailure', () => {
  it('認証が必要', () => {
    expect(
      classifyGitFetchFailure("fatal: Authentication failed for 'https://example.com/app.git/'")
    ).toBe('auth-required')
  })

  it('相手へ届かなかった', () => {
    expect(
      classifyGitFetchFailure('ssh: connect to host example.com port 22: Connection refused')
    ).toBe('network-unavailable')
  })

  /* fetch の失敗が push の分類（`push-rejected`）として返らないこと。 */
  it('「rejected」を含む文章でも push の分類にはならない', () => {
    expect(classifyGitFetchFailure('error: the request was rejected by the proxy')).toBe('unknown')
  })
})

/**
 * `merge --ff-only` の失敗の分類（Session 3-8-5）。
 *
 * ここで起こるのはどれも「取り込まなかった」であって「壊した」ではない ──
 * git は上書きせずに断るため、失われたものは無い。それが伝わる分類にする。
 */
describe('classifyGitMergeFailure', () => {
  it('枝分かれしていて早送りできない', () => {
    expect(classifyGitMergeFailure('fatal: Not possible to fast-forward, aborting.')).toBe(
      'diverged'
    )
  })

  it('関係の無い履歴どうしでも、取り込めない点は同じ', () => {
    expect(classifyGitMergeFailure('fatal: refusing to merge unrelated histories')).toBe('diverged')
  })

  it('追跡先の ref を解けなかった場合も取り込めないものとして扱う', () => {
    expect(classifyGitMergeFailure('merge: @{upstream} - not something we can merge')).toBe(
      'diverged'
    )
  })

  /*
    両方に当てはまる状態（枝分かれしていて、かつ書きかけがある）では
    git は作業ツリーの方を先に言う ── 片付ける順番と揃える。
  */
  it('作業ツリーの変更が邪魔をしている', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by merge:',
      '\tsrc/app.ts',
      'Please commit your changes or stash them before you merge.'
    ].join('\n')

    expect(classifyGitMergeFailure(stderr)).toBe('local-changes-blocked')
  })

  it('前の merge が終わっていない', () => {
    const stderr = 'fatal: You have not concluded your merge (MERGE_HEAD exists).'

    expect(classifyGitMergeFailure(stderr)).toBe('unresolved-conflicts')
  })

  it('競合が残っている', () => {
    const stderr = 'error: Merging is not possible because you have unmerged files.'

    expect(classifyGitMergeFailure(stderr)).toBe('unresolved-conflicts')
  })

  it('index が握られている', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitMergeFailure(stderr)).toBe('index-locked')
  })

  /* merge はネットワークを通らない（取ってくるのは終わっている）。 */
  it('ネットワークの文言が来ても network には倒さない', () => {
    expect(classifyGitMergeFailure('fatal: could not resolve host: example.com')).toBe('unknown')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitMergeFailure('error: something entirely new')).toBe('unknown')
  })
})

/**
 * ブランチのマージの分類（Session 3-8-20）。
 *
 * ## `classifyGitMergeFailure`（上）と**同じ文言が別の分類になる**
 *
 * それがこの表を分けた理由そのものにあたる。
 *
 * | 文言                                  | 3-8-5（Pull）  | 3-8-20（マージ）      |
 * | ------------------------------------- | -------------- | --------------------- |
 * | `refusing to merge unrelated histories` | `diverged`   | `unrelated-histories` |
 * | `not something we can merge`          | `diverged`     | `branch-not-found`    |
 *
 * 相手が違う（`@{upstream}` と、一覧から選んだブランチ）ので、
 * 次の一手も違う ── 同じ分類へ落とすと、片方で必ず間違った案内が出る。
 *
 * ## 読むのは stdout と stderr を繋いだもの
 *
 * **競合の報告は stdout に出る**（`--quiet` を付けても残る。実物で
 * 確かめてある）── stderr だけを見る形にすると、いちばん起こる結末が
 * `unknown` に落ちる。文言はどれも実際の git（2.54）が出す形をそのまま置いてある。
 */
describe('classifyGitMergeBranchFailure', () => {
  /*
    いちばん起こる結末。3行とも stdout 側に出るもので、
    どれか1つでも当たれば競合として読む。
  */
  it('競合した（stdout に出る3行）', () => {
    const stdout = [
      'Auto-merging f.txt',
      'CONFLICT (content): Merge conflict in f.txt',
      'Automatic merge failed; fix conflicts and then commit the result.'
    ].join('\n')

    expect(classifyGitMergeBranchFailure(stdout)).toBe('merge-conflict')
  })

  it('競合の種類が変わっても拾う（modify/delete）', () => {
    const stdout = 'CONFLICT (modify/delete): f.txt deleted in feat and modified in HEAD.'

    expect(classifyGitMergeBranchFailure(stdout)).toBe('merge-conflict')
  })

  /*
    hook が merge commit を止めた。このとき MERGE_HEAD は**残る**
    （実物で確かめてある）── 画面はマージ中として出続ける。
  */
  it('hook が merge commit を止めた', () => {
    const output = ["Not committing merge; use 'git commit' to complete the merge."].join('\n')

    expect(classifyGitMergeBranchFailure(output)).toBe('hook-rejected')
  })

  /*
    hook の出力は**任意の文章**なので、hook を競合や無関係な履歴より
    後ろで見ると、そう書いた hook に引きずられる ── 順番でそれを防いでいる。
  */
  it('hook が別の分類の言い回しを出しても hook-rejected のまま', () => {
    const output = [
      'refusing to merge unrelated histories',
      "Not committing merge; use 'git commit' to complete the merge."
    ].join('\n')

    expect(classifyGitMergeBranchFailure(output)).toBe('hook-rejected')
  })

  /*
    3-8-5 の表では `diverged` に寄せている文言。こちらでは分ける ──
    次の一手が「どう統合するかを決める」ではなく「相手を確かめ直す」になる。
  */
  it('共通の履歴が無い（Pull の表とは違う分類になる）', () => {
    const stderr = 'fatal: refusing to merge unrelated histories'

    expect(classifyGitMergeBranchFailure(stderr)).toBe('unrelated-histories')
    // 3-8-5 の表では同じ文言が diverged のままであること。
    expect(classifyGitMergeFailure(stderr)).toBe('diverged')
  })

  /*
    こちらも 3-8-5 とは意味が裏返る ── あちらは「追跡先の ref が
    解けなかった」、こちらは「一覧から選んだブランチが消えていた」。
  */
  it('相手のブランチが解けない（Pull の表とは違う分類になる）', () => {
    const stderr = 'merge: no-such-branch - not something we can merge'

    expect(classifyGitMergeBranchFailure(stderr)).toBe('branch-not-found')
    expect(classifyGitMergeFailure('merge: @{upstream} - not something we can merge')).toBe(
      'diverged'
    )
  })

  it('作業ツリーの変更が邪魔をしている', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by merge:',
      '\tf.txt',
      'Please commit your changes or stash them before you merge.',
      'Aborting'
    ].join('\n')

    expect(classifyGitMergeBranchFailure(stderr)).toBe('local-changes-blocked')
  })

  /* staged が邪魔なときの言い回し（終了コードは 2）。 */
  it('staged の変更が邪魔でも local-changes-blocked', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by merge:',
      '\tf.txt',
      'Merge with strategy ort failed.'
    ].join('\n')

    expect(classifyGitMergeBranchFailure(stderr)).toBe('local-changes-blocked')
  })

  it('前のマージが終わっていない', () => {
    const stderr = [
      'error: Merging is not possible because you have unmerged files.',
      'fatal: Exiting because of an unresolved conflict.'
    ].join('\n')

    expect(classifyGitMergeBranchFailure(stderr)).toBe('unresolved-conflicts')
  })

  it('index が握られている', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitMergeBranchFailure(stderr)).toBe('index-locked')
  })

  /*
    `--ff` を明示しているので普段は出ないが、設定側から出る経路が残りうる ──
    取り込めなかったという結論は Pull と同じなので、同じ分類に寄せてある。
  */
  it('早送りできない言い回しは diverged のまま', () => {
    expect(classifyGitMergeBranchFailure('fatal: Not possible to fast-forward, aborting.')).toBe(
      'diverged'
    )
  })

  it('権限で断られた', () => {
    expect(classifyGitMergeBranchFailure('error: unable to write file: Permission denied')).toBe(
      'permission-denied'
    )
  })

  /* マージはネットワークを通らない（相手は手元のブランチ）。 */
  it('ネットワークの文言が来ても network には倒さない', () => {
    expect(classifyGitMergeBranchFailure('fatal: could not resolve host: example.com')).toBe(
      'unknown'
    )
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitMergeBranchFailure('error: something entirely new')).toBe('unknown')
  })
})

/**
 * マージの中止の分類（Session 3-8-20）。
 *
 * 起こりうることが少ない ── 引数を1つも取らず、ネットワークにも出ず、
 * hook も走らない。`nothing-to-do` はアプリが**先に見て返す**ので
 * （読んだ状態の `merging` が偽なら git を動かさない）、ここへ来るのは
 * 「確かめてから動かすまでの間に、端末側で中止された」場合に限られる。
 */
describe('classifyGitAbortMergeFailure', () => {
  it('中止するものが無かった', () => {
    const stderr = 'fatal: There is no merge to abort (MERGE_HEAD missing).'

    expect(classifyGitAbortMergeFailure(stderr)).toBe('nothing-to-do')
  })

  it('index が握られている', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitAbortMergeFailure(stderr)).toBe('index-locked')
  })

  it('権限で断られた', () => {
    expect(classifyGitAbortMergeFailure('error: unable to unlink: Permission denied')).toBe(
      'permission-denied'
    )
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitAbortMergeFailure('error: something entirely new')).toBe('unknown')
  })
})

/**
 * ブランチの切り替え / 作成の分類（Session 3-8-6）。
 *
 * 文言はどれも実際の git（2.4x）が出す形をそのまま置いてある。
 * ここで取り違えると、**直す場所がまったく違う案内**を出すことになる ──
 * 「書きかけを片付けてください」と「一覧を開き直してください」は、
 * どちらも押し直しでは解決しない。
 */
describe('classifyGitBranchFailure', () => {
  it('同じ名前のブランチが既にある', () => {
    expect(classifyGitBranchFailure("fatal: a branch named 'feature/x' already exists")).toBe(
      'branch-exists'
    )
  })

  it('切り替え先が見つからない', () => {
    const stderr = 'fatal: invalid reference: feature/typo\n'

    expect(classifyGitBranchFailure(stderr)).toBe('branch-not-found')
  })

  it('remote-tracking branch の名前でも「見つからない」に落ちる', () => {
    /*
      `--no-guess` を渡してあるため、手元にブランチを作る推測は起こらない
      （一覧に出していないものは切り替え先にならない。gitCommands.ts）。
      git の言い方は「無い名前」を渡したときとまったく同じになる。
    */
    expect(classifyGitBranchFailure('fatal: invalid reference: remote-only\n')).toBe(
      'branch-not-found'
    )
  })

  it('作業ツリーの書きかけが邪魔をした', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\tsrc/app.ts',
      'Please commit your changes or stash them before you switch branches.'
    ].join('\n')

    expect(classifyGitBranchFailure(stderr)).toBe('local-changes-blocked')
  })

  /**
   * 順番の要（このファイルでいちばん取り違えやすいところ）。
   *
   * 書きかけが邪魔をしたときの文言にも**切り替え先の名前**が入る。
   * 「見つからない」を先に見る実装だと、Commit すれば通る状態に対して
   * 「一覧を開き直してください」と案内することになる。
   */
  it('名前に触れた断り方でも、作業ツリーの理由を先に読む', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\tnotes.md',
      "Aborting: could not switch to 'feature/x'"
    ].join('\n')

    expect(classifyGitBranchFailure(stderr)).toBe('local-changes-blocked')
  })

  it('競合が残っている', () => {
    expect(classifyGitBranchFailure('error: you have unmerged files in your index')).toBe(
      'unresolved-conflicts'
    )
  })

  it('index が握られている', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitBranchFailure(stderr)).toBe('index-locked')
  })

  it('権限', () => {
    expect(classifyGitBranchFailure('error: unable to unlink old file: Permission denied')).toBe(
      'permission-denied'
    )
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitBranchFailure('error: something entirely new')).toBe('unknown')
  })

  /**
   * worktree で使われているブランチ。
   *
   * 「同じ名前がある」ではなく「そのブランチへは切り替えられない」で、
   * 次の一手が違う ── worktree は対象外なので、当てにいかず unknown に倒す。
   */
  it('worktree の断りを branch-exists と読み違えない', () => {
    const stderr = "fatal: 'feature/x' is already used by worktree at 'D:/work/other'"

    expect(classifyGitBranchFailure(stderr)).toBe('unknown')
  })
})

/**
 * 始点を渡した「作って切り替える」の分類（Session 3-8-13）。
 *
 * ここが決めるのは、**同じ文言をどちらの相手のこととして読むか**になる。
 * git は「切り替え先のブランチが無い」ときも「始点の commit が解けない」ときも
 * `invalid reference: <値>` としか言わない ── 区別できるのは、
 * どちらのコマンドを組み立てたかを知っている側だけにあたる。
 *
 * 取り違えると、履歴を開き直せば済む人に「ブランチの一覧を開き直してください」と
 * 案内することになる。
 */
describe('classifyGitCreateBranchFailure', () => {
  it('始点が解けなかった（短い hash）', () => {
    expect(classifyGitCreateBranchFailure('fatal: invalid reference: abc1234\n')).toBe(
      'commit-not-found'
    )
  })

  /*
    40 桁で渡したときだけ、git の言い方が変わる（実物で確かめてある。
    gitBranchRepository.test.ts）。`classifyGitFailure` 側の `unable to read` は
    **権限**として読んでいるので、表を共有していない。
  */
  it('始点が解けなかった（40 桁）', () => {
    const stderr = 'fatal: unable to read tree (0123456789abcdef0123456789abcdef01234567)\n'

    expect(classifyGitCreateBranchFailure(stderr)).toBe('commit-not-found')
  })

  /*
    同じ文言でも、切り替えの側では相手がブランチになる ── 2つの関数が
    別の答えを返すことが、この分け方そのものにあたる。
  */
  it('切り替えの分類とは違う答えになる', () => {
    const stderr = 'fatal: invalid reference: abc1234\n'

    expect(classifyGitBranchFailure(stderr)).toBe('branch-not-found')
    expect(classifyGitCreateBranchFailure(stderr)).toBe('commit-not-found')
  })

  /*
    始点以外の理由は、切り替えとまったく同じに読む（委譲している）──
    片方にだけ分類が足された日に、もう片方が unknown へ落ちない。
  */
  it('名前が既にあることは、始点を渡していても branch-exists', () => {
    expect(classifyGitCreateBranchFailure("fatal: a branch named 'feature/x' already exists")).toBe(
      'branch-exists'
    )
  })

  it('書きかけが邪魔をしたことは local-changes-blocked', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\tsrc/app.ts',
      'Please commit your changes or stash them before you switch branches.'
    ].join('\n')

    expect(classifyGitCreateBranchFailure(stderr)).toBe('local-changes-blocked')
  })

  it('index が握られていることは index-locked', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitCreateBranchFailure(stderr)).toBe('index-locked')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitCreateBranchFailure('error: something entirely new')).toBe('unknown')
  })
})

/**
 * 削除の分類（Session 3-8-14）。
 *
 * 文言はすべて実物の git（2.54）から採ってある ── 当てずっぽうで書くと、
 * `-D` を持たないという判断がいちばん効く場面（`branch-not-merged`）が
 * `unknown` に落ちて、「Git 操作に失敗しました」とだけ出ることになる。
 */
describe('classifyGitDeleteBranchFailure', () => {
  it('そこにしか無い commit があることは branch-not-merged', () => {
    const stderr = [
      "error: the branch 'unmerged' is not fully merged",
      "hint: If you are sure you want to delete it, run 'git branch -D unmerged'"
    ].join('\n')

    expect(classifyGitDeleteBranchFailure(stderr)).toBe('branch-not-merged')
  })

  /*
    今チェックアウトされている場合は**大半が事前判定で分かれる**（gitBranches.ts）。
    ここへ落ちるのは別の worktree で使われている場合になるが、git の言い方は
    どちらも同じなので、同じ分類として読む。
  */
  it('チェックアウト中であることは branch-checked-out', () => {
    const stderr = "error: cannot delete branch 'main' used by worktree at 'C:/work/repo'"

    expect(classifyGitDeleteBranchFailure(stderr)).toBe('branch-checked-out')
  })

  it('消そうとしたブランチが無いことは branch-not-found', () => {
    expect(classifyGitDeleteBranchFailure("error: branch 'nope' not found")).toBe(
      'branch-not-found'
    )
  })

  /*
    切り替えの表と分けてある意味が、ここに出る ── `switch` の言い方
    （`invalid reference`）は、削除では**起こりえない。** 通してしまうと、
    起こりえない分類が結果に混ざる形を残すことになる。
  */
  it('切り替えの言い方は、削除では読まない', () => {
    expect(classifyGitBranchFailure('fatal: invalid reference: x')).toBe('branch-not-found')
    expect(classifyGitDeleteBranchFailure('fatal: invalid reference: x')).toBe('unknown')
  })

  /*
    削除では作業ツリーが動かないので、この文言が返ることは無い ── 表を
    共有していれば `local-changes-blocked` になっていたところで、
    分けてあることが `unknown` として現れる。
  */
  it('書きかけの言い方も、削除では読まない', () => {
    const stderr = 'error: Your local changes to the following files would be overwritten'

    expect(classifyGitDeleteBranchFailure(stderr)).toBe('unknown')
  })

  it('index が握られていることは index-locked', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitDeleteBranchFailure(stderr)).toBe('index-locked')
  })

  it('権限が無いことは permission-denied', () => {
    expect(classifyGitDeleteBranchFailure('error: unable to unlink: Permission denied')).toBe(
      'permission-denied'
    )
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitDeleteBranchFailure('error: something entirely new')).toBe('unknown')
  })
})

/**
 * rename の分類（Session 3-8-14）。
 *
 * 削除と同じ `git branch` だが、起こりうることが重ならない ── どちらの表にも
 * 相手側の言い方を入れていないことを、ここで固定する。
 */
describe('classifyGitRenameBranchFailure', () => {
  /*
    ここへ落ちる `already exists` は、必ず**本物の衝突**になる ── 大文字小文字
    だけの違いは、呼ぶ側が先に確かめて `--force` で通すため（gitBranches.ts）。
  */
  it('行き先の名前が既にあることは branch-exists', () => {
    expect(classifyGitRenameBranchFailure("fatal: a branch named 'main' already exists")).toBe(
      'branch-exists'
    )
  })

  /*
    `git branch -m` の言い方は、削除（`branch 'x' not found`）とも
    切り替え（`invalid reference`）とも違う。
  */
  it('改名元が無いことは branch-not-found', () => {
    expect(classifyGitRenameBranchFailure("fatal: no branch named 'nope'")).toBe('branch-not-found')
  })

  it('マージ済みかどうかの言い方は、rename では読まない', () => {
    const stderr = "error: the branch 'x' is not fully merged"

    expect(classifyGitDeleteBranchFailure(stderr)).toBe('branch-not-merged')
    expect(classifyGitRenameBranchFailure(stderr)).toBe('unknown')
  })

  it('チェックアウト中かどうかの言い方も、rename では読まない', () => {
    const stderr = "error: cannot delete branch 'main' used by worktree at 'C:/work/repo'"

    expect(classifyGitDeleteBranchFailure(stderr)).toBe('branch-checked-out')
    expect(classifyGitRenameBranchFailure(stderr)).toBe('unknown')
  })

  it('index が握られていることは index-locked', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitRenameBranchFailure(stderr)).toBe('index-locked')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitRenameBranchFailure('error: something entirely new')).toBe('unknown')
  })
})

describe('summarizeGitStderr', () => {
  it('複数行を1行へ畳む', () => {
    expect(summarizeGitStderr('fatal: one\n  hint: two\n\n')).toBe('fatal: one hint: two')
  })

  it('長すぎる出力でログを埋めない', () => {
    const summary = summarizeGitStderr('x'.repeat(2000))

    expect(summary.length).toBeLessThanOrEqual(501)
    expect(summary.endsWith('…')).toBe(true)
  })
})

/**
 * 退避の失敗の分類（Session 3-8-15）。
 *
 * 文字列はどれも**実物の git（2.54）が返したもの**を写してある
 * （gitStashRepository.test.ts が同じ状況を実際に作る）。
 *
 * 3つに分けてあるのは、起こりうることが重ならないため ── drop は作業ツリーに
 * 1文字も触らないので `local-changes-blocked` が起こりえず、push に
 * 「その退避が無い」は無い。1つの表にまとめると、互いに起こりえない分類を
 * 持ち込むことになる（削除と rename で表を分けたのと同じ判断）。
 */
describe('classifyGitStashPushFailure', () => {
  it('まだ commit が1つも無い', () => {
    expect(classifyGitStashPushFailure('You do not have the initial commit yet')).toBe('no-commit')
  })

  it('index が握られていることは index-locked', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitStashPushFailure(stderr)).toBe('index-locked')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitStashPushFailure('error: could not write index')).toBe('unknown')
  })
})

describe('classifyGitStashPopFailure', () => {
  /**
   * ここが pop でいちばん取り違えてはいけないところ。
   *
   * 上書きされるので**何も起きなかった**のと、戻ったうえで競合したのとでは、
   * 次の一手がまるごと違う（前者は先に Commit する、後者は解決する）。
   * 前者は stderr に出るので、この表が当てる。
   */
  it('作業ツリーが上書きされるため断られた', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by merge:',
      '\ta.txt',
      'Please commit your changes or stash them before you merge.',
      'Aborting'
    ].join('\n')

    expect(classifyGitStashPopFailure(stderr)).toBe('local-changes-blocked')
  })

  it('退避が1件も無い', () => {
    expect(classifyGitStashPopFailure('error: stash@{0} is not a valid reference')).toBe(
      'stash-not-found'
    )
  })

  it('範囲を超えた位置を指した', () => {
    expect(classifyGitStashPopFailure("fatal: log for 'stash' only has 1 entries")).toBe(
      'stash-not-found'
    )
  })

  it('index が握られていることは index-locked', () => {
    const stderr = "fatal: Unable to create '/repo/.git/index.lock': File exists."

    expect(classifyGitStashPopFailure(stderr)).toBe('index-locked')
  })

  /**
   * 競合したとき、git は stderr に1文字も書かない（実物で確かめてある）──
   * したがってこの表からは `unknown` が返り、呼ぶ側が stdout を見て
   * `partly-applied` へ倒す（main/git/gitStash.ts）。
   */
  it('競合したときは stderr が空になり、この表では分からない', () => {
    expect(classifyGitStashPopFailure('')).toBe('unknown')
  })
})

describe('classifyGitStashDropFailure', () => {
  it('退避が1件も無い', () => {
    expect(classifyGitStashDropFailure('error: stash@{0} is not a valid reference')).toBe(
      'stash-not-found'
    )
  })

  it('範囲を超えた位置を指した', () => {
    expect(classifyGitStashDropFailure("fatal: log for 'stash' only has 2 entries")).toBe(
      'stash-not-found'
    )
  })

  /**
   * drop は作業ツリーに触らないので、上書きの言い方は読まない ──
   * 読んでしまうと、起こりえない分類が結果に混ざる形を残すことになる。
   */
  it('作業ツリーが上書きされるという言い方は、drop では読まない', () => {
    const stderr = 'error: Your local changes to the following files would be overwritten by merge:'

    expect(classifyGitStashPopFailure(stderr)).toBe('local-changes-blocked')
    expect(classifyGitStashDropFailure(stderr)).toBe('unknown')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitStashDropFailure('error: something entirely new')).toBe('unknown')
  })
})

/**
 * remote の追加 / 削除の分類（Session 3-8-16）。
 *
 * 読む相手は `git remote add` / `git remote remove` の stderr で、
 * どちらの文言も**実物で確かめてある**（git 2.54）。
 *
 *   既にある     … `error: remote origin already exists.`（終了コード 3）
 *   見つからない … `error: No such remote: 'nope'`（終了コード 2）
 *
 * ここで固定したいのは、3-8-14 / 3-8-15 と同じ「**表を分けてあること**」に
 * なる ── 片方でしか起こりえない分類が、もう片方から返らないこと。
 */
describe('classifyGitAddRemoteFailure', () => {
  it('同じ名前の remote が既にある', () => {
    expect(classifyGitAddRemoteFailure('error: remote origin already exists.')).toBe(
      'remote-exists'
    )
  })

  it('index.lock を先に見る', () => {
    expect(
      classifyGitAddRemoteFailure(
        "fatal: Unable to create 'D:/work/app/.git/index.lock': File exists."
      )
    ).toBe('index-locked')
  })

  it('権限', () => {
    expect(
      classifyGitAddRemoteFailure('error: could not lock config file: Permission denied')
    ).toBe('permission-denied')
  })

  /*
    削除でしか起こりえないものを、追加の表から返さない。
  */
  it('「見つからない」は追加の表では読まない', () => {
    expect(classifyGitAddRemoteFailure("error: No such remote: 'nope'")).toBe('unknown')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitAddRemoteFailure('error: something entirely new')).toBe('unknown')
  })
})

describe('classifyGitRemoveRemoteFailure', () => {
  it('消そうとした remote が無い', () => {
    expect(classifyGitRemoveRemoteFailure("error: No such remote: 'nope'")).toBe('remote-not-found')
  })

  it('index.lock を先に見る', () => {
    expect(
      classifyGitRemoveRemoteFailure(
        "fatal: Unable to create 'D:/work/app/.git/index.lock': File exists."
      )
    ).toBe('index-locked')
  })

  it('権限', () => {
    expect(
      classifyGitRemoveRemoteFailure('error: could not lock config file: Permission denied')
    ).toBe('permission-denied')
  })

  /*
    追加でしか起こりえないものを、削除の表から返さない。
  */
  it('「既にある」は削除の表では読まない', () => {
    expect(classifyGitRemoveRemoteFailure('error: remote origin already exists.')).toBe('unknown')
  })

  /*
    ブランチの表と書き写して分けてある ── `already exists` は
    `classifyGitRenameBranchFailure` では `branch-exists` になるが、
    remote の表では読まない（3-8-14 と同じ判断）。
  */
  it('ブランチの表とは別の答えを返す', () => {
    expect(classifyGitRenameBranchFailure('error: a branch named x already exists')).toBe(
      'branch-exists'
    )
    expect(classifyGitRemoveRemoteFailure('error: a branch named x already exists')).toBe('unknown')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitRemoveRemoteFailure('error: something entirely new')).toBe('unknown')
  })
})

/*
  remote の URL の変更（Session 3-8-17）。

  起こりうるのは「その remote が無い」だけで、削除とそこは重なる ──
  それでも表を分けてあるので、追加でしか起こりえない分類は返らない。
*/
describe('classifyGitSetRemoteUrlFailure', () => {
  /*
    git の言い方は削除（`No such remote:` ── コロンつき）と1文字違う。
    実物で確かめてある（main/git/gitRemoteRepository.test.ts）。
  */
  it('URL を変えようとした remote が無い（コロンの無い言い方）', () => {
    expect(classifyGitSetRemoteUrlFailure("error: No such remote 'nope'")).toBe('remote-not-found')
  })

  it('削除と同じコロンつきの言い方も読む', () => {
    expect(classifyGitSetRemoteUrlFailure("error: No such remote: 'nope'")).toBe('remote-not-found')
  })

  it('index.lock を先に見る', () => {
    expect(
      classifyGitSetRemoteUrlFailure(
        "fatal: Unable to create 'D:/work/app/.git/index.lock': File exists."
      )
    ).toBe('index-locked')
  })

  it('権限', () => {
    expect(
      classifyGitSetRemoteUrlFailure('error: could not lock config file: Permission denied')
    ).toBe('permission-denied')
  })

  /*
    追加にしか起こりえないものを、この表から返さない ── `set-url` は
    既にあるものを相手にする操作で、「既にある」は失敗の理由にならない。
  */
  it('「既にある」は URL の変更の表では読まない', () => {
    expect(classifyGitSetRemoteUrlFailure('error: remote origin already exists.')).toBe('unknown')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitSetRemoteUrlFailure('error: something entirely new')).toBe('unknown')
  })
})

/*
  remote の rename（Session 3-8-17）。

  remote の4つの表の中で、**2つの分類が同居する唯一の表**になる
  （ブランチの rename と同じ形）。
*/
describe('classifyGitRenameRemoteFailure', () => {
  it('行き先の名前が既に使われている', () => {
    expect(classifyGitRenameRemoteFailure('error: remote other already exists.')).toBe(
      'remote-exists'
    )
  })

  it('改名しようとした remote が無い', () => {
    expect(classifyGitRenameRemoteFailure("error: No such remote: 'nope'")).toBe('remote-not-found')
  })

  it('index.lock を先に見る', () => {
    expect(
      classifyGitRenameRemoteFailure(
        "fatal: Unable to create 'D:/work/app/.git/index.lock': File exists."
      )
    ).toBe('index-locked')
  })

  it('権限', () => {
    expect(
      classifyGitRenameRemoteFailure('error: could not lock config file: Permission denied')
    ).toBe('permission-denied')
  })

  /*
    大文字小文字だけの改名で git が言うこと。**`index-locked` に読み違えない。**

    素直に読むと「他の git を閉じてやり直せば通る」という案内になるが、
    実際は何度やり直しても通らず、しかもその時点で設定は半分書き換わって
    いる（実物で確かめてある）── だからその組み合わせは git を動かす前に
    断ってあり（main/git/gitRemotes.ts）、この表には落ちてこない。

    それでも `unknown` に倒れることを固定しておく ── ここで
    `index-locked` を返す形にしてしまうと、断つ側を外した日に
    嘘の案内が黙って出ることになる。
  */
  it('ref のロックの失敗を index.lock と読み違えない', () => {
    expect(
      classifyGitRenameRemoteFailure(
        "error: renaming remote references failed: cannot lock ref 'refs/remotes/Origin/main': " +
          "Unable to create 'D:/work/app/.git/refs/remotes/Origin/main.lock': File exists.\n" +
          '\nAnother git process seems to be running in this repository'
      )
    ).toBe('unknown')
  })

  /*
    ブランチの rename の表と書き写して分けてある（3-8-14 と同じ判断）──
    同じ `already exists` でも、開き直す一覧が違う。
  */
  it('ブランチの rename とは別の分類を返す', () => {
    expect(classifyGitRenameBranchFailure('error: a branch named x already exists')).toBe(
      'branch-exists'
    )
    expect(classifyGitRenameRemoteFailure('error: remote x already exists.')).toBe('remote-exists')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitRenameRemoteFailure('error: something entirely new')).toBe('unknown')
  })
})

/**
 * 競合の解決（Session 3-8-18）。
 *
 * 動かす git は Stage とまったく同じ `git add` だが、起こりうることが
 * 重ならないため表を分けてある。
 */
describe('classifyGitResolveConflictFailure', () => {
  it('index が他の git に握られている', () => {
    expect(
      classifyGitResolveConflictFailure(
        "fatal: Unable to create 'D:/work/app/.git/index.lock': File exists."
      )
    ).toBe('index-locked')
  })

  it('権限', () => {
    expect(classifyGitResolveConflictFailure('error: open("a.txt"): Permission denied')).toBe(
      'permission-denied'
    )
  })

  /*
    競合マーカーが残っていることは**git の失敗ではない** ── git は
    マーカーが残ったままの add を成功として通す（実物で確かめてある）。
    断っているのはアプリ側で、押す前に決まる（main/git/gitConflict.ts）。
    したがってこの表からその分類が返ることは無い。
  */
  it('`conflict-markers-present` はこの表からは返らない', () => {
    expect(classifyGitResolveConflictFailure('leftover conflict marker')).toBe('unknown')
    expect(classifyGitResolveConflictFailure('')).toBe('unknown')
  })

  /*
    Stage の表が読む「見つからない」は、こちらでは起こりえない ──
    対象は必ず index に3段で載っているものになる。
  */
  it('pathspec の「見つからない」を読まない（Stage の表とは別）', () => {
    expect(classifyGitOperationFailure("fatal: pathspec 'gone.txt' did not match any files")).toBe(
      'path-not-found'
    )
    expect(
      classifyGitResolveConflictFailure("fatal: pathspec 'gone.txt' did not match any files")
    ).toBe('unknown')
  })

  it('知らない文章は unknown に倒す', () => {
    expect(classifyGitResolveConflictFailure('error: something entirely new')).toBe('unknown')
  })
})
