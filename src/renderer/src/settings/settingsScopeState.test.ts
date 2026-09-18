import { emptySettingsSections, type SettingsSections } from '@shared/settings'
import { describe, expect, it } from 'vitest'
import {
  planSettingsWrite,
  planWorkspaceReset,
  type ReadySettingsScopeState
} from './settingsScopeState'

/**
 * どの scope のどの section へ書くか（feature/settings-scope）。
 *
 * 画面の見え方ではなく、**Main へ出る保存要求**を確かめる。ここが間違うと、
 * 画面は正しく見えるのに再起動で別の値へ戻る（あるいは別のプロジェクトへ混ざる）。
 */

function sections(partial: Partial<SettingsSections>): SettingsSections {
  return { ...emptySettingsSections(), ...partial }
}

function ready(
  user: Partial<SettingsSections>,
  workspace: Partial<SettingsSections> | null
): ReadySettingsScopeState {
  return {
    status: 'ready',
    user: sections(user),
    workspace:
      workspace === null
        ? null
        : { workspaceId: 'w1', displayName: 'project', sections: sections(workspace) }
  }
}

const TERMINAL_BEFORE = { fontSize: 13, scrollback: 5000 }

describe('planSettingsWrite', () => {
  it('ユーザー設定へは、変わった key だけを重ねて書く', () => {
    const state = ready({ terminal: { scrollback: 8000 } }, null)

    const plan = planSettingsWrite(
      state,
      'terminal',
      { fontSize: 13, scrollback: 8000 },
      { fontSize: 18, scrollback: 8000 },
      'user'
    )

    expect(plan.requests).toEqual([
      { scope: 'user', section: 'terminal', value: { scrollback: 8000, fontSize: 18 } }
    ])
    expect(plan.next.user.terminal).toEqual({ scrollback: 8000, fontSize: 18 })
  })

  it('ワークスペース設定へは、名乗った Workspace に向けて書く', () => {
    const plan = planSettingsWrite(
      ready({}, {}),
      'terminal',
      TERMINAL_BEFORE,
      { ...TERMINAL_BEFORE, fontSize: 20 },
      'workspace'
    )

    expect(plan.requests).toEqual([
      { scope: 'workspace', workspaceId: 'w1', section: 'terminal', value: { fontSize: 20 } }
    ])
    expect(plan.next.user.terminal).toEqual({})
    expect(plan.next.workspace?.sections.terminal).toEqual({ fontSize: 20 })
  })

  it('変わっていなければ何も書かない', () => {
    const state = ready({}, {})
    const plan = planSettingsWrite(state, 'terminal', TERMINAL_BEFORE, TERMINAL_BEFORE, 'auto')

    expect(plan.requests).toEqual([])
    expect(plan.next).toBe(state)
  })

  it('auto は、その key を今決めている scope へ書く', () => {
    const state = ready({}, { terminal: { fontSize: 20 } })

    const plan = planSettingsWrite(
      state,
      'terminal',
      { fontSize: 20, scrollback: 5000 },
      { fontSize: 21, scrollback: 6000 },
      'auto'
    )

    expect(plan.requests).toEqual([
      { scope: 'user', section: 'terminal', value: { scrollback: 6000 } },
      { scope: 'workspace', workspaceId: 'w1', section: 'terminal', value: { fontSize: 21 } }
    ])
  })

  it('Workspace が無いとき・ユーザー設定専用の section では、ワークスペースへ書かない', () => {
    expect(
      planSettingsWrite(
        ready({}, null),
        'terminal',
        TERMINAL_BEFORE,
        { ...TERMINAL_BEFORE, fontSize: 20 },
        'workspace'
      ).requests
    ).toEqual([])

    expect(
      planSettingsWrite(
        ready({}, {}),
        'general',
        { language: 'ja' },
        { language: 'en' },
        'workspace'
      ).requests
    ).toEqual([])

    // auto なら、ユーザー設定専用の section はユーザー設定へ行く。
    expect(
      planSettingsWrite(
        ready({}, { general: { language: 'en' } }),
        'general',
        { language: 'ja' },
        { language: 'en' },
        'auto'
      ).requests
    ).toEqual([{ scope: 'user', section: 'general', value: { language: 'en' } }])
  })
})

describe('planWorkspaceReset', () => {
  it('上書きしていた key だけを消し、ユーザー設定には触れない', () => {
    const state = ready(
      { terminal: { fontSize: 15 } },
      { terminal: { fontSize: 20, scrollback: 900 } }
    )

    const plan = planWorkspaceReset(state, 'terminal', ['fontSize'])

    expect(plan.requests).toEqual([
      { scope: 'workspace', workspaceId: 'w1', section: 'terminal', value: { scrollback: 900 } }
    ])
    expect(plan.next.user).toBe(state.user)
  })

  it('上書きが無ければ何もしない（Workspace が無い場合も）', () => {
    expect(planWorkspaceReset(ready({}, {}), 'terminal', ['fontSize']).requests).toEqual([])
    expect(planWorkspaceReset(ready({}, null), 'terminal', ['fontSize']).requests).toEqual([])
  })
})
