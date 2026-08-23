import { describe, expect, it } from 'vitest'
import {
  isSameRepositoryPath,
  normalizeRepositoryPath,
  readBranchName,
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
