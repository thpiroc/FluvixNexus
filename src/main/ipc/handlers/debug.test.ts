import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcError } from '../errors'

/**
 * debug ハンドラの境界（Session 6-6 ── Variables / Scopes、Session 6-7 ── Evaluate）。
 *
 * ここで見るのは「形の壊れた要求を INVALID_REQUEST で断ること」と
 * 「要求の中から `frameId` / `handle` / 式・文脈以外を Main の処理へ渡さないこと」だけ。
 * frame / handle が今の停止のものかは main/debug/variables.ts・evaluate.ts のテストが見る。
 */

const handlers = vi.hoisted(() => new Map<string, (request: unknown) => unknown>())
const listDebugScopes = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({ status: 'ok', scopes: [] }))
)
const listDebugVariables = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({ status: 'ok', variables: [], truncated: false }))
)
const evaluateDebugExpression = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({
    status: 'ok',
    value: {
      handle: null,
      value: '3',
      type: 'number',
      kind: 'other',
      namedCount: null,
      indexedCount: null
    }
  }))
)

vi.mock('../registry', () => ({
  handleIpc: (channel: string, handler: (request: unknown) => unknown) => {
    handlers.set(channel, handler)
  }
}))

vi.mock('../../debug/breakpoints', () => ({
  listDebugBreakpoints: vi.fn(() => []),
  toggleDebugBreakpoint: vi.fn()
}))

vi.mock('../../debug/callStack', () => ({ listDebugCallStack: vi.fn() }))

vi.mock('../../debug/debugSessionManager', () => ({
  controlDebugSession: vi.fn(),
  requestDebugSessionStop: vi.fn()
}))

vi.mock('../../debug/variables', () => ({ listDebugScopes, listDebugVariables }))

vi.mock('../../debug/evaluate', () => ({ evaluateDebugExpression }))

const getDebugSessionStatus = vi.hoisted(() => vi.fn((): unknown => 'unavailable'))

vi.mock('../../debug/sessionStatus', () => ({ getDebugSessionStatus }))

const profiles = vi.hoisted(() => ({
  listDebugProfiles: vi.fn((): unknown[] => []),
  createDebugProfile: vi.fn((): unknown => ({ status: 'rejected', reason: 'no-workspace' })),
  updateDebugProfile: vi.fn((): unknown => ({ status: 'rejected', reason: 'no-workspace' })),
  deleteDebugProfile: vi.fn((): unknown => ({ status: 'rejected', reason: 'no-workspace' })),
  startDebugProfile: vi.fn((): unknown => ({ status: 'failed', reason: 'adapter-unavailable' }))
}))

vi.mock('../../debug/debugProfiles', () => profiles)

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { registerDebugHandlers } = await import('./debug')

registerDebugHandlers()

function handler(channel: string): (request: unknown) => unknown {
  const registered = handlers.get(channel)

  if (registered === undefined) {
    throw new Error(`no handler: ${channel}`)
  }

  return registered
}

async function expectInvalid(pending: unknown): Promise<void> {
  await expect(Promise.resolve().then(() => pending)).rejects.toSatisfy(
    (cause: unknown) => cause instanceof IpcError && cause.code === 'INVALID_REQUEST'
  )
}

describe('debug IPC handlers — variables', () => {
  beforeEach(() => {
    listDebugScopes.mockClear()
    listDebugVariables.mockClear()
    evaluateDebugExpression.mockClear()
  })

  it('registers the two variables channels', () => {
    expect(handlers.has('debug:list-scopes')).toBe(true)
    expect(handlers.has('debug:list-variables')).toBe(true)
  })

  it('passes only the frame id to the variables store', async () => {
    await expect(
      handler('debug:list-scopes')({ frameId: 11, command: 'evaluate', variablesReference: 5 })
    ).resolves.toEqual({ result: { status: 'ok', scopes: [] } })

    expect(listDebugScopes).toHaveBeenCalledWith(11)
  })

  /** Session 6-15B ── DAP の frame id は整数で、vscode-js-debug は最上段に 0 を振ることがある。 */
  it('passes frame id 0 to the variables store', async () => {
    await handler('debug:list-scopes')({ frameId: 0 })

    expect(listDebugScopes).toHaveBeenCalledWith(0)
  })

  it.each([
    undefined,
    null,
    {},
    { frameId: '11' },
    { frameId: -1 },
    { frameId: 1.5 },
    { frameId: Number.MAX_SAFE_INTEGER + 1 }
  ])('rejects a malformed scopes request %j', async (request) => {
    await expectInvalid(
      (async () => {
        await handler('debug:list-scopes')(request)
      })()
    )
    expect(listDebugScopes).not.toHaveBeenCalled()
  })

  it('passes only the handle to the variables store', async () => {
    await expect(
      handler('debug:list-variables')({ handle: 'dv-1', variablesReference: 1000 })
    ).resolves.toEqual({ result: { status: 'ok', variables: [], truncated: false } })

    expect(listDebugVariables).toHaveBeenCalledWith('dv-1')
  })

  it.each([
    undefined,
    {},
    { handle: 1000 },
    { variablesReference: 1000 },
    { handle: '' },
    { handle: 'x'.repeat(65) },
    { handle: ['dv-1'] }
  ])(
    'rejects a malformed variables request %j (raw variablesReference included)',
    async (request) => {
      await expectInvalid(
        (async () => {
          await handler('debug:list-variables')(request)
        })()
      )
      expect(listDebugVariables).not.toHaveBeenCalled()
    }
  )
})

describe('debug IPC handlers — evaluate (Session 6-7)', () => {
  beforeEach(() => {
    evaluateDebugExpression.mockClear()
  })

  it('registers the evaluate channel', () => {
    expect(handlers.has('debug:evaluate')).toBe(true)
  })

  it('passes only the expression, frame id and context to the evaluate store', async () => {
    await expect(
      handler('debug:evaluate')({
        expression: 'user.name',
        frameId: 11,
        context: 'repl',
        command: 'setVariable',
        variablesReference: 1000,
        threadId: 7
      })
    ).resolves.toEqual({
      result: {
        status: 'ok',
        value: {
          handle: null,
          value: '3',
          type: 'number',
          kind: 'other',
          namedCount: null,
          indexedCount: null
        }
      }
    })

    expect(evaluateDebugExpression).toHaveBeenCalledWith('user.name', 11, 'repl')
  })

  /** Session 6-15B ── frame id 0（vscode-js-debug）は形として通す。今の停止の frame かは evaluate.ts が決める。 */
  it('passes frame id 0 to the evaluate store', async () => {
    await handler('debug:evaluate')({ expression: 'a', frameId: 0, context: 'repl' })

    expect(evaluateDebugExpression).toHaveBeenCalledWith('a', 0, 'repl')
  })

  /** 式は加工せずに渡す ── 前後の空白で意味が変わる言語がある。 */
  it('does not trim or reshape the expression', async () => {
    await handler('debug:evaluate')({ expression: '  a + b  ', frameId: 11, context: 'watch' })

    expect(evaluateDebugExpression).toHaveBeenCalledWith('  a + b  ', 11, 'watch')
  })

  it.each([
    ['no request', undefined],
    ['empty request', {}],
    ['expression is not a string', { expression: 42, frameId: 11, context: 'repl' }],
    ['expression is blank', { expression: '   ', frameId: 11, context: 'repl' }],
    ['expression is empty', { expression: '', frameId: 11, context: 'repl' }],
    ['expression is too long', { expression: 'a'.repeat(2001), frameId: 11, context: 'repl' }],
    ['expression contains NUL', { expression: 'a\0b', frameId: 11, context: 'repl' }],
    ['frame id is missing', { expression: 'a', context: 'repl' }],
    ['frame id is negative', { expression: 'a', frameId: -1, context: 'repl' }],
    ['frame id is not a safe integer', { expression: 'a', frameId: 2 ** 53, context: 'repl' }],
    ['frame id is fractional', { expression: 'a', frameId: 1.5, context: 'repl' }],
    ['frame id is a string', { expression: 'a', frameId: '11', context: 'repl' }],
    ['context is missing', { expression: 'a', frameId: 11 }],
    ['context is unknown', { expression: 'a', frameId: 11, context: 'hover' }],
    ['context is a DAP command', { expression: 'a', frameId: 11, context: 'setVariable' }],
    ['context is not a string', { expression: 'a', frameId: 11, context: 1 }]
  ])('rejects a malformed evaluate request (%s)', async (_name, request) => {
    await expectInvalid(
      (async () => {
        await handler('debug:evaluate')(request)
      })()
    )
    expect(evaluateDebugExpression).not.toHaveBeenCalled()
  })

  /** 式ちょうど上限は通る（上限そのものを外していないことの確認）。 */
  it('accepts an expression at exactly the length limit', async () => {
    await handler('debug:evaluate')({
      expression: 'a'.repeat(2000),
      frameId: 11,
      context: 'repl'
    })

    expect(evaluateDebugExpression).toHaveBeenCalledTimes(1)
  })
})

describe('debug IPC handlers — status (Session 6-9)', () => {
  beforeEach(() => {
    getDebugSessionStatus.mockClear()
  })

  it('registers the status channel', () => {
    expect(handlers.has('debug:get-status')).toBe(true)
  })

  it.each([
    ['no request', undefined],
    ['a DAP command', { command: 'launch', adapter: 'C:\\evil.exe', args: ['--x'], cwd: 'C:\\' }],
    ['a session id', { sessionId: 'ds-1', generation: 3 }]
  ])(
    'ignores whatever the request carries (%s) and returns a single word',
    async (_name, request) => {
      const response = await handler('debug:get-status')(request)

      expect(response).toEqual({ status: 'unavailable' })
      expect(Object.keys(response as object)).toEqual(['status'])
      expect(getDebugSessionStatus).toHaveBeenCalledWith()
    }
  )
})

/**
 * Debug Profile と起動（Session 6-10）。
 *
 * ここで見るのは要求の形だけ ── `profileId` が Main の発番した形か、`profile` が object か。
 * 起動に渡るのは `profileId` だけで、`adapter` / `cwd` / `program` は Main の処理へ届かない。
 */
describe('debug IPC handlers — profiles and start (Session 6-10)', () => {
  const id = 'dp-00000000-0000-4000-8000-000000000001'
  const draft = {
    name: 'Run',
    language: 'node',
    programRelativePath: 'app.js',
    programArgs: [],
    env: {},
    stopOnEntry: false
  }

  beforeEach(() => {
    for (const mock of Object.values(profiles)) {
      mock.mockClear()
    }
  })

  it('registers the five channels', () => {
    for (const channel of [
      'debug:list-profiles',
      'debug:create-profile',
      'debug:update-profile',
      'debug:delete-profile',
      'debug:start'
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('lists without reading the request', async () => {
    expect(handler('debug:list-profiles')({ workspace: 'D:\\other', rootPath: 'C:\\' })).toEqual({
      profiles: []
    })
    expect(profiles.listDebugProfiles).toHaveBeenCalledWith()
  })

  it('start passes only the profile id, whatever else the request carries', async () => {
    expect(
      handler('debug:start')({
        profileId: id,
        adapter: 'C:\\evil.exe',
        adapterArgs: ['--x'],
        cwd: 'C:\\Windows',
        program: 'C:\\evil.js',
        command: 'launch'
      })
    ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })

    expect(profiles.startDebugProfile).toHaveBeenCalledWith(id)
  })

  it('create / update / delete pass the id and the draft object', async () => {
    await handler('debug:create-profile')({ profile: draft, profileId: id })
    await handler('debug:update-profile')({ profileId: id, profile: draft })
    await handler('debug:delete-profile')({ profileId: id })

    expect(profiles.createDebugProfile).toHaveBeenCalledWith(draft)
    expect(profiles.updateDebugProfile).toHaveBeenCalledWith(id, draft)
    expect(profiles.deleteDebugProfile).toHaveBeenCalledWith(id)
  })

  it.each([
    ['no request', undefined],
    ['no id', {}],
    ['a renderer-made id', { profileId: 'my-profile' }],
    ['an id with a path', { profileId: 'dp-..\\..\\x' }],
    ['a numeric id', { profileId: 1 }],
    ['an upper-case uuid', { profileId: 'dp-00000000-0000-4000-8000-00000000000A' }]
  ])('rejects a malformed id for start / update / delete (%s)', async (_name, request) => {
    for (const channel of ['debug:start', 'debug:delete-profile']) {
      await expectInvalid(
        (async () => {
          await handler(channel)(request)
        })()
      )
    }

    await expectInvalid(
      (async () => {
        await handler('debug:update-profile')({ ...(request ?? {}), profile: draft })
      })()
    )

    expect(profiles.startDebugProfile).not.toHaveBeenCalled()
    expect(profiles.deleteDebugProfile).not.toHaveBeenCalled()
    expect(profiles.updateDebugProfile).not.toHaveBeenCalled()
  })

  it.each([
    ['no request', undefined],
    ['no profile', {}],
    ['a string profile', { profile: 'node app.js' }],
    ['an array profile', { profile: ['node', 'app.js'] }],
    ['a null profile', { profile: null }]
  ])('rejects a create whose profile is not an object (%s)', async (_name, request) => {
    await expectInvalid(
      (async () => {
        await handler('debug:create-profile')(request)
      })()
    )
    expect(profiles.createDebugProfile).not.toHaveBeenCalled()
  })
})
