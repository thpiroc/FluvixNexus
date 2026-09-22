import { describe, expect, it } from 'vitest'
import {
  AGENT_PERMISSION_MODES,
  DEFAULT_AGENT_PERMISSION_MODE,
  FAIL_CLOSED_AGENT_PERMISSION_MODE,
  isAgentPermissionMode,
  normalizeAgentPermissionMode,
  resolveAgentPermissionMode,
  restrictSecuritySettings,
  strictestAgentPermissionMode
} from './permissionMode'

/**
 * FN Agent の Permission（Security Core v1 の STEP1）。
 *
 * `read` = 読み取り専用、`ask` = 副作用のある操作を操作ごとに承認して実行できる。
 * Security としては `read` の方が厳しい。
 */

describe('Permission の値', () => {
  it('v1 の Permission は read / ask の2つだけ（auto は無い）', () => {
    expect([...AGENT_PERMISSION_MODES]).toEqual(['read', 'ask'])
    expect(isAgentPermissionMode('auto')).toBe(false)
  })

  it('既定は ask、読めない値の落とし先は read', () => {
    expect(DEFAULT_AGENT_PERMISSION_MODE).toBe('ask')
    expect(FAIL_CLOSED_AGENT_PERMISSION_MODE).toBe('read')
  })
})

describe('normalizeAgentPermissionMode', () => {
  it('未設定（undefined）だけが既定の ask になる', () => {
    expect(normalizeAgentPermissionMode(undefined)).toBe('ask')
  })

  it('read / ask はそのまま', () => {
    expect(normalizeAgentPermissionMode('read')).toBe('read')
    expect(normalizeAgentPermissionMode('ask')).toBe('ask')
  })

  it('auto・知らない値・読み替えられそうな値は read（安全側）', () => {
    for (const raw of ['auto', 'allow', 'none', 'off', 'ASK', 'Ask', ' ask', 'ask ', 'Read', '']) {
      expect(normalizeAgentPermissionMode(raw)).toBe('read')
    }
  })

  it('文字列でない値は read（null も既定へは戻さない）', () => {
    for (const raw of [null, 0, 1, true, false, {}, [], ['ask'], { mode: 'ask' }, NaN]) {
      expect(normalizeAgentPermissionMode(raw)).toBe('read')
    }
  })
})

describe('strictest 合成', () => {
  it('Ask + Ask → Ask', () => {
    expect(strictestAgentPermissionMode('ask', 'ask')).toBe('ask')
  })

  it('Ask + Read → Read', () => {
    expect(strictestAgentPermissionMode('ask', 'read')).toBe('read')
  })

  it('Read + Ask → Read', () => {
    expect(strictestAgentPermissionMode('read', 'ask')).toBe('read')
  })

  it('Read + Read → Read', () => {
    expect(strictestAgentPermissionMode('read', 'read')).toBe('read')
  })
})

describe('resolveAgentPermissionMode（User / Workspace）', () => {
  it('User Ask + Workspace Ask → Ask', () => {
    expect(resolveAgentPermissionMode({ permissionMode: 'ask' }, { permissionMode: 'ask' })).toBe(
      'ask'
    )
  })

  it('User Ask + Workspace Read → Read', () => {
    expect(resolveAgentPermissionMode({ permissionMode: 'ask' }, { permissionMode: 'read' })).toBe(
      'read'
    )
  })

  it('User Read + Workspace Ask → Read（Workspace から緩められない）', () => {
    expect(resolveAgentPermissionMode({ permissionMode: 'read' }, { permissionMode: 'ask' })).toBe(
      'read'
    )
  })

  it('User Read + Workspace Read → Read', () => {
    expect(resolveAgentPermissionMode({ permissionMode: 'read' }, { permissionMode: 'read' })).toBe(
      'read'
    )
  })

  it('どちらも未設定なら既定の Ask', () => {
    expect(resolveAgentPermissionMode({}, {})).toBe('ask')
    expect(resolveAgentPermissionMode(undefined, null)).toBe('ask')
  })

  it('Workspace の上書きが無ければ User がそのまま効く', () => {
    expect(resolveAgentPermissionMode({ permissionMode: 'read' }, null)).toBe('read')
    expect(resolveAgentPermissionMode({ permissionMode: 'read' }, {})).toBe('read')
    expect(resolveAgentPermissionMode({ permissionMode: 'ask' }, undefined)).toBe('ask')
  })

  it('User 未設定（既定 Ask）でも、Workspace で Read にできる', () => {
    expect(resolveAgentPermissionMode({}, { permissionMode: 'read' })).toBe('read')
  })

  it('どちらか一方でも読めない値なら Read', () => {
    expect(resolveAgentPermissionMode({ permissionMode: 'auto' }, { permissionMode: 'ask' })).toBe(
      'read'
    )
    expect(resolveAgentPermissionMode({ permissionMode: 'ask' }, { permissionMode: 'auto' })).toBe(
      'read'
    )
    expect(resolveAgentPermissionMode({ permissionMode: 'ask' }, { permissionMode: 'ALLOW' })).toBe(
      'read'
    )
  })

  it('User / Workspace のどの組み合わせでも、User より緩くならない', () => {
    const values = [undefined, 'read', 'ask', 'auto', 'x']
    const rank = { read: 0, ask: 1 } as const

    for (const user of values) {
      for (const workspace of values) {
        const effective = resolveAgentPermissionMode(
          { permissionMode: user },
          { permissionMode: workspace }
        )
        const userOnly = resolveAgentPermissionMode({ permissionMode: user }, null)

        expect(rank[effective]).toBeLessThanOrEqual(rank[userOnly])
      }
    }
  })
})

describe('restrictSecuritySettings（section の形のまま重ねる）', () => {
  it('Workspace の上書きが無ければ、User の section を同じ object のまま返す', () => {
    const user = { permissionMode: 'read' }

    expect(restrictSecuritySettings(user, undefined)).toBe(user)
    expect(restrictSecuritySettings(user, {})).toBe(user)
  })

  it('上書きがあれば、厳しい方を正規化した値で持つ', () => {
    expect(restrictSecuritySettings({ permissionMode: 'read' }, { permissionMode: 'ask' })).toEqual(
      {
        permissionMode: 'read'
      }
    )
    expect(restrictSecuritySettings({}, { permissionMode: 'read' })).toEqual({
      permissionMode: 'read'
    })
    expect(restrictSecuritySettings({ permissionMode: 'ask' }, { permissionMode: 'ask' })).toEqual({
      permissionMode: 'ask'
    })
  })
})
