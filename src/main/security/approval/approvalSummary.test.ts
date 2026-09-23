import { describe, expect, it } from 'vitest'
import { SECRET_MASK } from '../secret/secretMasking'
import type { NormalizedApprovalAction } from './approvalAction'
import {
  approvalSafeSummary,
  APPROVAL_SUBJECT_MAX_LENGTH,
  APPROVAL_TRUNCATION_MARK,
  describeTerminalCommand
} from './approvalSummary'

/**
 * 承認の画面と記録に出してよい要約（Security Core v1 の STEP6）。
 *
 * **Secret がそのまま画面・Native の確認・Audit Log へ出ないこと。**
 * 表示用の文字列と、binding に使う fingerprint が別物であること。
 */

function fileWrite(canonicalRelativePath: string, content = ''): NormalizedApprovalAction {
  return {
    kind: 'file.write',
    target: { canonicalRelativePath } as never,
    canonicalRelativePath,
    content
  }
}

function terminalRun(
  command: string,
  args: readonly string[] = [],
  cwd = ''
): NormalizedApprovalAction {
  return { kind: 'terminal.run', command, args, cwd }
}

describe('File Write', () => {
  it('Workspace 相対の対象だけを出す', () => {
    expect(approvalSafeSummary(fileWrite('src/example.ts', 'export const a = 1\n'))).toEqual({
      actionKind: 'file.write',
      subject: 'src/example.ts',
      workspacePath: 'src/example.ts',
      commandSummary: null
    })
  })

  it('書き込む本文は要約のどこにも入らない', () => {
    const content = 'const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyz"'
    const summary = approvalSafeSummary(fileWrite('src/a.ts', content))

    expect(JSON.stringify(summary)).not.toContain('ghp_')
    expect(JSON.stringify(summary)).not.toContain('const token')
  })
})

describe('Terminal', () => {
  it('コマンド名と、引数を並べた1行を出す', () => {
    expect(approvalSafeSummary(terminalRun('npm', ['test']))).toEqual({
      actionKind: 'terminal.run',
      subject: 'npm',
      workspacePath: null,
      commandSummary: 'npm test',
      commandName: 'npm',
      commandArgs: ['test'],
      secretMasked: false
    })
  })

  it('cwd は Workspace 相対のまま出す（root は null）', () => {
    expect(approvalSafeSummary(terminalRun('npm', ['test'], 'packages/app')).workspacePath).toBe(
      'packages/app'
    )
    expect(approvalSafeSummary(terminalRun('npm', ['test'], '')).workspacePath).toBeNull()
  })

  it('空白を含む引数は囲んで出す（1つと2つを見分けられるように）', () => {
    expect(approvalSafeSummary(terminalRun('git', ['commit', '-m', 'a b'])).commandSummary).toBe(
      'git commit -m "a b"'
    )
  })

  it('コマンドに混ざった Secret を必ず伏せる', () => {
    const summary = approvalSafeSummary(
      terminalRun('npm', ['publish', '--token', 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'])
    )

    expect(summary.commandSummary).not.toContain('ghp_0123456789')
    expect(summary.commandSummary).toContain(SECRET_MASK)
    expect(summary.commandSummary).toContain('npm publish --token')
  })

  it('コマンド名そのものが Secret に見える場合も伏せる', () => {
    const summary = terminalSummary(terminalRun('sk-ant-api03-abcdefghijklmnopqrstuvwx'))

    expect(summary.subject).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')
    expect(summary.commandName).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')
  })

  it('引数ごとに伏せる（数と並びは変わらない）', () => {
    const summary = terminalSummary(
      terminalRun('npm', ['publish', '--token', 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'])
    )

    expect(summary.commandArgs).toEqual(['publish', '--token', SECRET_MASK])
    expect(summary.secretMasked).toBe(true)
  })

  it('別の引数に分かれた Secret も、まとめて探して伏せる', () => {
    const token = 'abcdEFGH1234ijklMNOP5678qrstUVWX'
    const summary = terminalSummary(
      terminalRun('curl', ['-H', 'Authorization: Bearer', token, 'https://example.com'])
    )

    expect(JSON.stringify(summary)).not.toContain(token)
    expect(summary.commandArgs).toHaveLength(4)
    expect(summary.commandArgs[3]).toBe('https://example.com')
  })

  it('空の引数も数に入り、見分けられる', () => {
    const summary = terminalSummary(terminalRun('git', ['commit', '-m', '']))

    expect(summary.commandArgs).toEqual(['commit', '-m', ''])
    expect(summary.commandSummary).toBe('git commit -m ""')
  })

  it('Native Dialog の本文は引数を1つずつ、番号付きで省略せずに並べる', () => {
    const detail = describeTerminalCommand(
      terminalSummary(terminalRun('git', ['commit', '-m', 'a "b" c', ''], 'packages/app'))
    )

    expect(detail).toBe(
      [
        'コマンド: git',
        '引数（4 個）:',
        '  [1] commit',
        '  [2] -m',
        '  [3] a "b" c',
        '  [4] （空の引数）',
        '場所: packages/app',
        'シェルを通さずに、この形のまま1回だけ実行します。'
      ].join('\n')
    )
  })

  it('Native Dialog の本文にも Secret は出ず、伏せたことを知らせる', () => {
    const detail = describeTerminalCommand(
      terminalSummary(terminalRun('npm', ['--token', 'ghp_0123456789abcdefghijklmnopqrstuvwxyz']))
    )

    expect(detail).not.toContain('ghp_0123456789')
    expect(detail).toContain('場所: Workspace のルート')
    expect(detail).toContain('伏せてあります')
  })
})

function terminalSummary(
  action: NormalizedApprovalAction
): Extract<ReturnType<typeof approvalSafeSummary>, { readonly actionKind: 'terminal.run' }> {
  const summary = approvalSafeSummary(action)

  if (summary.actionKind !== 'terminal.run') {
    throw new Error('terminal.run の要約ではない')
  }

  return summary
}

describe('長さ', () => {
  it('対象名は上限で切り、切った跡を残す', () => {
    const summary = approvalSafeSummary(fileWrite(`src/${'a'.repeat(400)}.ts`))

    expect(summary.subject.length).toBeLessThanOrEqual(APPROVAL_SUBJECT_MAX_LENGTH)
    expect(summary.subject.endsWith(APPROVAL_TRUNCATION_MARK)).toBe(true)
  })

  it('Terminal のコマンドは切らない（STEP8。全体 2,000 文字までは省略せずに見せる）', () => {
    const args = Array.from({ length: 60 }, (_, index) => `argument-${index}`)
    const summary = terminalSummary(terminalRun('npm', args))

    expect(summary.commandSummary).toBe(['npm', ...args].join(' '))
    expect(summary.commandSummary).not.toContain(APPROVAL_TRUNCATION_MARK)
    expect(summary.commandArgs).toEqual(args)
  })

  it('cwd も受け付ける上限（256 文字）まで切らない', () => {
    const cwd = `src/${'a'.repeat(200)}`

    expect(approvalSafeSummary(terminalRun('npm', [], cwd)).workspacePath).toBe(cwd)
  })

  it('切った端で文字が割れない', () => {
    const summary = approvalSafeSummary(fileWrite(`src/${'あ'.repeat(400)}.ts`))

    expect([...summary.subject].every((character) => character !== '�')).toBe(true)
  })
})

describe('凍結', () => {
  it('受け取った側が書き換えても効かない', () => {
    const summary = approvalSafeSummary(terminalRun('npm', ['test']))

    expect(Object.isFrozen(summary)).toBe(true)
  })
})
