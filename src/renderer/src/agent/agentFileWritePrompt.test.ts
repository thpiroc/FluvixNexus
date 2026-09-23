import type { AgentFileWriteProposedEvent, ApprovalRequestedEvent } from '@shared/ipc'
import type { SafeFileWriteDiff } from '@shared/security'
import { describe, expect, it } from 'vitest'
import { diffLineMark, isSameWorkspacePath, matchAgentFileWrite } from './agentFileWritePrompt'

/**
 * 承認の画面を出してよいかの判断（Security Core v1 の STEP7）。
 *
 * 固定したいのは**取り違えないこと。** 見た Diff と、承認される変更が違えば、
 * 承認そのものに意味が無くなる。
 */

const DIFF: SafeFileWriteDiff = Object.freeze({
  lines: Object.freeze([
    Object.freeze({ kind: 'added' as const, oldLine: null, newLine: 1, text: 'a' })
  ]),
  addedCount: 1,
  removedCount: 0,
  truncated: false,
  secretMasked: false
})

function proposal(
  overrides: Partial<AgentFileWriteProposedEvent> = {}
): AgentFileWriteProposedEvent {
  return {
    proposalId: 'p1',
    workspacePath: 'src/app.ts',
    newFile: false,
    diff: DIFF,
    ...overrides
  }
}

function approval(overrides: Partial<ApprovalRequestedEvent> = {}): ApprovalRequestedEvent {
  return {
    approvalId: '11111111-1111-4111-8111-111111111111',
    actionKind: 'file.write',
    subject: 'src/app.ts',
    workspacePath: 'src/app.ts',
    commandSummary: null,
    expiresAt: 0,
    ...overrides
  }
}

describe('揃うまで出さない', () => {
  it('提案だけでは出さない', () => {
    expect(matchAgentFileWrite(proposal(), null)).toEqual({ kind: 'waiting' })
  })

  it('承認の知らせだけでは出さない', () => {
    expect(matchAgentFileWrite(null, approval())).toEqual({ kind: 'waiting' })
  })

  it('どちらも無ければ出さない', () => {
    expect(matchAgentFileWrite(null, null)).toEqual({ kind: 'waiting' })
  })

  it('Terminal の承認はこの画面の対象ではない', () => {
    expect(matchAgentFileWrite(proposal(), approval({ actionKind: 'terminal.run' }))).toEqual({
      kind: 'waiting'
    })
  })
})

describe('揃ったら出す', () => {
  it('Main が発番した承認の識別子を、そのまま持つ', () => {
    const match = matchAgentFileWrite(proposal(), approval())

    expect(match.kind === 'ready' && match.prompt.approvalId).toBe(
      '11111111-1111-4111-8111-111111111111'
    )
  })

  it('画面に出すのは、提案に載っていた Path と Diff', () => {
    const match = matchAgentFileWrite(proposal({ newFile: true }), approval())

    expect(match.kind === 'ready' && match.prompt).toMatchObject({
      proposalId: 'p1',
      workspacePath: 'src/app.ts',
      newFile: true,
      diff: DIFF
    })
  })
})

describe('取り違えたら出さずに取り消す', () => {
  it('別の Path を指していたら mismatch', () => {
    const match = matchAgentFileWrite(proposal(), approval({ workspacePath: 'other.ts' }))

    expect(match).toEqual({
      kind: 'mismatch',
      approvalId: '11111111-1111-4111-8111-111111111111'
    })
  })

  it('承認の知らせに Path が無ければ mismatch', () => {
    expect(matchAgentFileWrite(proposal(), approval({ workspacePath: null })).kind).toBe('mismatch')
  })
})

describe('切られた Path の照合', () => {
  it('同じなら一致', () => {
    expect(isSameWorkspacePath('src/app.ts', 'src/app.ts')).toBe(true)
  })

  it('Main が末尾を切っていても、頭から一致していれば一致', () => {
    expect(isSameWorkspacePath('src/very/long/pa…', 'src/very/long/path/to/file.ts')).toBe(true)
  })

  it('切られていないのに違えば、別の変更', () => {
    expect(isSameWorkspacePath('src/app.ts', 'src/other.ts')).toBe(false)
  })

  it('切られた跡があっても、頭が違えば別の変更', () => {
    expect(isSameWorkspacePath('lib/very/long/p…', 'src/very/long/path.ts')).toBe(false)
  })

  it('印だけの Path は一致にしない', () => {
    expect(isSameWorkspacePath('…', 'src/app.ts')).toBe(false)
  })

  it('null は一致にしない', () => {
    expect(isSameWorkspacePath(null, 'src/app.ts')).toBe(false)
  })
})

describe('行の印', () => {
  it('色に頼らず読み分けられる', () => {
    expect(diffLineMark('added')).toBe('+')
    expect(diffLineMark('removed')).toBe('-')
    expect(diffLineMark('context')).toBe(' ')
  })
})
