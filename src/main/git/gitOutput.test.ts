import { describe, expect, it } from 'vitest'
import {
  isSameRepositoryPath,
  normalizeRepositoryPath,
  readBranchName,
  readCommitFileChanges,
  readCommitHistory,
  readLocalBranches,
  readRepositoryRoot,
  readShortCommit
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
