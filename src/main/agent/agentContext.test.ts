import { describe, expect, it } from 'vitest'
import { decideExternalSend } from '../security/externalSend/externalSendDecision'
import { SECRET_MASK } from '../security/secret/secretMasking'
import {
  AGENT_CONTEXT_INPUT_RATIO,
  AGENT_CONTEXT_MAX_ENTRIES,
  agentInstruction,
  createAgentContext,
  estimateTokens,
  type AgentContextBuildInput
} from './agentContext'

/**
 * Context Manager（FN Engine v1 の最小版。Security Core v1 の STEP9）。
 *
 * - 入力は Context Window の約 70% まで
 * - 超えたら「古い Terminal → 古い読み取り → 解決済みのエラー → 重複」の順に畳む
 * - 指示・直近の結果・未解決のエラー・承認の結果は残す
 * - 伏せる前の Secret を持たない
 * - 決定論的（別の AI を呼ばない）
 */

const BUILD: AgentContextBuildInput = {
  providerId: 'fn-scripted-dev',
  permissionMode: 'ask',
  loopsUsed: 0,
  loopLimit: 20
}

const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * 指示文と指示 'x' の分に、extra Token を足した入力がちょうど Budget になる Context Window。
 * 指示文の長さが変わってもテストの前提が崩れないように、見積もりから逆算する。
 */
function windowFor(extra: number): number {
  const fixed = estimateTokens(agentInstruction(BUILD)) + estimateTokens('x')

  return Math.ceil((fixed + extra) / AGENT_CONTEXT_INPUT_RATIO)
}

function texts(context: ReturnType<typeof createAgentContext>): string[] {
  const built = context.build(BUILD)

  if (!built.ok) {
    throw new Error('expected the context to fit')
  }

  return built.request.items.map((item) => item.text)
}

describe('組み立て', () => {
  it('指示文と利用者の指示を先頭に置き、External Send Gate の形になっている', () => {
    const context = createAgentContext('READMEを直して', 32_000)
    const built = context.build(BUILD)

    if (!built.ok) {
      throw new Error('expected ok')
    }

    expect(built.request.providerId).toBe('fn-scripted-dev')
    expect(built.request.items.map((item) => item.kind)).toEqual([
      'agent-instruction',
      'user-prompt'
    ])
    expect(built.request.items[1].text).toBe('READMEを直して')
    expect(built.budgetTokens).toBe(Math.floor(32_000 * AGENT_CONTEXT_INPUT_RATIO))
    expect(decideExternalSend({ permissionMode: 'ask' }, built.request).decision).toBe('allow')
  })

  it('指示文に Permission と残りの回数が入る', () => {
    const context = createAgentContext('x', 32_000)
    const built = context.build({ ...BUILD, permissionMode: 'read', loopsUsed: 5 })

    if (!built.ok) {
      throw new Error('expected ok')
    }

    expect(built.request.items[0].text).toContain('Permission: read')
    expect(built.request.items[0].text).toContain('Turns used: 5 of 20')
  })

  it('Tool の結果は、伏せ直してから持つ（Mask 前のものを持たない）', () => {
    const context = createAgentContext('x', 32_000)

    context.add(1, {
      category: 'terminal',
      label: 'terminal_run npm',
      header: 'action: terminal_run\nstatus: ok',
      detail: `token=${TOKEN}`
    })

    const joined = texts(context).join('\n')

    expect(joined).not.toContain(TOKEN)
    expect(joined).toContain(SECRET_MASK)
  })
})

describe('Budget（約 70%）', () => {
  it('Token の見積もりは保守的（ASCII 3 文字で 1・それ以外は 1 文字で 1）', () => {
    expect(estimateTokens('abcdef')).toBe(2)
    expect(estimateTokens('日本語')).toBe(3)
    expect(estimateTokens('')).toBe(0)
  })

  it('超えたら古い Terminal の詳細から畳み、直近の結果は残す', () => {
    // 詳細 800 Token の結果が2つ ＋ 見出し。1つ畳めば入る大きさ。
    const context = createAgentContext('x', windowFor(1_300))
    const long = 'x'.repeat(2_400)

    context.add(1, {
      category: 'terminal',
      label: 'old',
      header: 'action: terminal_run\nstatus: ok',
      detail: long
    })
    context.add(2, {
      category: 'read',
      label: 'read',
      header: 'action: file_read\nstatus: ok',
      detail: 'short'
    })
    context.add(3, {
      category: 'terminal',
      label: 'new',
      header: 'action: terminal_run\nstatus: ok',
      detail: long
    })

    const all = texts(context)

    expect(
      all.some((text) => text.startsWith('[#1 turn 1]') && text.includes('details omitted'))
    ).toBe(true)
    // 直近の結果（#3）は詳細まで残る。
    expect(all.some((text) => text.startsWith('[#3 turn 3]') && text.includes(long))).toBe(true)
    // 読み取り（#2）は Terminal より後の段なので、まだ畳まれていない。
    expect(all.some((text) => text.startsWith('[#2 turn 2]') && text.includes('short'))).toBe(true)
  })

  it('畳む順番は Terminal → 読み取り → 解決済みのエラー → 重複', () => {
    // 詳細 800 Token が3つ。2つ畳めば入り、3つ目（解決済みのエラー）は畳まずに済む。
    const context = createAgentContext('x', windowFor(1_300))
    const long = 'y'.repeat(2_400)

    context.add(1, {
      category: 'error',
      label: 'e',
      header: 'action: file_write\nstatus: denied',
      detail: long,
      key: 'file:a'
    })
    context.add(2, {
      category: 'read',
      label: 'r',
      header: 'action: file_read\nstatus: ok',
      detail: long
    })
    context.add(3, {
      category: 'terminal',
      label: 't',
      header: 'action: terminal_run\nstatus: ok',
      detail: long
    })
    context.add(4, {
      category: 'write',
      label: 'w',
      header: 'action: file_write\nstatus: ok',
      detail: 'ok',
      key: 'file:a'
    })

    context.resolve('file:a')

    const all = texts(context)
    const compressed = (id: number): boolean =>
      all.some((text) => text.startsWith(`[#${id} `) && text.includes('details omitted'))

    expect(compressed(3)).toBe(true)
    expect(compressed(2)).toBe(true)
    // Terminal と読み取りを畳めば入るので、解決済みのエラー（#1）はまだ畳まれない。
    expect(compressed(1)).toBe(false)
  })

  it('未解決のエラーは、他を畳み終えるまで残す', () => {
    const context = createAgentContext('x', windowFor(600))

    context.add(1, {
      category: 'error',
      label: 'e',
      header: 'action: file_read\nstatus: denied\nreason: secret-file',
      detail: 'advice: do not retry'
    })
    context.add(2, {
      category: 'read',
      label: 'r',
      header: 'action: file_read\nstatus: ok',
      detail: 'z'.repeat(3_000)
    })
    context.add(3, {
      category: 'status',
      label: 's',
      header: 'action: workspace_status\nstatus: ok',
      detail: 'git: ready'
    })

    const all = texts(context)

    // 古い読み取り（#2）は畳まれ、未解決のエラー（#1）の詳細は残る。
    expect(all.some((text) => text.startsWith('[#2 ') && text.includes('details omitted'))).toBe(
      true
    )
    expect(all.some((text) => text.includes('advice: do not retry'))).toBe(true)
  })

  it('畳んでも入らなければ送らない（context-budget-exceeded）', () => {
    const context = createAgentContext('p'.repeat(5_000), 1_000)

    expect(context.build(BUILD)).toEqual({ ok: false, reason: 'context-budget-exceeded' })
  })

  it('同じ入力なら同じ結果（決定論的）', () => {
    const make = (): string[] => {
      const context = createAgentContext('x', windowFor(1_500))

      for (let turn = 1; turn <= 6; turn += 1) {
        context.add(turn, {
          category: 'terminal',
          label: `t${turn}`,
          header: `action: terminal_run\nstatus: ok`,
          detail: 'w'.repeat(1_200)
        })
      }

      return texts(context)
    }

    expect(make()).toEqual(make())
  })
})

describe('件数（External Send Gate の上限より手前で畳む）', () => {
  it('件数が増えたら、畳んだ結果を1つの要約へまとめる', () => {
    const context = createAgentContext('x', 200_000)

    for (let turn = 1; turn <= AGENT_CONTEXT_MAX_ENTRIES + 20; turn += 1) {
      context.add(turn, {
        category: 'status',
        label: 's',
        header: `action: workspace_status\nstatus: ok`,
        detail: `turn ${turn}`
      })
    }

    const built = context.build(BUILD)

    if (!built.ok) {
      throw new Error('expected ok')
    }

    expect(built.request.items.length).toBeLessThanOrEqual(AGENT_CONTEXT_MAX_ENTRIES + 3)
    expect(built.request.items.some((item) => item.label === 'history-summary')).toBe(true)
    expect(decideExternalSend({ permissionMode: 'ask' }, built.request).decision).toBe('allow')
  })
})
