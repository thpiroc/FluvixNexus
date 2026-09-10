import { describe, expect, it } from 'vitest'
import {
  applyDebugSessionTransition,
  transitionDebugSessionState,
  type DebugSessionState
} from './debugSessionState'

describe('debug session state machine', () => {
  it('initial state is idle', () => {
    const initial: DebugSessionState = 'idle'

    expect(initial).toBe('idle')
  })

  it('allows the normal start, stop, and resume path', () => {
    let state: DebugSessionState = 'idle'

    state = applyDebugSessionTransition(state, 'start')
    state = applyDebugSessionTransition(state, 'started')
    state = applyDebugSessionTransition(state, 'stopped')
    state = applyDebugSessionTransition(state, 'continued')

    expect(state).toBe('running')
  })

  it('allows active states to terminate and return to idle', () => {
    for (const state of ['starting', 'running', 'stopped'] satisfies readonly DebugSessionState[]) {
      const terminating = applyDebugSessionTransition(state, 'terminate')

      expect(terminating).toBe('terminating')
      expect(applyDebugSessionTransition(terminating, 'cleanup')).toBe('idle')
    }
  })

  it('rejects invalid transitions', () => {
    expect(transitionDebugSessionState('idle', 'cleanup')).toEqual({
      status: 'invalid',
      from: 'idle',
      transition: 'cleanup'
    })
    expect(() => applyDebugSessionTransition('running', 'start')).toThrow(
      'invalid debug session transition'
    )
  })
})
