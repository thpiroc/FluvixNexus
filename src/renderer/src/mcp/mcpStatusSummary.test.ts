import { describe, expect, it } from 'vitest'
import type {
  McpConfigProblem,
  McpConnectionFailure,
  McpConnectionStatus,
  McpConnectionTestResult
} from '@shared/mcp'
import {
  canClearStoredSecret,
  canTestConnection,
  secretSourceKey,
  summarizeMcpStatus,
  summarizeTestResult
} from './mcpStatusSummary'

/**
 * 接続の状態を1行にまとめる（mcpStatusSummary.ts）。
 *
 * ここで確かめたいのは見た目ではなく**対応表**にほかならない ──
 * 「無効なのに token の話が出る」「token を消したのに『繋がりました』が
 * 残る」のような取り違えは、この表の誤りとして現れる。
 */

const TESTED_AT = '2026-09-21T00:00:00.000Z'

function statusWith(overrides: Partial<McpConnectionStatus> = {}): McpConnectionStatus {
  return {
    connectionId: 'notion',
    configured: true,
    problems: [],
    enabled: true,
    secret: { source: 'stored', canStore: true },
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
      ['token-missing', 'settings.mcp.status.tokenMissing'],
      ['token-invalid', 'settings.mcp.status.tokenInvalid'],
      ['node-not-found', 'settings.mcp.status.nodeNotFound'],
      ['server-not-installed', 'settings.mcp.status.serverNotInstalled'],
      // 利用者が足したサーバー（§21.10）
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
    ここが一番大事 ── 繋がった後に token を消した場合。
    古い「繋がりました」を出し続けると、消えていないように見える。
  */
  it('繋がった後に設定が足りなくなったら、古い結果より足りないものを先に出す', () => {
    const summary = summarizeMcpStatus(
      statusWith({
        configured: false,
        problems: ['token-missing'],
        secret: { source: 'none', canStore: true },
        lastTest: {
          outcome: 'connected',
          testedAt: TESTED_AT,
          server: { name: 'Notion API', version: '2.5.1' },
          protocolVersion: '2025-06-18',
          tools: []
        }
      })
    )

    expect(summary).toEqual({ tone: 'attention', messageKey: 'settings.mcp.status.tokenMissing' })
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
      server: { name: 'Notion API', version: '2.5.1' },
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

describe('secretSourceKey', () => {
  it('在り処ごとに、別の言い回しを出す', () => {
    const keys = [
      secretSourceKey('stored'),
      secretSourceKey('environment'),
      secretSourceKey('none')
    ]

    expect(new Set(keys).size).toBe(3)
  })
})

describe('押せるかどうか', () => {
  it('消せるのは、この PC に保存されている token だけ', () => {
    expect(canClearStoredSecret(statusWith())).toBe(true)

    /* 環境変数の token は、このアプリが消せるものではない。 */
    expect(
      canClearStoredSecret(statusWith({ secret: { source: 'environment', canStore: true } }))
    ).toBe(false)
    expect(canClearStoredSecret(statusWith({ secret: { source: 'none', canStore: true } }))).toBe(
      false
    )
    expect(canClearStoredSecret(null)).toBe(false)
  })

  it('接続テストは、有効で、試していないときだけ押せる', () => {
    expect(canTestConnection(statusWith())).toBe(true)
    expect(canTestConnection(statusWith({ enabled: false }))).toBe(false)
    expect(canTestConnection(statusWith({ testing: true }))).toBe(false)
    expect(canTestConnection(null)).toBe(false)
  })

  /*
    token が無くても押せる ── 押した結果が「token がありません」で、
    それが利用者の次の一手そのものになる。
  */
  it('token が無くても接続テストは押せる', () => {
    const status = statusWith({
      configured: false,
      problems: ['token-missing'],
      secret: { source: 'none', canStore: true }
    })

    expect(canTestConnection(status)).toBe(true)
  })
})
