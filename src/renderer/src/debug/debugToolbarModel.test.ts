import { describe, expect, it } from 'vitest'
import type { DebugProfile, DebugSessionStatus } from '@shared/debug'
import {
  DEBUG_TOOLBAR_ACTIONS,
  canRunDebugToolbarAction,
  debugControlOutcomeKey,
  debugProfileRejectionKey,
  debugProfileValidationKey,
  debugStartOutcomeKey,
  draftFromDebugProfileForm,
  formFromDebugProfile
} from './debugToolbarModel'

describe('Debug Toolbar の状態行列', () => {
  const matrix: Readonly<Record<DebugSessionStatus, readonly string[]>> = {
    unavailable: [],
    idle: ['start'],
    starting: [],
    running: ['pause', 'stop'],
    stopped: ['continue', 'stepOver', 'stepInto', 'stepOut', 'stop'],
    terminating: []
  }

  for (const [status, enabled] of Object.entries(matrix) as readonly [
    DebugSessionStatus,
    readonly string[]
  ][]) {
    it(`${status} で押せるものだけを有効にする`, () => {
      const states = Object.fromEntries(
        DEBUG_TOOLBAR_ACTIONS.map((action) => [
          action.id,
          canRunDebugToolbarAction(action.id, status, true)
        ])
      )

      expect(
        Object.entries(states)
          .filter(([, value]) => value)
          .map(([id]) => id)
      ).toEqual(enabled)
    })
  }

  it('Profile が未選択なら idle でも Start できない', () => {
    expect(canRunDebugToolbarAction('start', 'idle', false)).toBe(false)
  })
})

describe('Debug Profile form', () => {
  const profile: DebugProfile = {
    profileId: 'dp-12345678-1234-1234-1234-123456789abc',
    name: 'Node launch',
    language: 'node',
    programRelativePath: 'src/app.ts',
    programArgs: ['--port', '3000'],
    env: { FLUVIX_MODE: 'debug', FEATURE: 'on' },
    stopOnEntry: true
  }

  it('Profile から編集フォームへ変換しても safe な6欄だけを持つ', () => {
    expect(formFromDebugProfile(profile)).toEqual({
      name: 'Node launch',
      language: 'node',
      programRelativePath: 'src/app.ts',
      programArgsText: '--port\n3000',
      envText: 'FLUVIX_MODE=debug\nFEATURE=on',
      stopOnEntry: true
    })
  })

  it('フォームから draft を作るが shell 文字列として分割しない', () => {
    const result = draftFromDebugProfileForm({
      name: 'Python',
      language: 'python',
      programRelativePath: 'tools/run.py',
      programArgsText: '--name Alice\n--literal && stay-one-arg',
      envText: 'APP_ENV=dev\nTOKEN=value=with=equals',
      stopOnEntry: false
    })

    expect(result).toEqual({
      status: 'ok',
      draft: {
        name: 'Python',
        language: 'python',
        programRelativePath: 'tools/run.py',
        programArgs: ['--name Alice', '--literal && stay-one-arg'],
        env: { APP_ENV: 'dev', TOKEN: 'value=with=equals' },
        stopOnEntry: false
      }
    })
  })

  it('環境変数の行が NAME=value でなければ IPC へ送らない', () => {
    expect(
      draftFromDebugProfileForm({
        name: 'Invalid',
        language: 'node',
        programRelativePath: 'src/app.ts',
        programArgsText: '',
        envText: 'BROKEN',
        stopOnEntry: false
      })
    ).toEqual({ status: 'invalid-env-line' })
  })
})

describe('Debug Toolbar のメッセージ key', () => {
  it('Profile validation と rejection を safe な文言 key に畳む', () => {
    expect(debugProfileValidationKey('programRelativePath', 'outside-workspace')).toBe(
      'debug.profile.validation.programRelativePath'
    )
    expect(debugProfileRejectionKey('profile-not-found')).toBe(
      'debug.profile.rejection.profileNotFound'
    )
  })

  it('Start / control の outcome を safe な文言 key に畳む', () => {
    expect(debugStartOutcomeKey({ status: 'started' })).toBe('debug.operation.started')
    expect(debugStartOutcomeKey({ status: 'failed', reason: 'adapter-unavailable' })).toBe(
      'debug.operation.failed.adapterUnavailable'
    )
    expect(
      debugControlOutcomeKey({ status: 'rejected', reason: 'invalid-state', state: 'running' })
    ).toBe('debug.operation.rejected.invalidState')
    expect(debugControlOutcomeKey({ status: 'failed', reason: 'timeout', state: 'stopped' })).toBe(
      'debug.operation.failed.timeout'
    )
  })
})
