import { describe, expect, it } from 'vitest'
import {
  countLeftoverConflictMarkers,
  isSameRepositoryPath,
  normalizeRepositoryPath,
  readBranchName,
  readCommitFileChanges,
  readCommitHistory,
  readLocalBranches,
  readRemoteEntries,
  readRepositoryRoot,
  readShortCommit,
  readStashEntries,
  readStashPopConflict
} from './gitOutput'

/**
 * git の出力の読み取り（gitOutput.ts）。
 *
 * `isSameRepositoryPath` が Session 3-8-1 の核心にあたる。ここを誤ると、
 * 「リポジトリ root を開いているのにサブフォルダ扱いされる」（何もできない）か、
 * 「サブフォルダなのに root 扱いされる」（見えていないファイルまで Commit の
 * 対象になる）のどちらかが起きる。
 */

describe('readRepositoryRoot', () => {
  it('改行を落として読む', () => {
    expect(readRepositoryRoot('D:/DEV/PROJECTS/app\n')).toBe('D:/DEV/PROJECTS/app')
    expect(readRepositoryRoot('D:/DEV/PROJECTS/app\r\n')).toBe('D:/DEV/PROJECTS/app')
  })

  it('空の出力は読めなかったものとして扱う', () => {
    // 「root が空文字のリポジトリ」として通してしまわないため。
    expect(readRepositoryRoot('')).toBeNull()
    expect(readRepositoryRoot('\n\n')).toBeNull()
  })
})

describe('readBranchName', () => {
  it('ブランチ名を読む', () => {
    expect(readBranchName('main\n')).toBe('main')
    expect(readBranchName('feature/git-panel\n')).toBe('feature/git-panel')
  })

  it('空なら null', () => {
    expect(readBranchName('')).toBeNull()
  })
})

describe('readShortCommit', () => {
  it('16進の並びだけを受け付ける', () => {
    expect(readShortCommit('a1b2c3d\n')).toBe('a1b2c3d')
    expect(readShortCommit('A1B2C3D4E5\n')).toBe('A1B2C3D4E5')
  })

  /*
    形を確かめずに通すと、想定と違う出力（警告・ヒント）がそのまま
    「commit 名」として画面に出る。
  */
  it('16進でないものは読まない', () => {
    expect(readShortCommit('warning: something\n')).toBeNull()
    expect(readShortCommit('HEAD\n')).toBeNull()
    expect(readShortCommit('')).toBeNull()
  })
})

describe('isSameRepositoryPath', () => {
  /*
    git は区切りを常に `/` で返し、Workspace root は OS の表記で持つ。
    厳密一致にすると、リポジトリ root を開いていても必ず食い違う。
  */
  it('区切り文字の違いを吸収する（Windows）', () => {
    expect(isSameRepositoryPath('D:/DEV/PROJECTS/app', 'D:\\DEV\\PROJECTS\\app', 'win32')).toBe(
      true
    )
  })

  it('大文字小文字の違いを吸収する（Windows）', () => {
    expect(isSameRepositoryPath('D:/dev/projects/app', 'D:\\DEV\\PROJECTS\\app', 'win32')).toBe(
      true
    )
  })

  it('末尾の区切りの有無を吸収する', () => {
    expect(isSameRepositoryPath('D:/work/app/', 'D:\\work\\app', 'win32')).toBe(true)
  })

  it('ドライブ直下を同じと見なす', () => {
    expect(isSameRepositoryPath('D:/', 'D:\\', 'win32')).toBe(true)
  })

  /*
    ここが緩むと、リポジトリの一部だけを開いた状態で Git 操作が始まる。
  */
  it('サブフォルダを root と混同しない', () => {
    expect(isSameRepositoryPath('D:/work/app', 'D:\\work\\app\\src', 'win32')).toBe(false)
    expect(isSameRepositoryPath('D:/work/app', 'D:\\work\\app2', 'win32')).toBe(false)
  })

  it('別のドライブを混同しない', () => {
    expect(isSameRepositoryPath('C:/work/app', 'D:\\work\\app', 'win32')).toBe(false)
  })

  it('UNC も扱える', () => {
    expect(isSameRepositoryPath('//server/share/app', '\\\\server\\share\\app', 'win32')).toBe(true)
  })

  it('Windows 以外では大文字小文字を区別する', () => {
    expect(isSameRepositoryPath('/work/app', '/work/app', 'darwin')).toBe(true)
    expect(isSameRepositoryPath('/work/App', '/work/app', 'darwin')).toBe(false)
  })
})

describe('normalizeRepositoryPath', () => {
  it('重なった区切りを畳む', () => {
    expect(normalizeRepositoryPath('D:\\work\\\\app', 'win32')).toBe('d:\\work\\app')
  })

  it('UNC の先頭2つは畳まない', () => {
    expect(normalizeRepositoryPath('\\\\server\\share', 'win32')).toBe('\\\\server\\share')
  })

  it('ドライブ直下がドライブ相対に化けない', () => {
    // `D:` はドライブ相対（cwd の影響を受ける）で、`D:\` とは別物。
    expect(normalizeRepositoryPath('D:\\', 'win32')).toBe('d:\\')
  })
})

/**
 * ローカルブランチの一覧（Session 3-8-6）。
 *
 * 読む相手は `for-each-ref --format=%(HEAD)%00%(refname:short)` の出力で、
 * 1行が `*<NUL>main` または ` <NUL>feature/x` になる。
 *
 * ここで固定しているのは3つ。
 *
 *   - **印から `current` を決める**（名前の一致からではない）
 *   - **上限で切り、切ったことを言う**（黙って捨てない）
 *   - **読めない行だけを落とす**（一覧そのものは失敗にしない）
 */
describe('readLocalBranches', () => {
  /** 区切りの NUL（テスト側でも見えない文字を直接書かない）。 */
  const nul = String.fromCharCode(0)

  /** git の出力を組み立てる（末尾の改行まで本物と同じ形にする）。 */
  function output(...lines: readonly string[]): string {
    return `${lines.join('\n')}\n`
  }

  it('印の付いた行を current として読む', () => {
    const reading = readLocalBranches(
      output(` ${nul}develop`, `*${nul}main`, ` ${nul}feature/git`),
      10
    )

    expect(reading.branches).toEqual([
      { name: 'develop', current: false },
      { name: 'main', current: true },
      { name: 'feature/git', current: false }
    ])
    expect(reading.truncated).toBe(false)
  })

  it('git が返した順をそのまま保つ', () => {
    // 並べ替えを足さない（開くたびに行が入れ替わると、押そうとした行がずれる）。
    const reading = readLocalBranches(output(` ${nul}zeta`, ` ${nul}alpha`), 10)

    expect(reading.branches.map((branch) => branch.name)).toEqual(['zeta', 'alpha'])
  })

  it('1件も無ければ空（失敗にしない）', () => {
    // `git init` の直後は ref が1つも無い。それ自体が正しい答えにあたる。
    expect(readLocalBranches('', 10)).toEqual({ branches: [], truncated: false })
  })

  it('上限で切り、切ったことを truncated で伝える', () => {
    // git には上限より1つ多く求めてある（`--count=limit + 1`）。
    const lines = ['a', 'b', 'c', 'd'].map((name) => ` ${nul}${name}`)
    const reading = readLocalBranches(output(...lines), 3)

    expect(reading.branches.map((branch) => branch.name)).toEqual(['a', 'b', 'c'])
    expect(reading.truncated).toBe(true)
  })

  it('ちょうど上限のときは切れていない', () => {
    const lines = ['a', 'b', 'c'].map((name) => ` ${nul}${name}`)
    const reading = readLocalBranches(output(...lines), 3)

    expect(reading.branches).toHaveLength(3)
    expect(reading.truncated).toBe(false)
  })

  it('読めない行だけを落とす', () => {
    // 1行が読めないことで、他のブランチへ切り替える手立てまで消さない。
    const reading = readLocalBranches(output('壊れた行', ` ${nul}`, ` ${nul}main`), 10)

    expect(reading.branches).toEqual([{ name: 'main', current: false }])
  })

  it('名前に空白のような字が入っていても、区切りを取り違えない', () => {
    /*
      git はブランチ名に空白を許さないが、区切りを NUL にしてあるのは
      **`%(HEAD)` 自身が空白を出す**ため。空白で切る実装だと、
      印の無い行の先頭で切れてしまう。
    */
    const reading = readLocalBranches(output(` ${nul}feature/a-b`), 10)

    expect(reading.branches).toEqual([{ name: 'feature/a-b', current: false }])
  })
})

/**
 * commit の履歴（Session 3-8-11）。
 *
 * 読む相手は `log --format=%h%x00%an%x00%at%x00%P%x00%s` の出力で、
 * 1行が `abc1234<NUL>Name<NUL>1756100000<NUL>parent…<NUL>要約` になる。
 *
 * ここで固定しているのは4つ。
 *
 *   - **要約に何が入っていても、区切りを取り違えない**（NUL で切る）
 *   - **親の数からマージが分かる**（`%P` を数える／空を数えない）
 *   - **上限で切り、切ったことを言う**（黙って捨てない）
 *   - **読めない行だけを落とす**（履歴そのものは失敗にしない）
 */
describe('readCommitHistory', () => {
  /** 区切りの NUL（テスト側でも見えない文字を直接書かない）。 */
  const nul = String.fromCharCode(0)

  /** 1件ぶんの行を組み立てる。 */
  function line(options: {
    readonly hash?: string
    readonly author?: string
    readonly at?: string
    readonly parents?: string
    readonly subject?: string
  }): string {
    const hash = options.hash ?? 'abc1234'
    const author = options.author ?? 'Piroshi'
    const at = options.at ?? '1756100000'
    const parents = options.parents ?? 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0'
    const subject = options.subject ?? '要約'

    return `${hash}${nul}${author}${nul}${at}${nul}${parents}${nul}${subject}`
  }

  /** git の出力を組み立てる（末尾の改行まで本物と同じ形にする）。 */
  function output(...lines: readonly string[]): string {
    return `${lines.join('\n')}\n`
  }

  it('1件を、そのまま画面に渡せる形へ読む', () => {
    const reading = readCommitHistory(output(line({})), 10)

    expect(reading.commits).toEqual([
      {
        shortHash: 'abc1234',
        authorName: 'Piroshi',
        // epoch 秒 → ミリ秒（shared/git/history.ts が持つのはミリ秒）。
        authoredAt: 1_756_100_000_000,
        parentCount: 1,
        subject: '要約'
      }
    ])
    expect(reading.truncated).toBe(false)
  })

  it('git が返した順（新しい順）をそのまま保つ', () => {
    // 並べ替えを足さない（読む順を決めるのは git の側）。
    const reading = readCommitHistory(
      output(line({ hash: 'aaaa111' }), line({ hash: 'bbbb222' })),
      10
    )

    expect(reading.commits.map((commit) => commit.shortHash)).toEqual(['aaaa111', 'bbbb222'])
  })

  it('要約に空白・記号・NUL 以外の何が入っていても、そのまま読む', () => {
    /*
      区切りを NUL にしてある理由そのもの。空白やタブで切る実装だと、
      要約の途中で列がずれる（`%s` は commit メッセージの1行目そのもの）。
    */
    const subject = 'fix: A | B  --force  タブ\tと 記号 %s %h'
    const reading = readCommitHistory(output(line({ subject })), 10)

    expect(reading.commits[0]?.subject).toBe(subject)
  })

  it('要約が空でも落とさない', () => {
    // `--allow-empty-message` で作られた commit。捨てるとその1件だけ順番が飛ぶ。
    const reading = readCommitHistory(output(line({ subject: '' })), 10)

    expect(reading.commits).toHaveLength(1)
    expect(reading.commits[0]?.subject).toBe('')
  })

  it('親が2つならマージとして数える', () => {
    const reading = readCommitHistory(
      output(
        line({
          parents:
            'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0 0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f'
        })
      ),
      10
    )

    expect(reading.commits[0]?.parentCount).toBe(2)
  })

  it('親が無い（履歴の最初）行を 0 として読む', () => {
    // `%P` は空文字になる。空文字を1件と数えない。
    const reading = readCommitHistory(output(line({ parents: '' })), 10)

    expect(reading.commits[0]?.parentCount).toBe(0)
  })

  it('1件も無ければ空（失敗にしない）', () => {
    expect(readCommitHistory('', 10)).toEqual({ commits: [], truncated: false })
  })

  it('上限で切り、切ったことを truncated で伝える', () => {
    // git には上限より1つ多く求めてある（`--max-count=limit + 1`）。
    const lines = ['aaaa111', 'bbbb222', 'cccc333', 'dddd444'].map((hash) => line({ hash }))
    const reading = readCommitHistory(output(...lines), 3)

    expect(reading.commits.map((commit) => commit.shortHash)).toEqual([
      'aaaa111',
      'bbbb222',
      'cccc333'
    ])
    expect(reading.truncated).toBe(true)
  })

  it('ちょうど上限のときは切れていない', () => {
    const lines = ['aaaa111', 'bbbb222', 'cccc333'].map((hash) => line({ hash }))
    const reading = readCommitHistory(output(...lines), 3)

    expect(reading.commits).toHaveLength(3)
    expect(reading.truncated).toBe(false)
  })

  it('読めない行だけを落とす', () => {
    /*
      1行が読めないことで、他の 99 件を見る手立てまで消さない。
      落とすのは「欄が足りない」「hash の形ではない」「日時が数ではない」の3つ。
    */
    const reading = readCommitHistory(
      output(
        '欄の足りない行',
        line({ hash: 'warning: ...' }),
        line({ hash: 'eeee555', at: 'いつか' }),
        line({ hash: 'ffff666' })
      ),
      10
    )

    expect(reading.commits.map((commit) => commit.shortHash)).toEqual(['ffff666'])
  })

  it('名乗りが空でも落とさない', () => {
    const reading = readCommitHistory(output(line({ author: '' })), 10)

    expect(reading.commits).toHaveLength(1)
    expect(reading.commits[0]?.authorName).toBe('')
  })
})

/**
 * `diff-tree --raw --no-abbrev -r -z` の読み取り（Session 3-8-12）。
 *
 * ここで固定するのは「この塊をこう読む」まで。**git が本当にこの形を出すのか**は
 * 実物に確かめさせる（gitCommitDetailRepository.test.ts）── 出力の形を決めるのは
 * 実装ではなく git だからで、写しを相手にするとその答えを自分で書くことになる。
 */
describe('readCommitFileChanges', () => {
  const OLD = 'a'.repeat(40)
  const NEW = 'b'.repeat(40)
  const NONE = '0'.repeat(40)

  /** `-z` の1件（位置は1つ、rename / copy では2つ）。 */
  function record(header: string, ...paths: readonly string[]): string {
    return `${header}\0${paths.join('\0')}\0`
  }

  it('種類の文字を、変更ファイルの一覧と同じ語へ写す', () => {
    const reading = readCommitFileChanges(
      [
        record(`:000000 100644 ${NONE} ${NEW} A`, 'added.txt'),
        record(`:100644 100644 ${OLD} ${NEW} M`, 'modified.txt'),
        record(`:100644 000000 ${OLD} ${NONE} D`, 'deleted.txt'),
        record(`:100644 100755 ${OLD} ${NEW} T`, 'typed.txt')
      ].join(''),
      100
    )

    expect(reading.files.map((file) => file.kind)).toEqual([
      'added',
      'modified',
      'deleted',
      'type-changed'
    ])
    expect(reading.truncated).toBe(false)
  })

  it('rename / copy では位置を2つ読む（元 → 先）', () => {
    const reading = readCommitFileChanges(
      [
        record(`:100644 100644 ${OLD} ${OLD} R100`, 'src/old.ts', 'src/new.ts'),
        record(`:100644 100644 ${OLD} ${NEW} C085`, 'src/base.ts', 'src/copy.ts')
      ].join(''),
      100
    )

    expect(reading.files).toEqual([
      {
        relativePath: 'src/new.ts',
        kind: 'renamed',
        originalPath: 'src/old.ts',
        originalMode: '100644',
        modifiedMode: '100644',
        originalObject: OLD,
        modifiedObject: OLD
      },
      {
        relativePath: 'src/copy.ts',
        kind: 'copied',
        originalPath: 'src/base.ts',
        originalMode: '100644',
        modifiedMode: '100644',
        originalObject: OLD,
        modifiedObject: NEW
      }
    ])
  })

  it('相手が居ない側（40 桁の 0）を null にする', () => {
    const reading = readCommitFileChanges(
      [
        record(`:000000 100644 ${NONE} ${NEW} A`, 'added.txt'),
        record(`:100644 000000 ${OLD} ${NONE} D`, 'deleted.txt')
      ].join(''),
      100
    )

    expect(reading.files[0]?.originalObject).toBeNull()
    expect(reading.files[0]?.modifiedObject).toBe(NEW)
    expect(reading.files[1]?.originalObject).toBe(OLD)
    expect(reading.files[1]?.modifiedObject).toBeNull()
  })

  it('submodule（mode 160000）も一覧からは落とさない', () => {
    const reading = readCommitFileChanges(record(`:000000 160000 ${NONE} ${NEW} A`, 'sub'), 100)

    expect(reading.files).toHaveLength(1)
    expect(reading.files[0]?.modifiedMode).toBe('160000')
  })

  it('位置に改行や空白が入っていても1件を取り違えない', () => {
    const reading = readCommitFileChanges(
      [
        record(`:100644 100644 ${OLD} ${NEW} M`, 'a b/c\nd.txt'),
        record(`:100644 100644 ${OLD} ${NEW} M`, 'next.txt')
      ].join(''),
      100
    )

    expect(reading.files.map((file) => file.relativePath)).toEqual(['a b/c\nd.txt', 'next.txt'])
  })

  it('読めない塊は落として、その先を読み続ける', () => {
    const reading = readCommitFileChanges(
      [
        'warning: ...\0',
        record(`:100644 100644 ${OLD} ${NEW} U`, 'unmerged.txt'),
        record(`:100644 100644 ${OLD} ${NEW} M`, 'ok.txt')
      ].join(''),
      100
    )

    expect(reading.files.map((file) => file.relativePath)).toEqual(['ok.txt'])
  })

  it('rename なのに先の位置が無い塊を落とす', () => {
    const reading = readCommitFileChanges(`:100644 100644 ${OLD} ${OLD} R100\0only.txt\0`, 100)

    expect(reading.files).toEqual([])
  })

  it('上限で切り、切ったことを伝える', () => {
    const output = Array.from({ length: 7 }, (_, index) =>
      record(`:100644 100644 ${OLD} ${NEW} M`, `file-${index}.txt`)
    ).join('')

    const reading = readCommitFileChanges(output, 5)

    expect(reading.files).toHaveLength(5)
    expect(reading.truncated).toBe(true)
    expect(reading.files.at(-1)?.relativePath).toBe('file-4.txt')
  })

  it('ちょうど上限のときは切らない', () => {
    const output = Array.from({ length: 5 }, (_, index) =>
      record(`:100644 100644 ${OLD} ${NEW} M`, `file-${index}.txt`)
    ).join('')

    const reading = readCommitFileChanges(output, 5)

    expect(reading.files).toHaveLength(5)
    expect(reading.truncated).toBe(false)
  })

  it('何も変わっていない出力（マージ commit）は空になる', () => {
    expect(readCommitFileChanges('', 100)).toEqual({ files: [], truncated: false })
  })
})

/**
 * 退避の一覧の読み取り（Session 3-8-15）。
 *
 * `readLocalBranches` / `readCommitHistory` と確かめたいことがほぼ同じだが、
 * **1つだけ性質が違う** ── こちらは行が「番号」を運ぶ。番号を取り違えると
 * 押した人が見ていない退避が消えるため、`%gd` が読めない行は丸ごと落とす
 * （並び順から数え直さない）ことをここで固定する。
 */
describe('readStashEntries', () => {
  /** `%gd%x00%h%x00%at%x00%gs` の1行を組む。 */
  function line(selector: string, shortHash: string, at: string, subject: string): string {
    return [selector, shortHash, at, subject].join('\0')
  }

  it('番号・hash・日時・名乗りを読む', () => {
    const output = [
      line('stash@{0}', 'abc1234', '1756100000', 'WIP on main: 1a2b3c4 first'),
      line('stash@{1}', 'def5678', '1756000000', 'WIP on feature/x: 9z8y7x6 second')
    ].join('\n')

    expect(readStashEntries(output, 100)).toEqual({
      entries: [
        {
          index: 0,
          shortHash: 'abc1234',
          stashedAt: 1756100000 * 1000,
          subject: 'WIP on main: 1a2b3c4 first'
        },
        {
          index: 1,
          shortHash: 'def5678',
          stashedAt: 1756000000 * 1000,
          subject: 'WIP on feature/x: 9z8y7x6 second'
        }
      ],
      truncated: false
    })
  })

  it('2桁以上の番号も読む', () => {
    const output = line('stash@{12}', 'abc1234', '1756100000', 'WIP on main: x')

    expect(readStashEntries(output, 100).entries[0]?.index).toBe(12)
  })

  it('名乗りに NUL 以外の何が入っていても、最後の欄として読む', () => {
    // `%gs` には空白も `|` もコロンも入る。区切りを NUL にしてある理由そのもの。
    const subject = 'WIP on main: 1a2b3c4 fix: a | b  c'
    const output = line('stash@{0}', 'abc1234', '1756100000', subject)

    expect(readStashEntries(output, 100).entries[0]?.subject).toBe(subject)
  })

  /**
   * ここがこの関数の要点になる。
   *
   * 並び順から数えると、読めない行を1つ落とした瞬間にそれより後ろの番号が
   * 全部ずれる ── ずれた番号で drop すると、画面に出ていない退避が消える。
   */
  it('番号が読めない行は落とし、他の行の番号はずらさない', () => {
    const output = [
      line('stash@{0}', 'abc1234', '1756100000', 'first'),
      line('refs/stash@{1}', 'def5678', '1756000000', '接頭辞つきは読まない'),
      line('stash@{2}', '0123abc', '1755000000', 'third')
    ].join('\n')

    const reading = readStashEntries(output, 100)

    expect(reading.entries.map((entry) => entry.index)).toEqual([0, 2])
    expect(reading.entries.map((entry) => entry.shortHash)).toEqual(['abc1234', '0123abc'])
  })

  it('欄が足りない行・hash の形をしていない行・日時が数でない行は落とす', () => {
    const output = [
      'stash@{0} abc1234',
      line('stash@{1}', 'zzzzzzz', '1756100000', 'hash ではない'),
      line('stash@{2}', 'abc1234', 'いつか', '日時が読めない'),
      line('stash@{3}', 'abc1234', '1756100000', '読める')
    ].join('\n')

    const reading = readStashEntries(output, 100)

    expect(reading.entries.map((entry) => entry.index)).toEqual([3])
  })

  it('名乗りが空の行は落とさない', () => {
    // 空を捨てると、その1件だけ順番が飛ぶ（要約が空の commit と同じ判断）。
    const output = line('stash@{0}', 'abc1234', '1756100000', '')

    expect(readStashEntries(output, 100).entries).toEqual([
      { index: 0, shortHash: 'abc1234', stashedAt: 1756100000 * 1000, subject: '' }
    ])
  })

  it('上限で切り、切ったことを伝える', () => {
    const output = Array.from({ length: 7 }, (_unused, index) =>
      line(`stash@{${index}}`, 'abc1234', '1756100000', `entry ${index}`)
    ).join('\n')

    const reading = readStashEntries(output, 5)

    expect(reading.entries).toHaveLength(5)
    expect(reading.truncated).toBe(true)
    expect(reading.entries.at(-1)?.index).toBe(4)
  })

  it('ちょうど上限のときは切らない', () => {
    const output = Array.from({ length: 5 }, (_unused, index) =>
      line(`stash@{${index}}`, 'abc1234', '1756100000', `entry ${index}`)
    ).join('\n')

    const reading = readStashEntries(output, 5)

    expect(reading.entries).toHaveLength(5)
    expect(reading.truncated).toBe(false)
  })

  it('空の出力は「1件も無い」として読む', () => {
    expect(readStashEntries('', 100)).toEqual({ entries: [], truncated: false })
    expect(readStashEntries('\n\n', 100)).toEqual({ entries: [], truncated: false })
  })
})

/**
 * `stash pop` が競合したかどうか（Session 3-8-15）。
 *
 * 見ているのが stdout なのは、pop の競合が **stderr に1文字も出ない**ため
 * （実物で確かめてある。gitStashRepository.test.ts）── merge の結果は
 * 失敗ではないので、そちらへ流れる。
 */
describe('readStashPopConflict', () => {
  it('競合の見出しを読む', () => {
    const output = [
      'Auto-merging a.txt',
      'CONFLICT (content): Merge conflict in a.txt',
      'The stash entry is kept in case you need it again.'
    ].join('\n')

    expect(readStashPopConflict(output)).toBe(true)
  })

  it('add/add の競合も読む', () => {
    expect(readStashPopConflict('CONFLICT (add/add): Merge conflict in a.txt')).toBe(true)
  })

  /**
   * ここを取り違えてはいけない。
   *
   * 作業ツリーが上書きされるために**何も起きなかった**場合も、stdout には
   * `The stash entry is kept ...` が出る ── そちらを合図にすると、
   * 中身が戻っていないのに「戻ったが競合した」と出すことになる。
   */
  it('退避が残ったことだけを言っている出力は、競合として読まない', () => {
    const output = [
      'On branch main',
      'Changes not staged for commit:',
      '\tmodified:   a.txt',
      '',
      'The stash entry is kept in case you need it again.'
    ].join('\n')

    expect(readStashPopConflict(output)).toBe(false)
  })

  it('通ったときの出力は競合として読まない', () => {
    expect(readStashPopConflict('')).toBe(false)
    expect(readStashPopConflict('On branch main\nnothing to commit\n')).toBe(false)
  })
})

/**
 * `git remote --verbose` の読み取り（Session 3-8-16）。
 *
 * ## 1件につき2行来る
 *
 * ここで固定したいのは「**同じ名前を2つの行として出さない**」ことと、
 * fetch と push で URL が違う場合に**どちらを採るか**になる。
 *
 * ## URL は返らない
 *
 * 戻り値に URL の欄が無いことが、「Renderer へ URL が渡らない」を型の上で
 * 担保している（shared/git/remote.ts）── ラベルの作り方そのものは
 * gitRemoteLabel.test.ts が固定している。
 */
describe('readRemoteEntries', () => {
  /** 実物の出力（区切りは TAB、末尾に用途）。 */
  function verbose(...lines: readonly string[]): string {
    return `${lines.join('\n')}\n`
  }

  it('1件につき2行来る出力を、1件として読む', () => {
    const reading = readRemoteEntries(
      verbose(
        'origin\thttps://github.com/o/r.git (fetch)',
        'origin\thttps://github.com/o/r.git (push)'
      ),
      100
    )

    expect(reading.remotes).toEqual([{ name: 'origin', label: 'github.com/o/r' }])
    expect(reading.truncated).toBe(false)
  })

  it('複数の remote を、git が返した順のまま読む', () => {
    const reading = readRemoteEntries(
      verbose(
        'origin\thttps://github.com/o/r.git (fetch)',
        'origin\thttps://github.com/o/r.git (push)',
        'upstream\tgit@github.com:upstream/r.git (fetch)',
        'upstream\tgit@github.com:upstream/r.git (push)'
      ),
      100
    )

    expect(reading.remotes).toEqual([
      { name: 'origin', label: 'github.com/o/r' },
      { name: 'upstream', label: 'github.com/upstream/r' }
    ])
  })

  /*
    push 側だけを変える口をアプリが持っていない以上、2つ並べても読む人に
    できることが無い ── 先に出る fetch 側を採る（main/git/gitOutput.ts）。
  */
  it('fetch と push で URL が違うときは、先に出る fetch 側を採る', () => {
    const reading = readRemoteEntries(
      verbose(
        'origin\thttps://github.com/o/r.git (fetch)',
        'origin\tssh://git@github.com/o/r.git (push)'
      ),
      100
    )

    expect(reading.remotes).toEqual([{ name: 'origin', label: 'github.com/o/r' }])
  })

  it('用途の印が付いていない行も読む（--verbose の振る舞いに寄りかからない）', () => {
    const reading = readRemoteEntries(verbose('origin\thttps://github.com/o/r.git'), 100)

    expect(reading.remotes).toEqual([{ name: 'origin', label: 'github.com/o/r' }])
  })

  /*
    URL に空白が入りうるので、空白で切ると値の途中で切れる ──
    **末尾から**印を落とす（main/git/gitOutput.ts）。
  */
  it('URL に空白が入っていても、末尾の印だけを落とす', () => {
    const reading = readRemoteEntries(verbose('evil\text::sh -c whoami (fetch)'), 100)

    expect(reading.remotes).toEqual([{ name: 'evil', label: '不明な形式' }])
  })

  it('URL が空の行も落とさない（一覧に出ない remote を作らない）', () => {
    const reading = readRemoteEntries(verbose('broken\t (fetch)'), 100)

    expect(reading.remotes).toEqual([{ name: 'broken', label: '不明な形式' }])
  })

  it('remote が1件も無い出力は、空の一覧として読む（失敗ではない）', () => {
    expect(readRemoteEntries('', 100)).toEqual({ remotes: [], truncated: false })
    expect(readRemoteEntries('\n', 100)).toEqual({ remotes: [], truncated: false })
  })

  it('TAB の無い行は読まない', () => {
    expect(readRemoteEntries(verbose('origin https://github.com/o/r.git (fetch)'), 100)).toEqual({
      remotes: [],
      truncated: false
    })
  })

  it('CRLF の出力でも読む', () => {
    const reading = readRemoteEntries('origin\thttps://github.com/o/r.git (fetch)\r\n', 100)

    expect(reading.remotes).toEqual([{ name: 'origin', label: 'github.com/o/r' }])
  })

  /*
    `git remote` に件数を切る指定が無いため、上限は読む側で掛ける
    （ブランチ・履歴・退避が `--count` / `--max-count` を使うのとは違う。
    main/git/gitCommands.ts）。
  */
  it('上限で切り、切ったことを言う', () => {
    const lines: string[] = []

    for (let index = 0; index < 5; index += 1) {
      lines.push(`r${index}\thttps://example.com/o/r${index}.git (fetch)`)
      lines.push(`r${index}\thttps://example.com/o/r${index}.git (push)`)
    }

    const reading = readRemoteEntries(verbose(...lines), 3)

    expect(reading.remotes.map((remote) => remote.name)).toEqual(['r0', 'r1', 'r2'])
    expect(reading.truncated).toBe(true)
  })

  it('ちょうど上限の件数では切らない', () => {
    const reading = readRemoteEntries(
      verbose(
        'a\thttps://example.com/o/a.git (fetch)',
        'a\thttps://example.com/o/a.git (push)',
        'b\thttps://example.com/o/b.git (fetch)',
        'b\thttps://example.com/o/b.git (push)'
      ),
      2
    )

    expect(reading.remotes.map((remote) => remote.name)).toEqual(['a', 'b'])
    expect(reading.truncated).toBe(false)
  })
})

/**
 * `git diff --check` の読み取り（Session 3-8-18）。
 *
 * ここで固定したいのは**終了コードでは決められない**ことになる ──
 * `--check` は競合マーカーと空白の誤りを同じ終了コード（2）で報告するため、
 * 読む側が言い回しで分けなければ、解決し終えたファイルが空白の誤りで断られる。
 */
describe('countLeftoverConflictMarkers', () => {
  it('マーカーの行だけを数える', () => {
    const stdout = [
      'f.txt:2: leftover conflict marker',
      'f.txt:4: leftover conflict marker',
      'f.txt:6: leftover conflict marker'
    ].join('\n')

    expect(countLeftoverConflictMarkers(stdout)).toBe(3)
  })

  it('何も出ていなければ 0', () => {
    expect(countLeftoverConflictMarkers('')).toBe(0)
    expect(countLeftoverConflictMarkers('\n\n')).toBe(0)
  })

  /*
    ここがこの関数の理由そのもの。行末に空白があるだけのファイルは
    解決し終えているので、断ってはいけない（実物で確かめてある。
    main/git/gitConflictRepository.test.ts）。
  */
  it('空白の誤りは数えない（終了コードは同じ 2 でも別のこと）', () => {
    const stdout = [
      'g.txt:2: trailing whitespace.',
      '+OK   ',
      'g.txt:5: space before tab in indent.'
    ].join('\n')

    expect(countLeftoverConflictMarkers(stdout)).toBe(0)
  })

  it('マーカーと空白の誤りが混ざっていても、マーカーだけを数える', () => {
    const stdout = [
      'g.txt:2: trailing whitespace.',
      '+OK   ',
      'f.txt:4: leftover conflict marker',
      'g.txt:9: trailing whitespace.'
    ].join('\n')

    expect(countLeftoverConflictMarkers(stdout)).toBe(1)
  })

  /*
    path には `:` も空白も日本語も入りうる ── 前から切り分けると、
    そういう名前のファイルだけ数えられなくなる。見るのは末尾の言い回しだけ。
  */
  it('path に `:` や空白や日本語が入っていても数えられる', () => {
    const stdout = [
      'src/a b:c/メモ.txt:2: leftover conflict marker',
      '設計 メモ/読み: 書き.md:10: leftover conflict marker'
    ].join('\n')

    expect(countLeftoverConflictMarkers(stdout)).toBe(2)
  })

  it('CRLF でも数えられる', () => {
    expect(countLeftoverConflictMarkers('f.txt:2: leftover conflict marker\r\n')).toBe(1)
  })

  /*
    行の途中に同じ言葉が現れても数えない（末尾だけを見る）── ファイル名が
    `leftover conflict marker` を含む形でも、その行が報告そのものでなければ拾わない。
  */
  it('言い回しが末尾に無い行は数えない', () => {
    expect(countLeftoverConflictMarkers('leftover conflict marker が残っていました')).toBe(0)
    expect(countLeftoverConflictMarkers('+ // leftover conflict marker was here.')).toBe(0)
  })
})
