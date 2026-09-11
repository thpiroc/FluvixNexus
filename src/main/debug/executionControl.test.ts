import { describe, expect, it } from 'vitest'
import { DEBUG_EXECUTION_CONTROLS, type DebugSessionState } from '@shared/debug'
import {
  NO_DEBUG_ADAPTER_STOP_CAPABILITIES,
  checkDebugExecutionControl,
  createDapDisconnectArguments,
  createDapExecutionRequest,
  isResumingDebugControl,
  planDebugStop,
  readDebugAdapterStopCapabilities,
  readFirstThreadId,
  readStoppedThreadId
} from './executionControl'

const STATES: readonly DebugSessionState[] = [
  'idle',
  'starting',
  'running',
  'stopped',
  'terminating'
]

const TERMINATE = { supportsTerminateRequest: true, supportTerminateDebuggee: false }

describe('checkDebugExecutionControl', () => {
  it('allows Continue / Step only while stopped, and Pause only while running', () => {
    const allowed = STATES.map((state) => [
      state,
      DEBUG_EXECUTION_CONTROLS.filter(
        (control) => checkDebugExecutionControl(state, control).status === 'allowed'
      )
    ])

    expect(Object.fromEntries(allowed)).toEqual({
      idle: [],
      starting: [],
      running: ['pause'],
      stopped: ['continue', 'stepOver', 'stepInto', 'stepOut'],
      terminating: []
    })
  })

  it('says no-session in idle and invalid-state elsewhere', () => {
    expect(checkDebugExecutionControl('idle', 'continue')).toEqual({
      status: 'rejected',
      reason: 'no-session'
    })

    for (const state of ['starting', 'terminating'] as const) {
      for (const control of DEBUG_EXECUTION_CONTROLS) {
        expect(checkDebugExecutionControl(state, control)).toEqual({
          status: 'rejected',
          reason: 'invalid-state'
        })
      }
    }

    expect(checkDebugExecutionControl('running', 'stepOver').status).toBe('rejected')
    expect(checkDebugExecutionControl('stopped', 'pause').status).toBe('rejected')
  })

  it('does not allow a name outside the closed set, even when forced through', () => {
    for (const state of STATES) {
      expect(checkDebugExecutionControl(state, 'evaluate' as never).status).toBe('rejected')
      expect(checkDebugExecutionControl(state, 'next' as never).status).toBe('rejected')
    }
  })
})

describe('createDapExecutionRequest', () => {
  it('translates app-domain names into the DAP commands', () => {
    expect(
      DEBUG_EXECUTION_CONTROLS.map((control) => createDapExecutionRequest(control, 7).command)
    ).toEqual(['continue', 'pause', 'next', 'stepIn', 'stepOut'])
  })

  it('carries only the thread id', () => {
    for (const control of DEBUG_EXECUTION_CONTROLS) {
      expect(createDapExecutionRequest(control, 3).arguments).toEqual({ threadId: 3 })
    }
  })

  it('treats every control except Pause as resuming', () => {
    expect(DEBUG_EXECUTION_CONTROLS.filter(isResumingDebugControl)).toEqual([
      'continue',
      'stepOver',
      'stepInto',
      'stepOut'
    ])
  })
})

describe('thread ids', () => {
  it('reads the stopped thread when present', () => {
    expect(readStoppedThreadId({ reason: 'breakpoint', threadId: 4 })).toBe(4)
    expect(readStoppedThreadId({ reason: 'pause', allThreadsStopped: true })).toBeNull()
    expect(readStoppedThreadId({ threadId: '4' })).toBeNull()
    expect(readStoppedThreadId({ threadId: 1.5 })).toBeNull()
    expect(readStoppedThreadId(undefined)).toBeNull()
  })

  it('reads the first valid thread of a threads response', () => {
    expect(
      readFirstThreadId({
        threads: [{ id: 'x' }, null, { name: 'no id' }, { id: 9 }, { id: 10 }]
      })
    ).toBe(9)
    expect(readFirstThreadId({ threads: [] })).toBeNull()
    expect(readFirstThreadId({ threads: 'main' })).toBeNull()
    expect(readFirstThreadId(null)).toBeNull()
  })
})

describe('stop capabilities and disconnect', () => {
  it('reads only explicit true values', () => {
    expect(
      readDebugAdapterStopCapabilities({
        supportsTerminateRequest: true,
        supportTerminateDebuggee: 'yes'
      })
    ).toEqual({ supportsTerminateRequest: true, supportTerminateDebuggee: false })
    expect(readDebugAdapterStopCapabilities(undefined)).toEqual(NO_DEBUG_ADAPTER_STOP_CAPABILITIES)
  })

  it('sends terminateDebuggee only to adapters that honor it', () => {
    expect(createDapDisconnectArguments(NO_DEBUG_ADAPTER_STOP_CAPABILITIES)).toEqual({
      restart: false
    })
    expect(
      createDapDisconnectArguments({
        supportsTerminateRequest: false,
        supportTerminateDebuggee: true
      })
    ).toEqual({ restart: false, terminateDebuggee: true })
  })
})

describe('planDebugStop', () => {
  it('has nothing to stop in idle', () => {
    expect(planDebugStop('idle', 'none', TERMINATE)).toBe('no-session')
  })

  it('terminates first when the adapter supports it, otherwise disconnects', () => {
    expect(planDebugStop('running', 'none', TERMINATE)).toBe('terminate')
    expect(planDebugStop('stopped', 'none', TERMINATE)).toBe('terminate')
    expect(planDebugStop('running', 'none', NO_DEBUG_ADAPTER_STOP_CAPABILITIES)).toBe('disconnect')
    expect(planDebugStop('stopped', 'none', NO_DEBUG_ADAPTER_STOP_CAPABILITIES)).toBe('disconnect')
  })

  it('disconnects a session that is still starting', () => {
    expect(planDebugStop('starting', 'none', TERMINATE)).toBe('disconnect')
  })

  it('escalates a repeated stop from terminate to disconnect, then waits', () => {
    expect(planDebugStop('terminating', 'terminate', TERMINATE)).toBe('disconnect')
    expect(planDebugStop('terminating', 'disconnect', TERMINATE)).toBe('wait')
    expect(planDebugStop('terminating', 'none', TERMINATE)).toBe('wait')
  })
})
