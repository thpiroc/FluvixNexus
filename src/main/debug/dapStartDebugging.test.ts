import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_CONFIGURATION_KEYS,
  validateDapStartDebuggingArguments,
  type DebugChildSessionPolicy
} from './dapStartDebugging'

/**
 * `startDebugging` の検証（Session 6-15A）。
 *
 * 通すのは「Main が決めた type の launch で、target の id を持つもの」だけで、子の `launch` へは
 * 作り直した4欄しか渡らないことを見る。
 */

const POLICY: DebugChildSessionPolicy = {
  launchType: 'pwa-node',
  targetIdKey: '__pendingTargetId'
}

function launch(configuration: Record<string, unknown>): unknown {
  return { request: 'launch', configuration }
}

describe('validateDapStartDebuggingArguments', () => {
  it('accepts a launch for the root type and rebuilds the configuration', () => {
    const result = validateDapStartDebuggingArguments(
      launch({
        type: 'pwa-node',
        name: 'main.js [worker]',
        request: 'launch',
        __pendingTargetId: 'd3b8a1f0-42',
        sourceMaps: true,
        skipFiles: ['<node_internals>/**']
      }),
      POLICY
    )

    expect(result).toEqual({
      status: 'accepted',
      configuration: {
        type: 'pwa-node',
        name: 'main.js [worker]',
        request: 'launch',
        __pendingTargetId: 'd3b8a1f0-42'
      },
      targetId: 'd3b8a1f0-42',
      name: 'main.js [worker]',
      droppedFieldCount: 2
    })
  })

  it('fills the request and a name when the adapter omits them', () => {
    expect(
      validateDapStartDebuggingArguments(
        launch({ type: 'pwa-node', __pendingTargetId: 't1' }),
        POLICY
      )
    ).toMatchObject({
      status: 'accepted',
      configuration: { type: 'pwa-node', name: 'child', request: 'launch', __pendingTargetId: 't1' }
    })
  })

  it('collapses control characters and bounds the name', () => {
    const result = validateDapStartDebuggingArguments(
      launch({ type: 'pwa-node', __pendingTargetId: 't1', name: `a\u0000\nb${'c'.repeat(300)}` }),
      POLICY
    )

    expect(result.status).toBe('accepted')
    if (result.status === 'accepted') {
      expect(result.name.startsWith('a b')).toBe(true)
      expect(result.name).toHaveLength(200)
    }
  })

  it.each([
    ['a non-object body', 'launch', 'malformed'],
    ['null', null, 'malformed'],
    ['an array', [], 'malformed'],
    [
      'a missing request',
      { configuration: { type: 'pwa-node', __pendingTargetId: 't1' } },
      'malformed'
    ],
    [
      'attach',
      { request: 'attach', configuration: { type: 'pwa-node', __pendingTargetId: 't1' } },
      'attach-not-allowed'
    ],
    [
      'attach inside the configuration',
      launch({ type: 'pwa-node', request: 'attach', __pendingTargetId: 't1' }),
      'attach-not-allowed'
    ],
    [
      'an unknown request',
      { request: 'restart', configuration: { type: 'pwa-node', __pendingTargetId: 't1' } },
      'unknown-request'
    ],
    [
      'an unknown request inside the configuration',
      launch({ type: 'pwa-node', request: 'test', __pendingTargetId: 't1' }),
      'unknown-request'
    ],
    ['a missing configuration', { request: 'launch' }, 'malformed'],
    ['an array configuration', { request: 'launch', configuration: [] }, 'malformed'],
    ['another type', launch({ type: 'node-terminal', __pendingTargetId: 't1' }), 'unknown-type'],
    ['a missing type', launch({ __pendingTargetId: 't1' }), 'unknown-type'],
    ['a missing target id', launch({ type: 'pwa-node' }), 'invalid-target'],
    ['an empty target id', launch({ type: 'pwa-node', __pendingTargetId: '' }), 'invalid-target'],
    [
      'a target id with a path',
      launch({ type: 'pwa-node', __pendingTargetId: 'C:\\evil' }),
      'invalid-target'
    ],
    [
      'a too long target id',
      launch({ type: 'pwa-node', __pendingTargetId: 'x'.repeat(129) }),
      'invalid-target'
    ],
    ['a numeric target id', launch({ type: 'pwa-node', __pendingTargetId: 42 }), 'invalid-target']
  ])('rejects %s', (_name, args, reason) => {
    expect(validateDapStartDebuggingArguments(args, POLICY)).toEqual({
      status: 'rejected',
      reason
    })
  })

  it.each(FORBIDDEN_CONFIGURATION_KEYS)('rejects a configuration that carries "%s"', (key) => {
    expect(
      validateDapStartDebuggingArguments(
        launch({ type: 'pwa-node', __pendingTargetId: 't1', [key]: 'calc.exe' }),
        POLICY
      )
    ).toEqual({ status: 'rejected', reason: 'forbidden-field' })
  })

  it('rejects forbidden keys regardless of case', () => {
    expect(
      validateDapStartDebuggingArguments(
        launch({ type: 'pwa-node', __pendingTargetId: 't1', RuntimeExecutable: 'calc.exe' }),
        POLICY
      )
    ).toEqual({ status: 'rejected', reason: 'forbidden-field' })
  })

  it('reads only own properties (a prototype cannot supply the type or the target)', () => {
    const configuration = Object.create({ type: 'pwa-node', __pendingTargetId: 't1' }) as Record<
      string,
      unknown
    >

    expect(validateDapStartDebuggingArguments(launch(configuration), POLICY)).toEqual({
      status: 'rejected',
      reason: 'unknown-type'
    })
  })

  it('does not let __proto__ in the body change the rebuilt configuration', () => {
    const args = JSON.parse(
      '{"request":"launch","configuration":{"type":"pwa-node","__pendingTargetId":"t1","__proto__":{"cwd":"C:/"}}}'
    ) as unknown
    const result = validateDapStartDebuggingArguments(args, POLICY)

    expect(result.status).toBe('accepted')
    if (result.status === 'accepted') {
      expect(Object.keys(result.configuration).sort()).toEqual([
        '__pendingTargetId',
        'name',
        'request',
        'type'
      ])
      expect((result.configuration as { cwd?: unknown }).cwd).toBeUndefined()
    }
  })

  it('uses the target id key from the policy', () => {
    expect(
      validateDapStartDebuggingArguments(launch({ type: 'mock', targetId: 'abc' }), {
        launchType: 'mock',
        targetIdKey: 'targetId'
      })
    ).toMatchObject({ status: 'accepted', configuration: { targetId: 'abc' } })
  })
})
