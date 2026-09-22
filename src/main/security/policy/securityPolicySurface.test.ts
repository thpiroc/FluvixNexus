import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import * as sharedSecurity from '@shared/security'
import * as decisionModule from './securityDecision'
import * as policyModule from './securityPolicy'

/**
 * Security Core を無効化・迂回・上書きする API が無いこと（Security Core v1 の STEP1。DESIGN.md §6.3）。
 *
 * 公開する名前を**一覧で固定**する。名前を足すときはこのテストも書き換えることになり、
 * そこで「それは Security を緩める口ではないか」を見直す機会が必ず生まれる。
 */

vi.mock('../../store/settings', () => ({
  readUserSettingsSections: () => {
    throw new Error('not used in this test')
  },
  readWorkspaceSettingsSnapshot: () => null
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const policyApi = await import('./index')

/** Security を緩める・止める口に見える名前。 */
const FORBIDDEN_NAME =
  /disable|bypass|override|skip|unsafe|allowAll|trust|force|setPolicy|setSecurity|setPermission|mutate|patch|reset|elevate|grant|unlock/i

const POLICY_DIRECTORY = join(__dirname)

describe('公開する名前', () => {
  it('Policy API の入口は2つの関数と操作の一覧だけ', () => {
    expect(Object.keys(policyApi).sort()).toEqual([
      'SECURITY_ACTION_KINDS',
      'decideSecurityAction',
      'getCurrentSecurityPolicy'
    ])
  })

  it('内部の module も、決めた名前しか公開しない', () => {
    expect(Object.keys(policyModule).sort()).toEqual([
      'FAIL_CLOSED_SECURITY_POLICY',
      'resolveSecurityPolicy'
    ])
    expect(Object.keys(decisionModule).sort()).toEqual([
      'SECURITY_ACTION_KINDS',
      'decideSecurityAction'
    ])
    expect(Object.keys(sharedSecurity).sort()).toEqual([
      'AGENT_PERMISSION_MODES',
      'DEFAULT_AGENT_PERMISSION_MODE',
      'FAIL_CLOSED_AGENT_PERMISSION_MODE',
      'isAgentPermissionMode',
      'normalizeAgentPermissionMode',
      'resolveAgentPermissionMode',
      'restrictSecuritySettings',
      'strictestAgentPermissionMode'
    ])
  })

  it('無効化・迂回・上書きにあたる名前が1つも無い', () => {
    const names = [
      ...Object.keys(policyApi),
      ...Object.keys(policyModule),
      ...Object.keys(decisionModule),
      ...Object.keys(sharedSecurity)
    ]

    expect(names.filter((name) => FORBIDDEN_NAME.test(name))).toEqual([])
  })

  it('policy フォルダのどのファイルも、そうした名前を export していない', () => {
    const sources = readdirSync(POLICY_DIRECTORY).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
    )

    expect(sources.sort()).toEqual([
      'currentSecurityPolicy.ts',
      'index.ts',
      'securityDecision.ts',
      'securityPolicy.ts'
    ])

    for (const name of sources) {
      const exported = readFileSync(join(POLICY_DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(exported.filter((line) => FORBIDDEN_NAME.test(line))).toEqual([])
    }
  })

  it('公開している定数は凍結されている', () => {
    expect(Object.isFrozen(policyApi.SECURITY_ACTION_KINDS)).toBe(true)
    expect(Object.isFrozen(policyModule.FAIL_CLOSED_SECURITY_POLICY)).toBe(true)
  })
})

describe('Renderer から届く経路', () => {
  /*
    STEP1 では Renderer から Security Core へ直接届く IPC は無い。Permission を変えられるのは
    `settings:save-section`（Main が read / ask 以外を拒む）だけで、判定や Policy そのものを
    渡す口は作らない。承認用の IPC を足す STEP（Approval Manager）でこのテストを見直す。
  */
  it('Security / Policy / Permission / 承認を名乗る IPC チャンネルは無い', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]
    const pattern = /security|policy|permission|approv|agent/i

    expect(channels.filter((channel) => pattern.test(channel))).toEqual([])
  })
})
