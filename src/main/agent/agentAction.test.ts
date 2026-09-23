import { describe, expect, it } from 'vitest'
import { agentActionKey } from './agentActionKey'
import { AGENT_ACTION_TYPES, parseAgentTurn, type AgentAction } from './agentAction'

/**
 * AI の出力を Action として読む（Runtime Schema Validation。Security Core v1 の STEP9）。
 *
 * AI の自由文は実行しない。閉じた集合の Action 1つだけを、知らない欄を1つも持たない形でだけ
 * 受け付ける。
 */

function actionOf(raw: unknown): AgentAction {
  const parsed = parseAgentTurn(raw)

  if (!parsed.ok) {
    throw new Error(`expected an action, got ${parsed.reason}: ${parsed.problem}`)
  }

  return parsed.action
}

describe('受け付ける形', () => {
  it('v1 の Action は7つだけ（MCP・Git の書き込みは無い）', () => {
    expect([...AGENT_ACTION_TYPES]).toEqual([
      'complete',
      'file_read',
      'file_search',
      'file_write',
      'terminal_run',
      'workspace_list',
      'workspace_status'
    ])
  })

  it('object でも JSON の文字列でも読む', () => {
    expect(actionOf({ action: { type: 'workspace_status' } })).toEqual({ type: 'workspace_status' })
    expect(actionOf('{"action":{"type":"workspace_status"}}')).toEqual({
      type: 'workspace_status'
    })
  })

  it('省略できる欄は既定で埋める', () => {
    expect(actionOf({ action: { type: 'workspace_list' } })).toEqual({
      type: 'workspace_list',
      path: ''
    })
    expect(actionOf({ action: { type: 'file_read', path: 'a.ts' } })).toEqual({
      type: 'file_read',
      path: 'a.ts',
      startLine: null,
      endLine: null
    })
    expect(actionOf({ action: { type: 'terminal_run', command: 'npm' } })).toEqual({
      type: 'terminal_run',
      command: 'npm',
      args: [],
      cwd: ''
    })
  })

  it('File Write は本文をそのまま持つ（空のファイルも書ける）', () => {
    expect(actionOf({ action: { type: 'file_write', path: 'a.txt', content: '' } })).toEqual({
      type: 'file_write',
      path: 'a.txt',
      content: ''
    })
  })
})

describe('実行しない形（invalid-action）', () => {
  it.each([
    ['JSON でない文字列', 'please run rm -rf /'],
    ['object でない', 42],
    ['null', null],
    ['action が無い', { type: 'workspace_status' }],
    ['action 以外の欄がある', { action: { type: 'workspace_status' }, thought: 'x' }],
    ['知らない種類', { action: { type: 'git_push' } }],
    ['MCP の書き込み', { action: { type: 'mcp_write', tool: 'x' } }],
    ['種類が文字列でない', { action: { type: 1 } }],
    [
      '知らない欄（承認済みを名乗る）',
      { action: { type: 'file_write', path: 'a', content: 'x', approved: true } }
    ],
    [
      '知らない欄（Security を飛ばす）',
      { action: { type: 'terminal_run', command: 'npm', skipSecurity: true } }
    ],
    ['知らない欄（shell）', { action: { type: 'terminal_run', command: 'npm', shell: true } }],
    ['パスが無い', { action: { type: 'file_read' } }],
    ['パスが文字列でない', { action: { type: 'file_write', path: ['a'], content: 'x' } }],
    ['本文が文字列でない', { action: { type: 'file_write', path: 'a', content: { text: 'x' } } }],
    ['行番号が 0', { action: { type: 'file_read', path: 'a', startLine: 0 } }],
    ['行番号が小数', { action: { type: 'file_read', path: 'a', startLine: 1.5 } }],
    [
      '終わりが始まりより前',
      { action: { type: 'file_read', path: 'a', startLine: 5, endLine: 2 } }
    ],
    ['検索語が空', { action: { type: 'file_search', query: '   ' } }],
    ['検索語に改行', { action: { type: 'file_search', query: 'a\nb' } }],
    ['引数が配列でない', { action: { type: 'terminal_run', command: 'npm', args: 'test' } }],
    ['引数が文字列でない', { action: { type: 'terminal_run', command: 'npm', args: [1] } }],
    ['回答が空', { action: { type: 'complete', answer: '' } }],
    [
      '本文が上限を超える',
      { action: { type: 'file_write', path: 'a', content: 'x'.repeat(1_000_001) } }
    ]
  ])('%s', (_label, raw) => {
    const parsed = parseAgentTurn(raw)

    expect(parsed.ok).toBe(false)

    if (!parsed.ok) {
      expect(parsed.reason).toBe('invalid-action')
      // AI へ返す説明は固定の文言（AI の出力を映さない）。
      expect(parsed.problem).not.toContain('rm -rf')
    }
  })

  it('prototype の名前は種類として通らない', () => {
    for (const type of ['toString', 'constructor', '__proto__']) {
      expect(parseAgentTurn({ action: { type } }).ok).toBe(false)
    }
  })

  it('取り出しで例外を投げる値でも落ちない', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('boom')
        }
      }
    )

    expect(parseAgentTurn(hostile)).toMatchObject({ ok: false, reason: 'invalid-action' })
  })
})

describe('1ターン1 Action（parallel-action）', () => {
  it('actions に2つ以上あれば、どれも実行しない', () => {
    expect(
      parseAgentTurn({
        actions: [{ type: 'workspace_status' }, { type: 'workspace_list' }]
      })
    ).toMatchObject({ ok: false, reason: 'parallel-action' })
  })

  it('action が配列で2つ以上でも同じ', () => {
    expect(
      parseAgentTurn({ action: [{ type: 'workspace_status' }, { type: 'workspace_status' }] })
    ).toMatchObject({ ok: false, reason: 'parallel-action' })
  })
})

describe('同じ Action の鍵', () => {
  it('同じ場所を別の綴りで指しても同じ鍵', () => {
    const a = actionOf({ action: { type: 'file_write', path: './src\\a.ts', content: 'x' } })
    const b = actionOf({ action: { type: 'file_write', path: 'src/a.ts', content: 'x' } })

    expect(agentActionKey(a)).toBe(agentActionKey(b))
  })

  it('本文・引数・場所が1つでも違えば別の鍵（修正版の提案は出せる）', () => {
    const base = actionOf({ action: { type: 'file_write', path: 'a.ts', content: 'x' } })
    const edited = actionOf({ action: { type: 'file_write', path: 'a.ts', content: 'y' } })
    const joined = actionOf({ action: { type: 'terminal_run', command: 'npm', args: ['a b'] } })
    const split = actionOf({ action: { type: 'terminal_run', command: 'npm', args: ['a', 'b'] } })

    expect(agentActionKey(base)).not.toBe(agentActionKey(edited))
    expect(agentActionKey(joined)).not.toBe(agentActionKey(split))
  })

  it('鍵に本文そのものは入らない', () => {
    const key = agentActionKey(
      actionOf({ action: { type: 'file_write', path: 'a.ts', content: 'SECRET-CONTENT' } })
    )

    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
