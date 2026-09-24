import { describe, expect, it } from 'vitest'
import type { SafeTerminalOutput } from '../security/terminalRun'
import {
  AGENT_TERMINAL_LINE_MAX_CHARS,
  AGENT_TERMINAL_TAIL_LINES,
  digest,
  retryClassOf,
  runAgentTool,
  type AgentToolbox
} from './agentTools'

/**
 * Action → Security Core の入口 → Context へ入れる形（Security Core v1 の STEP9）。
 */

function output(text: string, overrides: Partial<SafeTerminalOutput> = {}): SafeTerminalOutput {
  return {
    text,
    truncated: false,
    secretMasked: false,
    maskedCount: 0,
    categories: [],
    withheld: false,
    ...overrides
  }
}

describe('Terminal の要約（最大 1,000,000 文字をそのまま送らない）', () => {
  it('末尾の行と、その前のエラー・警告らしい行だけを残す', () => {
    const lines = [
      'start',
      'error TS2304: Cannot find name x',
      ...Array.from({ length: 500 }, (_, index) => `progress ${index}`),
      'Tests: 3 failed'
    ]
    const text = digest(output(lines.join('\n')))

    expect(text).toContain('error TS2304')
    expect(text).toContain('Tests: 3 failed')
    expect(text).not.toContain('progress 0\n')
    expect(text.split('\n').length).toBeLessThanOrEqual(AGENT_TERMINAL_TAIL_LINES + 25)
  })

  it('1行は切る', () => {
    const text = digest(output('a'.repeat(5_000)))

    expect(text).toContain(`${'a'.repeat(AGENT_TERMINAL_LINE_MAX_CHARS)}…`)
    expect(text).not.toContain('a'.repeat(AGENT_TERMINAL_LINE_MAX_CHARS + 1))
  })

  it('検査できなかった出力は渡さない', () => {
    expect(digest(output('', { withheld: true }))).toContain('withheld')
  })
})

describe('再試行の扱い', () => {
  it('利用者の拒否・Security の deny は二度と実行しない', () => {
    for (const reason of [
      'user-cancelled',
      'agent-stopped',
      'read-only-mode',
      'secret-file',
      'outside-workspace',
      'hard-link-write',
      'aliased-target',
      'unsafe-batch-argument',
      'verify-failed'
    ] as const) {
      expect(retryClassOf(reason)).toBe('blocked')
    }
  })

  it('ファイルの競合は読み直し、一時的な失敗は再試行', () => {
    expect(retryClassOf('existing-file-changed')).toBe('refresh')
    expect(retryClassOf('target-changed')).toBe('refresh')
    expect(retryClassOf('spawn-failed')).toBe('retryable')
    expect(retryClassOf('side-effect-in-progress')).toBe('retryable')
  })

  it('知らない理由は blocked（再試行を許す側へ倒さない）', () => {
    expect(retryClassOf('unknown-action')).toBe('blocked')
  })
})

describe('Security Core の入口へ渡すもの', () => {
  it('Action の欄だけを渡す（承認済み・確認済みにあたる引数は無い）', async () => {
    const received: unknown[] = []
    const toolbox = {
      runCommand: async (request: unknown) => {
        received.push(request)
        return { ok: false as const, reason: 'user-cancelled' as const, output: null }
      },
      writeFile: async (path: unknown, content: unknown) => {
        received.push({ path, content })
        return { ok: false as const, reason: 'user-cancelled' as const }
      }
    } as unknown as AgentToolbox

    await runAgentTool(toolbox, { type: 'terminal_run', command: 'npm', args: ['test'], cwd: '' })
    await runAgentTool(toolbox, { type: 'file_write', path: 'a.txt', content: 'x' })

    expect(received).toEqual([
      { command: 'npm', args: ['test'], cwd: '' },
      { path: 'a.txt', content: 'x' }
    ])
  })

  it('作業の signal は、副作用のある File Write / Terminal へだけ渡す', async () => {
    const signals: { readonly tool: string; readonly signal: unknown }[] = []
    const toolbox = {
      runCommand: async (_request: unknown, signal: unknown) => {
        signals.push({ tool: 'runCommand', signal })
        return { ok: false as const, reason: 'agent-stopped' as const, output: null }
      },
      writeFile: async (_path: unknown, _content: unknown, signal: unknown) => {
        signals.push({ tool: 'writeFile', signal })
        return { ok: false as const, reason: 'agent-stopped' as const }
      },
      readFile: async (...args: unknown[]) => {
        signals.push({ tool: 'readFile', signal: args.length })
        return { ok: false as const, reason: 'not-found' as const }
      }
    } as unknown as AgentToolbox
    const { signal } = new AbortController()

    await runAgentTool(
      toolbox,
      { type: 'terminal_run', command: 'npm', args: ['test'], cwd: '' },
      signal
    )
    await runAgentTool(toolbox, { type: 'file_write', path: 'a.txt', content: 'x' }, signal)
    await runAgentTool(
      toolbox,
      { type: 'file_read', path: 'a.txt', startLine: null, endLine: null },
      signal
    )

    expect(signals).toEqual([
      { tool: 'runCommand', signal },
      { tool: 'writeFile', signal },
      // Read 系は読むだけで承認も無いため、signal を受け取らない（引数は path と範囲だけ）。
      { tool: 'readFile', signal: 2 }
    ])
  })

  it('拒否は error として、次にどうすべきかを添えて返す', async () => {
    const toolbox = {
      readFile: async () => ({ ok: false as const, reason: 'secret-file' as const })
    } as unknown as AgentToolbox

    const result = await runAgentTool(toolbox, {
      type: 'file_read',
      path: '.env',
      startLine: null,
      endLine: null
    })

    expect(result).toMatchObject({ status: 'denied', reason: 'secret-file' })
    expect(result.context.category).toBe('error')
    expect(result.context.header).toContain('reason: secret-file')
    expect(result.context.detail).toContain('Do not propose this same action again')
  })
})
