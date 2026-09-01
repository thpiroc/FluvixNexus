import { describe, expect, it } from 'vitest'
import { parseGitStatus } from './gitStatusOutput'

/**
 * `git status --porcelain=v2 --branch -z` の読み取りの検証（Session 3-8-2）。
 *
 * ここで確かめるのは「実際の git の出力をそのまま渡したら、正しく分かれるか」に尽きる。
 * 素材は**本物の git から取った出力**で（gitStatusRepository.test.ts が
 * 一時リポジトリを作って同じ形を実物で確かめている）、このファイルは
 * 実物では作れない形（Windows で作れない名前・壊れた出力）も含めて固定する。
 *
 * 誤りの現れ方が「Git パネルの見た目が少し変」ではなく「**Commit の対象を
 * 取り違える**」であるため、確かめる範囲を広めに取ってある。
 */

/** NUL 区切りの出力を組み立てる（末尾の NUL まで本物と同じ形にする）。 */
function output(...records: readonly string[]): string {
  return records.map((record) => `${record}\0`).join('')
}

const CLEAN_HEADERS = [
  '# branch.oid 9c8f1511b60da94e405bfedb21b10878e9ee8247',
  '# branch.head main'
]

describe('parseGitStatus', () => {
  it('変更が1つも無いリポジトリでは、どのグループも空になる', () => {
    const reading = parseGitStatus(output(...CLEAN_HEADERS))

    expect(reading).not.toBeNull()
    expect(reading?.changes).toEqual({ staged: [], unstaged: [], untracked: [], conflicted: [] })
    expect(reading?.upstream).toBeNull()
  })

  it('出力が完全に空でも読めた扱いにする（--branch を外した場合の形）', () => {
    expect(parseGitStatus('')).not.toBeNull()
  })

  it('index 側だけの変更は staged にだけ入る', () => {
    const reading = parseGitStatus(
      output(...CLEAN_HEADERS, '1 M. N... 100644 100644 100644 7898192261 9ad2ebbaff src/app.ts')
    )

    expect(reading?.changes.staged).toEqual([
      {
        relativePath: 'src/app.ts',
        kind: 'modified',
        originalPath: null,
        directory: false,
        conflictShape: null
      }
    ])
    expect(reading?.changes.unstaged).toEqual([])
  })

  it('作業ツリー側だけの変更は unstaged にだけ入る', () => {
    const reading = parseGitStatus(
      output(...CLEAN_HEADERS, '1 .M N... 100644 100644 100644 7898192261 7898192261 src/app.ts')
    )

    expect(reading?.changes.staged).toEqual([])
    expect(reading?.changes.unstaged).toEqual([
      {
        relativePath: 'src/app.ts',
        kind: 'modified',
        originalPath: null,
        directory: false,
        conflictShape: null
      }
    ])
  })

  /*
    同じファイルが両方に並ぶこと。1行に畳むと、片方だけを戻す操作（Session 3-8-3 の
    Unstage）が行の上で表せなくなる。
  */
  it('index と作業ツリーの両方が変わったファイルは、両方のグループに1件ずつ並ぶ', () => {
    const reading = parseGitStatus(
      output(...CLEAN_HEADERS, '1 MM N... 100644 100644 100644 7898192261 9ad2ebbaff a.txt')
    )

    expect(reading?.changes.staged.map((change) => change.relativePath)).toEqual(['a.txt'])
    expect(reading?.changes.unstaged.map((change) => change.relativePath)).toEqual(['a.txt'])
  })

  it('新規追加・削除・種別変更をそれぞれの種類として読む', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        '1 A. N... 000000 100644 100644 0000000000 7898192261 added.txt',
        '1 .D N... 100644 100644 000000 6a69f92020 6a69f92020 gone.txt',
        '1 D. N... 100644 000000 000000 6a69f92020 0000000000 staged-gone.txt',
        '1 .T N... 100644 100644 120000 6a69f92020 6a69f92020 link.txt'
      )
    )

    expect(reading?.changes.staged.map((change) => [change.relativePath, change.kind])).toEqual([
      ['added.txt', 'added'],
      ['staged-gone.txt', 'deleted']
    ])
    expect(reading?.changes.unstaged.map((change) => [change.relativePath, change.kind])).toEqual([
      ['gone.txt', 'deleted'],
      ['link.txt', 'type-changed']
    ])
  })

  /*
    `2` のレコードだけが、その中に NUL を1つ含む（元の path が次のフィールドに続く）。
    ここを取り違えると rename が「新しいファイル」と「知らない path の行」に化ける。
  */
  it('rename は1件として読み、元の位置を持つ', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        '2 R. N... 100644 100644 100644 d905d9da82 d905d9da82 R100 new.txt\0old.txt'
      )
    )

    expect(reading?.changes.staged).toEqual([
      {
        relativePath: 'new.txt',
        kind: 'renamed',
        originalPath: 'old.txt',
        directory: false,
        conflictShape: null
      }
    ])
    expect(reading?.changes.unstaged).toEqual([])
    expect(reading?.changes.untracked).toEqual([])
  })

  it('rename の後ろに続くレコードを、元の path として食べ違えない', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        '2 R. N... 100644 100644 100644 d905d9da82 d905d9da82 R100 new.txt\0old.txt',
        '? untracked.txt'
      )
    )

    expect(reading?.changes.staged.map((change) => change.originalPath)).toEqual(['old.txt'])
    expect(reading?.changes.untracked.map((change) => change.relativePath)).toEqual([
      'untracked.txt'
    ])
  })

  it('rename した後にさらに書き換えた場合、作業ツリー側は元の位置を持たない', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        '2 RM N... 100644 100644 100644 d905d9da82 d905d9da82 R100 new.txt\0old.txt'
      )
    )

    expect(reading?.changes.staged).toEqual([
      {
        relativePath: 'new.txt',
        kind: 'renamed',
        originalPath: 'old.txt',
        directory: false,
        conflictShape: null
      }
    ])
    expect(reading?.changes.unstaged).toEqual([
      {
        relativePath: 'new.txt',
        kind: 'modified',
        originalPath: null,
        directory: false,
        conflictShape: null
      }
    ])
  })

  it('copy を rename と別の種類として読む', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        '2 C. N... 100644 100644 100644 d905d9da82 d905d9da82 C75 copy.txt\0source.txt'
      )
    )

    expect(reading?.changes.staged[0]?.kind).toBe('copied')
  })

  it('未追跡のファイルとフォルダを見分ける', () => {
    const reading = parseGitStatus(output(...CLEAN_HEADERS, '? untracked.txt', '? untracked-dir/'))

    expect(reading?.changes.untracked).toEqual([
      {
        relativePath: 'untracked.txt',
        kind: 'untracked',
        originalPath: null,
        directory: false,
        conflictShape: null
      },
      {
        relativePath: 'untracked-dir',
        kind: 'untracked',
        originalPath: null,
        directory: true,
        conflictShape: null
      }
    ])
  })

  it('併合の衝突を、staged / unstaged とは別のグループに入れる', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        'u UU N... 100644 100644 100644 100644 df967b96a5 ba2906d066 e45c9c2666 c.txt',
        'u UD N... 100644 100644 000000 100644 587be6b4c3 b77b4eb1d9 0000000000 d.txt'
      )
    )

    expect(reading?.changes.conflicted.map((change) => change.relativePath)).toEqual([
      'c.txt',
      'd.txt'
    ])
    expect(reading?.changes.conflicted.every((change) => change.kind === 'conflicted')).toBe(true)
    expect(reading?.changes.staged).toEqual([])
    expect(reading?.changes.unstaged).toEqual([])
  })

  /*
    競合の形（Session 3-8-22A）。

    3-8-2 は `XY` を捨てていた（「どの形でも次の一手は同じ」）。その前提が
    `DD` で崩れる ── **作業ツリーにファイルが無い**ので、行に出していた
    「エディタで開く」がそこだけ空振りする（shared/git/status.ts）。

    7通りは git が閉じた集合として定義していて、実物でも7通りすべてを
    作って確かめてある（rename / rename の1回で `DD` / `AU` / `UA` が
    同時に出る。main/git/gitConflictRepository.test.ts）。
  */
  it('競合の形を `XY` から読む（7通り）', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        'u UU N... 100644 100644 100644 100644 aaaaaaaaaa bbbbbbbbbb cccccccccc both-modified.txt',
        'u AA N... 000000 100644 100644 100644 0000000000 bbbbbbbbbb cccccccccc both-added.txt',
        'u UD N... 100644 100644 000000 100644 aaaaaaaaaa bbbbbbbbbb 0000000000 deleted-by-them.txt',
        'u DU N... 100644 000000 100644 100644 aaaaaaaaaa 0000000000 cccccccccc deleted-by-us.txt',
        'u DD N... 100644 000000 000000 100644 aaaaaaaaaa 0000000000 0000000000 both-deleted.txt',
        'u AU N... 000000 100644 000000 100644 0000000000 bbbbbbbbbb 0000000000 added-by-us.txt',
        'u UA N... 000000 000000 100644 100644 0000000000 0000000000 cccccccccc added-by-them.txt'
      )
    )

    expect(
      reading?.changes.conflicted.map((change) => [change.relativePath, change.conflictShape])
    ).toEqual([
      ['both-modified.txt', 'both-modified'],
      ['both-added.txt', 'both-added'],
      ['deleted-by-them.txt', 'deleted-by-them'],
      ['deleted-by-us.txt', 'deleted-by-us'],
      ['both-deleted.txt', 'both-deleted'],
      ['added-by-us.txt', 'added-by-us'],
      ['added-by-them.txt', 'added-by-them']
    ])
  })

  /*
    競合していない行には形が付かない ── `conflictShape` が null であることが
    「この行は競合ではない」の言い換えになる（`kind` と二重に持たない）。
  */
  it('競合していない行の形は null', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        '1 M. N... 100644 100644 100644 aaaaaaaaaa bbbbbbbbbb staged.txt',
        '? untracked.txt'
      )
    )

    expect(reading?.changes.staged[0]?.conflictShape).toBeNull()
    expect(reading?.changes.untracked[0]?.conflictShape).toBeNull()
  })

  /*
    知らない組み合わせを「読めた」側へ倒さない ── 倒すと、いつか増えた形が
    `both-modified` を名乗って一覧に並ぶ（`toChangeKind` が `.` と知らない
    文字を分けているのと同じ判断）。
  */
  it('知らない `XY` の競合は、読めなかったこととして扱う', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        'u ZZ N... 100644 100644 100644 100644 aaaaaaaaaa bbbbbbbbbb cccccccccc x.txt'
      )
    )

    expect(reading).toBeNull()
  })

  /* ------------------------------------------------------------------ 名前の扱い */

  it('日本語のファイル名をそのまま読む', () => {
    const reading = parseGitStatus(output(...CLEAN_HEADERS, '? ドキュメント/設計メモ.txt'))

    expect(reading?.changes.untracked[0]?.relativePath).toBe('ドキュメント/設計メモ.txt')
  })

  it('空白を含むファイル名を、そこで切らずに読む', () => {
    const reading = parseGitStatus(
      output(
        ...CLEAN_HEADERS,
        '1 .M N... 100644 100644 100644 7898192261 7898192261 my notes/read me now.txt'
      )
    )

    expect(reading?.changes.unstaged[0]?.relativePath).toBe('my notes/read me now.txt')
  })

  /*
    `-z` を渡しているので git は名前を引用符で包まない（gitCommands.ts）。
    引用符やバックスラッシュはただの文字として通る ── 解く処理を持っていないので、
    ここが崩れると名前が化ける。Windows では作れない名前だが、
    他の OS で作られたリポジトリを clone すれば手元に並ぶ。
  */
  it('引用符やバックスラッシュを含む名前を、解こうとせずそのまま読む', () => {
    const reading = parseGitStatus(
      output(...CLEAN_HEADERS, '? say "hello".txt', '? back\\slash.txt')
    )

    expect(reading?.changes.untracked.map((change) => change.relativePath)).toEqual([
      'say "hello".txt',
      'back\\slash.txt'
    ])
  })

  it('改行を含む名前でも1件として読む（区切りは NUL だけ）', () => {
    const reading = parseGitStatus(output(...CLEAN_HEADERS, '? line\nbreak.txt'))

    expect(reading?.changes.untracked.map((change) => change.relativePath)).toEqual([
      'line\nbreak.txt'
    ])
  })

  /* ---------------------------------------------------------- upstream と ahead / behind */

  it('upstream が無ければ null（0 / 0 に倒さない）', () => {
    expect(parseGitStatus(output(...CLEAN_HEADERS))?.upstream).toBeNull()
  })

  it('ahead / behind を符号どおりに読む', () => {
    const reading = parseGitStatus(
      output(
        '# branch.oid 00636bb4ba',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +3 -2'
      )
    )

    expect(reading?.upstream).toEqual({ name: 'origin/main', ahead: 3, behind: 2 })
  })

  it('upstream はあるが差が分からない場合、0 ではなく null にする', () => {
    const reading = parseGitStatus(
      output('# branch.oid 00636bb4ba', '# branch.head main', '# branch.upstream origin/main')
    )

    expect(reading?.upstream).toEqual({ name: 'origin/main', ahead: null, behind: null })
  })

  it('detached HEAD では upstream を持たない', () => {
    const reading = parseGitStatus(
      output('# branch.oid 00636bb4ba', '# branch.head (detached)', '? note.txt')
    )

    expect(reading?.upstream).toBeNull()
    expect(reading?.changes.untracked).toHaveLength(1)
  })

  it('まだ commit が1つも無いリポジトリ（unborn）でも読める', () => {
    const reading = parseGitStatus(
      output(
        '# branch.oid (initial)',
        '# branch.head main',
        '1 A. N... 000000 100644 100644 0000000000 7898192261 a.txt'
      )
    )

    expect(reading?.changes.staged.map((change) => change.kind)).toEqual(['added'])
  })

  it('知らない見出しが増えても壊れない', () => {
    const reading = parseGitStatus(
      output(...CLEAN_HEADERS, '# branch.something future', '? note.txt')
    )

    expect(reading?.changes.untracked).toHaveLength(1)
  })

  it('無視されているファイルの行は一覧に入れない', () => {
    const reading = parseGitStatus(output(...CLEAN_HEADERS, '! out/bundle.js'))

    expect(reading?.changes).toEqual({ staged: [], unstaged: [], untracked: [], conflicted: [] })
  })

  /* -------------------------------------------------------------- 読めなかった場合 */

  it('知らないレコードは、途中まで読めていても捨てる', () => {
    expect(parseGitStatus(output(...CLEAN_HEADERS, '? note.txt', 'x something'))).toBeNull()
  })

  it('フィールドが足りないレコードを読まない', () => {
    expect(parseGitStatus(output(...CLEAN_HEADERS, '1 M. N... 100644 a.txt'))).toBeNull()
  })

  it('知らない状態の文字を「変化なし」として捨てない', () => {
    expect(
      parseGitStatus(
        output(...CLEAN_HEADERS, '1 X. N... 100644 100644 100644 7898192261 9ad2ebbaff a.txt')
      )
    ).toBeNull()
  })

  it('rename の元の path が続いていなければ読まない', () => {
    const truncated = '2 R. N... 100644 100644 100644 d905d9da82 d905d9da82 R100 new.txt'

    expect(parseGitStatus(truncated)).toBeNull()
  })

  it('壊れた ahead / behind を読み飛ばさない', () => {
    expect(
      parseGitStatus(output(...CLEAN_HEADERS, '# branch.upstream origin/main', '# branch.ab ahead'))
    ).toBeNull()
  })

  /*
    git は返さない形だが、境界の判断を「git は変な path を返さない」という前提に
    預けない（main/files/workspacePath.ts と同じ線）。
  */
  it('Workspace の外を指しうる path を受け付けない', () => {
    expect(parseGitStatus(output(...CLEAN_HEADERS, '? ../outside.txt'))).toBeNull()
    expect(parseGitStatus(output(...CLEAN_HEADERS, '? /etc/passwd'))).toBeNull()
    expect(parseGitStatus(output(...CLEAN_HEADERS, '? a/../../b.txt'))).toBeNull()
  })

  it('.git の中を変更ファイルとして扱わない', () => {
    expect(parseGitStatus(output(...CLEAN_HEADERS, '? .git/config'))).toBeNull()
  })

  it('名前が空のレコードを受け付けない', () => {
    expect(parseGitStatus(output(...CLEAN_HEADERS, '? '))).toBeNull()
  })
})
