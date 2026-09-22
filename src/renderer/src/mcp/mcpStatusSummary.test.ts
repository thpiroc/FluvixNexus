import { describe, expect, it } from 'vitest'
import type {
  McpConfigProblem,
  McpConnectionFailure,
  McpConnectionStatus,
  McpConnectionTestResult
} from '@shared/mcp'
import { canTestConnection, summarizeMcpStatus, summarizeTestResult } from './mcpStatusSummary'

/**
 * 接続の状態を1行にまとめる（mcpStatusSummary.ts）。
 *
 * ここで確かめたいのは見た目ではなく**対応表**にほかならない ──
 * 「無効なのに秘密の値の話が出る」「秘密の値が読めなくなったのに『繋がりました』が
 * 残る」のような取り違えは、この表の誤りとして現れる。
 */

const TESTED_AT = '2026-09-21T00:00:00.000Z'

function statusWith(overrides: Partial<McpConnectionStatus> = {}): McpConnectionStatus {
  return {
    connectionId: 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e',
    configured: true,
    problems: [],
    enabled: true,
    testing: false,
    lastTest: null,
    ...overrides
  }
}

describe('summarizeMcpStatus', () => {
  it('まだ読めていなければ、何も言わない', () => {
    expect(summarizeMcpStatus(null)).toEqual({
      tone: 'busy',
      messageKey: 'settings.mcp.status.loading'
    })
  })

  it('設定が揃っていて、まだ試していなければ ready', () => {
    expect(summarizeMcpStatus(statusWith())).toEqual({
      tone: 'ready',
      messageKey: 'settings.mcp.status.ready'
    })
  })

  it('無効は attention ではなく disabled として出す', () => {
    const summary = summarizeMcpStatus(
      statusWith({ enabled: false, configured: false, problems: ['disabled'] })
    )

    expect(summary).toEqual({ tone: 'disabled', messageKey: 'settings.mcp.status.disabled' })
  })

  /* 足りないものは、利用者の次の一手ごとに言い回しが違う。 */
  it('足りないものごとに、別の言い回しを出す', () => {
    const cases: readonly [McpConfigProblem, string][] = [
      ['node-not-found', 'settings.mcp.status.nodeNotFound'],
      ['server-not-installed', 'settings.mcp.status.serverNotInstalled'],
      ['command-not-found', 'settings.mcp.status.commandNotFound'],
      ['arguments-unsupported', 'settings.mcp.status.argumentsUnsupported'],
      ['secret-missing', 'settings.mcp.status.secretMissing']
    ]

    for (const [problem, messageKey] of cases) {
      expect(summarizeMcpStatus(statusWith({ configured: false, problems: [problem] }))).toEqual({
        tone: 'attention',
        messageKey
      })
    }
  })

  it('試している間は、直近の結果より今の動きを先に出す', () => {
    const summary = summarizeMcpStatus(
      statusWith({
        testing: true,
        lastTest: {
          outcome: 'connected',
          testedAt: TESTED_AT,
          server: { name: null, version: null },
          protocolVersion: '2025-06-18',
          tools: []
        }
      })
    )

    expect(summary).toEqual({ tone: 'busy', messageKey: 'settings.mcp.status.testing' })
  })

  /*
    ここが一番大事 ── 繋がった後に秘密の値が読めなくなった場合。
    古い「繋がりました」を出し続けると、消えていないように見える。
  */
  it('繋がった後に設定が足りなくなったら、古い結果より足りないものを先に出す', () => {
    const summary = summarizeMcpStatus(
      statusWith({
        configured: false,
        problems: ['secret-missing'],
        lastTest: {
          outcome: 'connected',
          testedAt: TESTED_AT,
          server: { name: 'github-mcp-server', version: '1.0.0' },
          protocolVersion: '2025-06-18',
          tools: []
        }
      })
    )

    expect(summary).toEqual({ tone: 'attention', messageKey: 'settings.mcp.status.secretMissing' })
  })

  it('設定が揃っているなら、直近の結末を出す', () => {
    const summary = summarizeMcpStatus(
      statusWith({
        lastTest: { outcome: 'failed', testedAt: TESTED_AT, failure: 'timeout' }
      })
    )

    expect(summary).toEqual({ tone: 'failed', messageKey: 'settings.mcp.failure.timeout' })
  })
})

describe('summarizeTestResult', () => {
  it('繋がったら connected', () => {
    const result: McpConnectionTestResult = {
      outcome: 'connected',
      testedAt: TESTED_AT,
      server: { name: 'github-mcp-server', version: '1.0.0' },
      protocolVersion: '2025-06-18',
      tools: []
    }

    expect(summarizeTestResult(result)).toEqual({
      tone: 'connected',
      messageKey: 'settings.mcp.status.connected'
    })
  })

  it('繋がらなかった理由ごとに、別の言い回しを出す', () => {
    const failures: readonly McpConnectionFailure[] = [
      'spawn-failed',
      'timeout',
      'server-exited',
      'protocol-error',
      'unsupported-protocol',
      'rejected'
    ]
    const seen = new Set<string>()

    for (const failure of failures) {
      const summary = summarizeTestResult({ outcome: 'failed', testedAt: TESTED_AT, failure })

      expect(summary.tone).toBe('failed')
      seen.add(summary.messageKey)
    }

    /* 理由を分けた意味が無くならないよう、言い回しも全部違う。 */
    expect(seen.size).toBe(failures.length)
  })

  it('理由が1つも無い not-configured でも、何か言う', () => {
    expect(
      summarizeTestResult({ outcome: 'not-configured', testedAt: TESTED_AT, problems: [] })
    ).toEqual({ tone: 'attention', messageKey: 'settings.mcp.status.notConfigured' })
  })
})

describe('押せるかどうか', () => {
  it('接続テストは、有効で、試していないときだけ押せる', () => {
    expect(canTestConnection(statusWith())).toBe(true)
    expect(canTestConnection(statusWith({ enabled: false }))).toBe(false)
    expect(canTestConnection(statusWith({ testing: true }))).toBe(false)
    expect(canTestConnection(null)).toBe(false)
  })

  /*
    秘密の値が無くても押せる ── 押した結果が「秘密の値がありません」で、
    それが利用者の次の一手そのものになる。
  */
  it('秘密の値が無くても接続テストは押せる', () => {
    const status = statusWith({ configured: false, problems: ['secret-missing'] })

    expect(canTestConnection(status)).toBe(true)
  })
})
