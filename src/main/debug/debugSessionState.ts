export type DebugSessionState = 'idle' | 'starting' | 'running' | 'stopped' | 'terminating'

export type DebugSessionTransition =
  'start' | 'started' | 'stopped' | 'continued' | 'terminate' | 'cleanup'

export type DebugSessionTransitionResult =
  | { readonly status: 'transitioned'; readonly state: DebugSessionState }
  | {
      readonly status: 'invalid'
      readonly from: DebugSessionState
      readonly transition: DebugSessionTransition
    }

const TRANSITIONS: Readonly<
  Record<DebugSessionState, Partial<Record<DebugSessionTransition, DebugSessionState>>>
> = {
  idle: {
    start: 'starting'
  },
  starting: {
    started: 'running',
    terminate: 'terminating'
  },
  running: {
    stopped: 'stopped',
    terminate: 'terminating'
  },
  stopped: {
    continued: 'running',
    terminate: 'terminating'
  },
  terminating: {
    cleanup: 'idle'
  }
}

export function transitionDebugSessionState(
  state: DebugSessionState,
  transition: DebugSessionTransition
): DebugSessionTransitionResult {
  const next = TRANSITIONS[state][transition]

  return next === undefined
    ? { status: 'invalid', from: state, transition }
    : { status: 'transitioned', state: next }
}

export function applyDebugSessionTransition(
  state: DebugSessionState,
  transition: DebugSessionTransition
): DebugSessionState {
  const outcome = transitionDebugSessionState(state, transition)

  if (outcome.status === 'invalid') {
    throw new Error(`invalid debug session transition: ${state} -> ${transition}`)
  }

  return outcome.state
}
