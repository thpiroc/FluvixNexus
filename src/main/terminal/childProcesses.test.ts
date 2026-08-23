import { describe, expect, it } from 'vitest'
import { buildChildProcessFilter, parseParentPids, queryPidsWithChildren } from './childProcesses'

/**
 * 「そのシェルが何かを実行しているか」の問い合わせ（childProcesses.ts）。
 *
 * OS へ実際に聞く部分はここでは扱わない（実機での確認は DEVELOPMENT.md §5）。
 * 固定しておきたいのは、その前後にある2つの純粋な判断になる。
 *
 *   組み立て … コマンドの中へ入る値が整数だけであること
 *   読み取り … 聞いた相手の答えだけを拾い、余計なものを「実行中」にしないこと
 */
describe('buildChildProcessFilter', () => {
  it('pid ごとの条件を OR でつなぐ', () => {
    expect(buildChildProcessFilter([10, 20])).toBe('ParentProcessId=10 OR ParentProcessId=20')
  })

  it('同じ pid は1つにまとめる', () => {
    expect(buildChildProcessFilter([10, 10])).toBe('ParentProcessId=10')
  })

  /*
    ここへ来るのは node-pty が返した pid だけだが、**文字列としてコマンドの中へ
    入る唯一の値**なので、整数であることはこの関数の側で確かめる。
  */
  it('整数でない値を通さない', () => {
    expect(buildChildProcessFilter([Number.NaN, 1.5, -3, 0])).toBeNull()
  })

  it('数として読める pid だけを残す', () => {
    expect(buildChildProcessFilter([Number.NaN, 42])).toBe('ParentProcessId=42')
  })

  it('聞く相手が無ければ null', () => {
    expect(buildChildProcessFilter([])).toBeNull()
  })
})

describe('parseParentPids', () => {
  it('子を持っていた親を返す', () => {
    expect(parseParentPids('10\r\n20\r\n', [10, 20, 30])).toEqual([10, 20])
  })

  /** 子が2つあれば同じ親が2行に出る。数えたいのは「居るかどうか」だけ。 */
  it('同じ親が何度出ても1つに畳む', () => {
    expect(parseParentPids('10\n10\n10\n', [10])).toEqual([10])
  })

  /** 聞いていない pid を「実行中」にしない（数え間違いをそのまま見せない）。 */
  it('聞いていない pid は落とす', () => {
    expect(parseParentPids('999\n', [10])).toEqual([])
  })

  /** 警告や空行が混ざりうる。読めない行は黙って飛ばす。 */
  it('読めない行を飛ばす', () => {
    expect(parseParentPids('\nWARNING: something\n10\n', [10])).toEqual([10])
  })

  it('1つも無ければ空', () => {
    expect(parseParentPids('', [10])).toEqual([])
  })
})

describe('queryPidsWithChildren', () => {
  /** 聞く相手が居なければ OS を呼ばずに「どれも実行中ではない」。 */
  it('pid が空なら問い合わせない', async () => {
    await expect(queryPidsWithChildren([], 'win32', {})).resolves.toEqual({
      status: 'known',
      pidsWithChildren: []
    })
  })

  /** v1 の対象は Windows。分からないものは unknown（呼び出し側が尋ねる側に倒す）。 */
  it('Windows 以外では分からないと答える', async () => {
    const outcome = await queryPidsWithChildren([10], 'darwin', {})

    expect(outcome.status).toBe('unknown')
  })

  /*
    PowerShell を絶対パスで指せない環境。名前だけに落として起動することはしない
    ── 落とすと「PATH と作業ディレクトリから解決される powershell.exe」になる。
  */
  it('PowerShell の場所が分からなければ unknown', async () => {
    const outcome = await queryPidsWithChildren([10], 'win32', {})

    expect(outcome.status).toBe('unknown')
  })

  /*
    「分からなかった」を空配列で返さない ── 呼び出し側から
    「何も動いていない」と見分けが付かなくなり、安全な側へ倒せなくなる。
  */
  it('分からないことを「動いていない」と混ぜない', async () => {
    const outcome = await queryPidsWithChildren([10], 'win32', {})

    expect(outcome).not.toEqual({ status: 'known', pidsWithChildren: [] })
  })
})
