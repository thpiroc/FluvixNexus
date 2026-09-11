import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * debug の Preload API が「経路だけ」であること（Session 6-4）。
 *
 * Electron は `ipcRenderer.invoke` 1つだけを差し替える。ここで見るのは
 * **Renderer が何を渡しても、Main へ届くのはチャンネル名だけ**になることで、
 * 実際に Main まで届いて答えが返ることは起動確認で見る（docs/DEVELOPMENT.md §4）。
 */

const invoke = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({ ok: true, data: { status: 'accepted', state: 'idle' } }))
)

vi.mock('electron', () => ({
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() }
}))

const { debugApi } = await import('./debug')

describe('debug preload api', () => {
  beforeEach(() => {
    invoke.mockClear()
  })

  it('exposes only the breakpoint and execution-control functions', () => {
    expect(Object.keys(debugApi).sort()).toEqual(
      [
        'continue',
        'listBreakpoints',
        'listCallStack',
        'onBreakpointsChanged',
        'onCallStackChanged',
        'pause',
        'stepInto',
        'stepOut',
        'stepOver',
        'stop',
        'toggleBreakpoint'
      ].sort()
    )
  })

  it.each([
    ['continue', 'debug:continue'],
    ['pause', 'debug:pause'],
    ['stepOver', 'debug:step-over'],
    ['stepInto', 'debug:step-into'],
    ['stepOut', 'debug:step-out'],
    ['stop', 'debug:stop']
  ] as const)(
    '%s invokes %s with no payload, whatever the caller passes',
    async (name, channel) => {
      const call = debugApi[name] as (...args: unknown[]) => Promise<unknown>

      await call({ command: 'evaluate', threadId: 1, adapter: 'C:\\evil.exe' }, 'next')

      expect(invoke).toHaveBeenCalledTimes(1)
      expect(invoke).toHaveBeenCalledWith(channel)
    }
  )

  it('has no function that takes a DAP method, adapter, or process', () => {
    for (const name of Object.keys(debugApi)) {
      expect(name).not.toMatch(/request|command|method|adapter|spawn|exec|process|attach/i)
    }
  })
})
