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
        'evaluate',
        'listBreakpoints',
        'listCallStack',
        'listScopes',
        'listVariables',
        'onBreakpointsChanged',
        'onCallStackChanged',
        'onConsoleEntry',
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

  it('listScopes / listVariables forward only frameId / handle (Session 6-6)', async () => {
    await debugApi.listScopes({
      frameId: 11,
      command: 'evaluate',
      variablesReference: 1000,
      adapter: 'C:\\evil.exe'
    } as never)
    await debugApi.listVariables({
      handle: 'dv-1',
      variablesReference: 1000,
      command: 'setVariable',
      memoryReference: '0x1'
    } as never)

    expect(invoke).toHaveBeenNthCalledWith(1, 'debug:list-scopes', { frameId: 11 })
    expect(invoke).toHaveBeenNthCalledWith(2, 'debug:list-variables', { handle: 'dv-1' })
  })

  it('evaluate forwards only expression / frameId / context (Session 6-7)', async () => {
    await debugApi.evaluate({
      expression: 'user.name',
      frameId: 11,
      context: 'repl',
      command: 'evaluate',
      variablesReference: 1000,
      threadId: 1,
      adapter: 'C:\\evil.exe'
    } as never)

    expect(invoke).toHaveBeenCalledWith('debug:evaluate', {
      expression: 'user.name',
      frameId: 11,
      context: 'repl'
    })
  })

  /**
   * `evaluate` は Session 6-7 で **app-domain の口**として入った。DAP の request 名と
   * 綴りが同じなのは `continue` / `pause` と同じ事情で、渡せるのは式・frame・
   * 閉じた集合の文脈の3つだけになる（method 名を渡す欄は無い）。
   */
  it('has no function that takes a DAP method, adapter, or process', () => {
    for (const name of Object.keys(debugApi)) {
      expect(name).not.toMatch(
        /request|command|method|adapter|spawn|exec|process|attach|setVariable|memory/i
      )
    }
  })
})
