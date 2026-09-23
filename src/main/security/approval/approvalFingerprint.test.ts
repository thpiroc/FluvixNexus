import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import type { NormalizedApprovalAction } from './approvalAction'
import { approvalFingerprint } from './approvalFingerprint'

/**
 * 承認と実行を結び付ける fingerprint（Security Core v1 の STEP6）。
 *
 * **「file.write が承認済み」という汎用の印にならないこと。** 承認したときと
 * 違うもの（別のファイル・書き換えられた本文・別のコマンド・別の引数・別の cwd）が
 * 同じ fingerprint を名乗れないこと。
 */

function fileWrite(canonicalRelativePath: string, content: string): NormalizedApprovalAction {
  return {
    kind: 'file.write',
    // fingerprint は target のオブジェクトを読まない（綴りと本文だけを見る）。
    target: { canonicalRelativePath } as never,
    canonicalRelativePath,
    content
  }
}

function terminalRun(command: string, args: readonly string[], cwd = ''): NormalizedApprovalAction {
  return { kind: 'terminal.run', command, args, cwd }
}

describe('File Write', () => {
  it('同じ対象と同じ本文なら、毎回同じ値になる', () => {
    const first = approvalFingerprint(fileWrite('src/app.ts', 'export const a = 1\n'))
    const second = approvalFingerprint(fileWrite('src/app.ts', 'export const a = 1\n'))

    expect(first).not.toBeNull()
    expect(first).toBe(second)
  })

  it('SHA-256 の hex（64 文字）になる', () => {
    expect(approvalFingerprint(fileWrite('a.txt', 'x'))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('対象が違えば別の値になる', () => {
    expect(approvalFingerprint(fileWrite('src/app.ts', 'x'))).not.toBe(
      approvalFingerprint(fileWrite('src/other.ts', 'x'))
    )
  })

  it('本文が1文字でも違えば別の値になる', () => {
    expect(approvalFingerprint(fileWrite('a.txt', 'hello'))).not.toBe(
      approvalFingerprint(fileWrite('a.txt', 'hellO'))
    )
    expect(approvalFingerprint(fileWrite('a.txt', 'hello'))).not.toBe(
      approvalFingerprint(fileWrite('a.txt', 'hello '))
    )
  })

  it('空の本文も値になる（本文が無いことと、対象が違うことを混ぜない）', () => {
    expect(approvalFingerprint(fileWrite('a.txt', ''))).not.toBe(
      approvalFingerprint(fileWrite('b.txt', ''))
    )
  })

  it('本文は先に畳んでから材料にする（材料に本文そのものが現れない）', () => {
    const content = 'API_KEY=A1b2C3d4E5f6G7h8'
    const value = approvalFingerprint(fileWrite('a.txt', content))
    const contentDigest = createHash('sha256').update(content, 'utf8').digest('hex')

    expect(value).not.toBe(contentDigest)
    expect(value).not.toContain(contentDigest)
  })
})

describe('Terminal', () => {
  it('同じ command / args / cwd なら、毎回同じ値になる', () => {
    expect(approvalFingerprint(terminalRun('npm', ['run', 'test'], 'app'))).toBe(
      approvalFingerprint(terminalRun('npm', ['run', 'test'], 'app'))
    )
  })

  it('command が違えば別の値になる', () => {
    expect(approvalFingerprint(terminalRun('npm', ['test']))).not.toBe(
      approvalFingerprint(terminalRun('npx', ['test']))
    )
  })

  it('引数が違えば別の値になる', () => {
    expect(approvalFingerprint(terminalRun('npm', ['test']))).not.toBe(
      approvalFingerprint(terminalRun('npm', ['publish']))
    )
    expect(approvalFingerprint(terminalRun('npm', ['test']))).not.toBe(
      approvalFingerprint(terminalRun('npm', ['test', '--force']))
    )
  })

  it('cwd が違えば別の値になる', () => {
    expect(approvalFingerprint(terminalRun('npm', ['test'], ''))).not.toBe(
      approvalFingerprint(terminalRun('npm', ['test'], 'packages/app'))
    )
  })

  it('引数の区切り方を変えても、同じ値にはならない', () => {
    /*
      材料を素につなぐ形（join）では、これらが同じ文字列になってしまう。
      「バイト数 ＋ 値」で区切っているため、別の値になる。
    */
    expect(approvalFingerprint(terminalRun('npm', ['a b']))).not.toBe(
      approvalFingerprint(terminalRun('npm', ['a', 'b']))
    )
    expect(approvalFingerprint(terminalRun('npm', ['a:b', 'c']))).not.toBe(
      approvalFingerprint(terminalRun('npm', ['a', 'b:c']))
    )
    expect(approvalFingerprint(terminalRun('npm', ['a\nb']))).not.toBe(
      approvalFingerprint(terminalRun('npm', ['a', 'b']))
    )
  })

  it('cwd を引数へずらしても、同じ値にはならない', () => {
    expect(approvalFingerprint(terminalRun('npm', ['test'], 'app'))).not.toBe(
      approvalFingerprint(terminalRun('npm', ['test', 'app'], ''))
    )
  })
})

describe('種類をまたげない', () => {
  it('File Write と Terminal は、材料が同じでも別の値になる', () => {
    expect(approvalFingerprint(fileWrite('npm', ''))).not.toBe(
      approvalFingerprint(terminalRun('npm', []))
    )
  })
})

describe('作れなければ null', () => {
  it('材料を読めない操作は null（呼び出し側が拒否する材料になる）', () => {
    const broken = {
      kind: 'terminal.run',
      command: 'npm',
      get args(): readonly string[] {
        throw new Error('boom')
      },
      cwd: ''
    } as unknown as NormalizedApprovalAction

    expect(approvalFingerprint(broken)).toBeNull()
  })
})
