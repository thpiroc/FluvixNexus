import { describe, expect, it } from 'vitest'
import { SECRET_MASK } from '../secret/secretMasking'
import type { NormalizedApprovalAction } from './approvalAction'
import {
  approvalSafeSummary,
  APPROVAL_COMMAND_SUMMARY_MAX_LENGTH,
  APPROVAL_SUBJECT_MAX_LENGTH,
  APPROVAL_TRUNCATION_MARK
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
      commandSummary: 'npm test'
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
    const summary = approvalSafeSummary(terminalRun('sk-ant-api03-abcdefghijklmnopqrstuvwx'))

    expect(summary.subject).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')
  })
})

describe('長さ', () => {
  it('対象名は上限で切り、切った跡を残す', () => {
    const summary = approvalSafeSummary(fileWrite(`src/${'a'.repeat(400)}.ts`))

    expect(summary.subject.length).toBeLessThanOrEqual(APPROVAL_SUBJECT_MAX_LENGTH)
    expect(summary.subject.endsWith(APPROVAL_TRUNCATION_MARK)).toBe(true)
  })

  it('コマンドの1行も上限で切る', () => {
    const summary = approvalSafeSummary(
      terminalRun(
        'npm',
        Array.from({ length: 60 }, () => 'argument')
      )
    )

    expect(summary.commandSummary).not.toBeNull()
    expect(summary.commandSummary?.length ?? 0).toBeLessThanOrEqual(
      APPROVAL_COMMAND_SUMMARY_MAX_LENGTH
    )
    expect(summary.commandSummary?.endsWith(APPROVAL_TRUNCATION_MARK)).toBe(true)
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
