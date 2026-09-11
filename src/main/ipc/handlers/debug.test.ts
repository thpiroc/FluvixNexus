import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcError } from '../errors'

/**
 * debug ハンドラの境界（Session 6-6 ── Variables / Scopes）。
 *
 * ここで見るのは「形の壊れた要求を INVALID_REQUEST で断ること」と
 * 「要求の中から `frameId` / `handle` 以外を Main の処理へ渡さないこと」だけ。
 * frame / handle が今の停止のものかは main/debug/variables.ts のテストが見る。
 */

const handlers = vi.hoisted(() => new Map<string, (request: unknown) => unknown>())
const listDebugScopes = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({ status: 'ok', scopes: [] }))
)
const listDebugVariables = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({ status: 'ok', variables: [], truncated: false }))
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

  it.each([
    undefined,
    null,
    {},
    { frameId: '11' },
    { frameId: 0 },
    { frameId: -1 },
    { frameId: 1.5 }
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
