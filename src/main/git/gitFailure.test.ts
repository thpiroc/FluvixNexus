import { describe, expect, it } from 'vitest'
import {
  classifyGitBranchFailure,
  classifyGitCommitFailure,
  classifyGitFailure,
  classifyGitFetchFailure,
  classifyGitMergeFailure,
  classifyGitOperationFailure,
  classifyGitPushFailure,
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
