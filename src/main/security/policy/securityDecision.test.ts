import { describe, expect, it } from 'vitest'
import {
  decideSecurityAction,
  SECURITY_ACTION_KINDS,
  type FileWriteTargetFacts,
  type SecurityAction,
  type SecurityDecision
} from './securityDecision'
import { resolveSecurityPolicy, type SecurityPolicy } from './securityPolicy'

/**
 * Security Decision の固定の規則（Security Core v1 の STEP1）。
 *
 * Policy（read / ask）で変わるのは「読み取り以外を承認付きで通せるか」だけで、
 * 固定の規則はどちらの Policy でも同じ答えになることを確かめる。
 */

const READ: SecurityPolicy = resolveSecurityPolicy({ permissionMode: 'read' }, null)
const ASK: SecurityPolicy = resolveSecurityPolicy({ permissionMode: 'ask' }, null)
const POLICIES = [READ, ASK] as const

const INSIDE_PLAIN: FileWriteTargetFacts = {
  insideWorkspace: true,
  secretFile: false,
  hardLink: false
}

function decide(policy: SecurityPolicy, action: unknown): SecurityDecision {
  return decideSecurityAction(policy, action as SecurityAction)
}

describe('Permission で変わるもの', () => {
  it('Workspace の中の読み取りは、どちらの Policy でも allow', () => {
    for (const policy of POLICIES) {
      expect(decide(policy, { kind: 'file.read', target: INSIDE_PLAIN })).toEqual({
        verdict: 'allow',
        reason: 'read-allowed'
      })
    }
  })

  it('File Write: Ask なら ask（承認が要る）、Read なら deny', () => {
    expect(decide(ASK, { kind: 'file.write', target: INSIDE_PLAIN })).toEqual({
      verdict: 'ask',
      reason: 'approval-required'
    })
    expect(decide(READ, { kind: 'file.write', target: INSIDE_PLAIN })).toEqual({
      verdict: 'deny',
      reason: 'read-only-mode'
    })
  })

  it('Terminal: Ask なら ask、Read なら deny', () => {
    expect(decide(ASK, { kind: 'terminal.run' })).toEqual({
      verdict: 'ask',
      reason: 'approval-required'
    })
    expect(decide(READ, { kind: 'terminal.run' })).toEqual({
      verdict: 'deny',
      reason: 'read-only-mode'
    })
  })

  it('Ask でも allow になる副作用の操作は1つも無い', () => {
    const sideEffects: unknown[] = [
      { kind: 'file.write', target: INSIDE_PLAIN },
      { kind: 'terminal.run' },
      { kind: 'mcp.write' },
      { kind: 'git.commit' },
      { kind: 'git.push' }
    ]

    for (const action of sideEffects) {
      expect(decide(ASK, action).verdict).not.toBe('allow')
    }
  })
})

describe('固定の規則（Policy に関わらず deny）', () => {
  it('Workspace の外は、読むのも書くのも deny', () => {
    const outside = { insideWorkspace: false, secretFile: false, hardLink: false }

    for (const policy of POLICIES) {
      expect(decide(policy, { kind: 'file.read', target: outside })).toEqual({
        verdict: 'deny',
        reason: 'outside-workspace'
      })
      expect(decide(policy, { kind: 'file.write', target: outside })).toEqual({
        verdict: 'deny',
        reason: 'outside-workspace'
      })
    }
  })

  it('Secret ファイルへの書き込みは deny', () => {
    for (const policy of POLICIES) {
      expect(
        decide(policy, { kind: 'file.write', target: { ...INSIDE_PLAIN, secretFile: true } })
      ).toEqual({ verdict: 'deny', reason: 'secret-file' })
    }
  })

  it('Secret ファイルの読み取りも deny（Context から除く）', () => {
    for (const policy of POLICIES) {
      expect(
        decide(policy, { kind: 'file.read', target: { insideWorkspace: true, secretFile: true } })
      ).toEqual({ verdict: 'deny', reason: 'secret-file' })
    }
  })

  it('hard link を通した書き込みは deny', () => {
    for (const policy of POLICIES) {
      expect(
        decide(policy, { kind: 'file.write', target: { ...INSIDE_PLAIN, hardLink: true } })
      ).toEqual({ verdict: 'deny', reason: 'hard-link-write' })
    }
  })

  it('MCP の書き込み・副作用は常に deny', () => {
    for (const policy of POLICIES) {
      expect(decide(policy, { kind: 'mcp.write' })).toEqual({
        verdict: 'deny',
        reason: 'mcp-write-disabled'
      })
      // Allowlist に載っていると名乗っても、書き込みは書き込み。
      expect(decide(policy, { kind: 'mcp.write', allowlisted: true }).verdict).toBe('deny')
    }
  })

  it('Git の Commit / Push は常に deny', () => {
    for (const policy of POLICIES) {
      for (const kind of ['git.commit', 'git.push']) {
        expect(decide(policy, { kind })).toEqual({ verdict: 'deny', reason: 'git-not-available' })
      }
    }
  })

  it('MCP の読み取りは Allowlist にあるときだけ allow（サーバーの自己申告は見ない）', () => {
    for (const policy of POLICIES) {
      expect(decide(policy, { kind: 'mcp.read', allowlisted: true })).toEqual({
        verdict: 'allow',
        reason: 'mcp-allowlisted-read'
      })

      for (const extra of [
        { allowlisted: false },
        {},
        { allowlisted: 'true' },
        { allowlisted: 1 },
        { readOnlyHint: true },
        { annotations: { readOnlyHint: true } }
      ]) {
        expect(decide(policy, { kind: 'mcp.read', ...extra })).toEqual({
          verdict: 'deny',
          reason: 'mcp-not-allowlisted'
        })
      }
    }
  })
})

describe('知らない操作・欠けた事実は deny', () => {
  it('知らない操作の種類は常に deny', () => {
    for (const policy of POLICIES) {
      for (const kind of [
        'shell.exec',
        'file.delete',
        'git.merge',
        'provider.send',
        'security.disable',
        'FILE.READ',
        '',
        '__proto__',
        'constructor',
        'toString'
      ]) {
        expect(decide(policy, { kind })).toEqual({ verdict: 'deny', reason: 'unknown-action' })
      }
    }
  })

  it('操作として読めない値は deny', () => {
    for (const action of [
      undefined,
      null,
      'file.read',
      42,
      [],
      {},
      { kind: 1 },
      { type: 'git.push' }
    ]) {
      expect(decide(ASK, action)).toEqual({ verdict: 'deny', reason: 'unknown-action' })
    }
  })

  it('Workspace の中かが確かめられていなければ外として扱う', () => {
    for (const target of [
      undefined,
      null,
      {},
      { insideWorkspace: 'true', secretFile: false, hardLink: false },
      { insideWorkspace: 1, secretFile: false, hardLink: false }
    ]) {
      expect(decide(ASK, { kind: 'file.read', target }).reason).toBe('outside-workspace')
      expect(decide(ASK, { kind: 'file.write', target }).reason).toBe('outside-workspace')
    }
  })

  it('Secret / hard link かが確かめられていなければ、該当するものとして扱う', () => {
    expect(
      decide(ASK, { kind: 'file.write', target: { insideWorkspace: true, secretFile: false } })
        .reason
    ).toBe('hard-link-write')
    expect(
      decide(ASK, { kind: 'file.write', target: { insideWorkspace: true, hardLink: false } }).reason
    ).toBe('secret-file')
    expect(decide(ASK, { kind: 'file.read', target: { insideWorkspace: true } }).reason).toBe(
      'secret-file'
    )
  })

  it('余計な欄（force / bypass など）を付けても判定は変わらない', () => {
    const extras = {
      force: true,
      bypass: true,
      override: 'allow',
      approved: true,
      verdict: 'allow'
    }

    expect(decide(READ, { kind: 'file.write', target: INSIDE_PLAIN, ...extras }).verdict).toBe(
      'deny'
    )
    expect(decide(ASK, { kind: 'file.write', target: INSIDE_PLAIN, ...extras }).verdict).toBe('ask')
    expect(decide(ASK, { kind: 'git.push', ...extras }).verdict).toBe('deny')
    expect(decide(ASK, { kind: 'mcp.write', ...extras }).verdict).toBe('deny')
  })
})

describe('Policy として読めない値は Read（Ask へは倒さない）', () => {
  it('Permission が読めない Policy では、書き込みも Terminal も deny', () => {
    const broken: unknown[] = [
      undefined,
      null,
      {},
      { permissionMode: 'auto' },
      { permissionMode: 'ASK' },
      { permissionMode: undefined },
      'ask'
    ]

    for (const policy of broken) {
      const asPolicy = policy as SecurityPolicy

      expect(decideSecurityAction(asPolicy, { kind: 'terminal.run' }).reason).toBe('read-only-mode')
      expect(
        decideSecurityAction(asPolicy, { kind: 'file.write', target: INSIDE_PLAIN }).reason
      ).toBe('read-only-mode')
    }
  })
})

describe('判定の値', () => {
  it('返す判定は凍結されている（受け取った側が書き換えられない）', () => {
    const decision = decide(READ, { kind: 'git.push' })

    expect(Object.isFrozen(decision)).toBe(true)
    expect(() => {
      ;(decision as { verdict: string }).verdict = 'allow'
    }).toThrow(TypeError)
    expect(decide(READ, { kind: 'git.push' }).verdict).toBe('deny')
  })

  it('知っている操作の種類は閉じた集合で、書き換えられない', () => {
    expect([...SECURITY_ACTION_KINDS]).toEqual([
      'file.read',
      'file.write',
      'terminal.run',
      'mcp.read',
      'mcp.write',
      'git.commit',
      'git.push'
    ])
    expect(Object.isFrozen(SECURITY_ACTION_KINDS)).toBe(true)
  })

  it('mode × 操作の種類の全組み合わせで、allow になるのは読み取りだけ', () => {
    const actions: Record<string, unknown> = {
      'file.read': { kind: 'file.read', target: INSIDE_PLAIN },
      'file.write': { kind: 'file.write', target: INSIDE_PLAIN },
      'terminal.run': { kind: 'terminal.run' },
      'mcp.read': { kind: 'mcp.read', allowlisted: true },
      'mcp.write': { kind: 'mcp.write' },
      'git.commit': { kind: 'git.commit' },
      'git.push': { kind: 'git.push' }
    }
    const expected = {
      read: {
        'file.read': 'allow',
        'file.write': 'deny',
        'terminal.run': 'deny',
        'mcp.read': 'allow',
        'mcp.write': 'deny',
        'git.commit': 'deny',
        'git.push': 'deny'
      },
      ask: {
        'file.read': 'allow',
        'file.write': 'ask',
        'terminal.run': 'ask',
        'mcp.read': 'allow',
        'mcp.write': 'deny',
        'git.commit': 'deny',
        'git.push': 'deny'
      }
    } as const

    for (const policy of POLICIES) {
      for (const kind of SECURITY_ACTION_KINDS) {
        expect(decide(policy, actions[kind]).verdict).toBe(expected[policy.permissionMode][kind])
      }
    }
  })
})
