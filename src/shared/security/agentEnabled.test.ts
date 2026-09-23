import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_ENABLED, normalizeAgentEnabled, resolveAgentEnabled } from './agentEnabled'

/**
 * FN Agent 全体の ON / OFF（Security Core v1 の STEP9）。
 *
 * 未設定だけが既定の ON。読めない値は OFF。User / Workspace はどちらかが OFF なら OFF。
 */

describe('normalizeAgentEnabled', () => {
  it('未設定は既定の ON', () => {
    expect(DEFAULT_AGENT_ENABLED).toBe(true)
    expect(normalizeAgentEnabled(undefined)).toBe(true)
  })

  it('true / false はそのまま', () => {
    expect(normalizeAgentEnabled(true)).toBe(true)
    expect(normalizeAgentEnabled(false)).toBe(false)
  })

  it('真偽値でない値は OFF（ON へは倒さない）', () => {
    for (const value of ['true', 1, null, {}, [], 'on']) {
      expect(normalizeAgentEnabled(value)).toBe(false)
    }
  })
})

describe('resolveAgentEnabled（strictest）', () => {
  it('両方 ON のときだけ ON', () => {
    expect(resolveAgentEnabled({}, null)).toBe(true)
    expect(resolveAgentEnabled({ agentEnabled: true }, { agentEnabled: true })).toBe(true)
  })

  it('どちらかが OFF なら OFF', () => {
    expect(resolveAgentEnabled({ agentEnabled: false }, { agentEnabled: true })).toBe(false)
    expect(resolveAgentEnabled({ agentEnabled: true }, { agentEnabled: false })).toBe(false)
    expect(resolveAgentEnabled({}, { agentEnabled: false })).toBe(false)
  })

  it('読めない値は OFF として重ねる', () => {
    expect(
      resolveAgentEnabled({ agentEnabled: 'yes' as unknown as boolean }, { agentEnabled: true })
    ).toBe(false)
  })
})
