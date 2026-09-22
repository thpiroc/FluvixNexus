import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySettingsSections, type SettingsSections } from '@shared/settings'

/**
 * 今効いている Security Policy（Security Core v1 の STEP1）。
 *
 * store（Electron に依存する薄い層）だけを差し替え、**毎回読み直すこと**・
 * **引数から値を受け取らないこと**・**読めなければ Read**を確かめる。
 */

const state = vi.hoisted(() => ({
  user: null as SettingsSections | null,
  workspace: null as SettingsSections | null,
  fail: false,
  reads: 0
}))

vi.mock('../../store/settings', () => ({
  readUserSettingsSections: (): SettingsSections => {
    state.reads += 1

    if (state.fail) {
      throw new Error('store is not available')
    }

    return state.user as SettingsSections
  },
  readWorkspaceSettingsSnapshot: () =>
    state.workspace === null
      ? null
      : { workspaceId: 'ws-a', displayName: 'project-a', sections: state.workspace }
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const { getCurrentSecurityPolicy } = await import('./currentSecurityPolicy')

function sections(security: SettingsSections['security']): SettingsSections {
  return { ...emptySettingsSections(), security }
}

beforeEach(() => {
  state.user = emptySettingsSections()
  state.workspace = null
  state.fail = false
  state.reads = 0
})

describe('getCurrentSecurityPolicy', () => {
  it('何も設定されていなければ Ask', () => {
    expect(getCurrentSecurityPolicy()).toEqual({ permissionMode: 'ask' })
  })

  it('User / Workspace の strictest', () => {
    state.user = sections({ permissionMode: 'read' })
    state.workspace = sections({ permissionMode: 'ask' })
    expect(getCurrentSecurityPolicy().permissionMode).toBe('read')

    state.user = sections({ permissionMode: 'ask' })
    state.workspace = sections({ permissionMode: 'read' })
    expect(getCurrentSecurityPolicy().permissionMode).toBe('read')

    state.workspace = sections({ permissionMode: 'ask' })
    expect(getCurrentSecurityPolicy().permissionMode).toBe('ask')
  })

  it('呼ぶたびに store を読み直す（前の Policy を持ち回さない）', () => {
    state.user = sections({ permissionMode: 'ask' })
    expect(getCurrentSecurityPolicy().permissionMode).toBe('ask')

    state.user = sections({ permissionMode: 'read' })
    expect(getCurrentSecurityPolicy().permissionMode).toBe('read')

    // Workspace を開いた・切り替えた直後も、次の呼び出しから効く。
    state.user = sections({ permissionMode: 'ask' })
    state.workspace = sections({ permissionMode: 'read' })
    expect(getCurrentSecurityPolicy().permissionMode).toBe('read')

    expect(state.reads).toBe(3)
  })

  it('store が読めなければ Read（既定の Ask へは倒さない）', () => {
    state.fail = true

    const policy = getCurrentSecurityPolicy()

    expect(policy).toEqual({ permissionMode: 'read' })
    expect(Object.isFrozen(policy)).toBe(true)
  })

  it('引数を取らない ── 呼び手（Agent / FN Engine / Renderer の写し）の値では決まらない', () => {
    expect(getCurrentSecurityPolicy.length).toBe(0)

    state.user = sections({ permissionMode: 'read' })
    const call = getCurrentSecurityPolicy as (...args: unknown[]) => unknown

    expect(call({ permissionMode: 'ask' }, { permissionMode: 'ask' })).toEqual({
      permissionMode: 'read'
    })
  })

  it('返した Policy を書き換えても、次の呼び出しには効かない', () => {
    state.user = sections({ permissionMode: 'read' })

    const policy = getCurrentSecurityPolicy()

    expect(() => {
      ;(policy as { permissionMode: string }).permissionMode = 'ask'
    }).toThrow(TypeError)
    expect(getCurrentSecurityPolicy().permissionMode).toBe('read')
  })
})
