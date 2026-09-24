import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskState } from '@shared/agent'
import type { AuditEvent } from '../security/audit/auditEvent'
import { createExternalSendGate } from '../security/externalSend/externalSendGate'
import {
  isSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import type { FileWriteOutcome } from '../security/fileWrite'
import type { TerminalRunOutcome } from '../security/terminalRun'
import { createAgentLoop, type AgentLoopDependencies } from './agentLoop'
import type { AgentProvider } from './agentProvider'
import type { AgentToolbox } from './agentTools'

/**
 * Agent Loop（Security Core v1 の STEP9）。
 *
 * Provider と Security Core の入口は差し替え、External Send Gate は**本物**を通す
 * （Provider が受け取るのが Gate の発行した Payload であることまで確かめる）。
 * 本物の Gate 一式を通す End-to-End は agentLoop.integration.test.ts。
 */

const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'

let events: AuditEvent[]
let states: AgentTaskState[]
let payloads: SafeExternalPayload[]
let enabled: boolean
let sideEffectBusy: boolean
let cancelled: number
let toolbox: AgentToolbox & { readonly calls: string[] }

beforeEach(() => {
  events = []
  states = []
  payloads = []
  enabled = true
  sideEffectBusy = false
  cancelled = 0
  toolbox = fakeToolbox()
})

afterEach(() => {
  vi.useRealTimers()
})

function fakeToolbox(overrides: Partial<AgentToolbox> = {}): AgentToolbox & { calls: string[] } {
  const calls: string[] = []

  return {
    calls,
    describeStatus: async () => {
      calls.push('workspace_status')
      return {
        ok: true,
        workspaceName: 'demo',
        permissionMode: 'ask',
        git: {
          repository: 'not-a-repository',
          branch: null,
          detached: false,
          changedPaths: [],
          changedPathsTruncated: false
        }
      }
    },
    listDirectory: async () => {
      calls.push('workspace_list')
      return { ok: true, workspacePath: '', entries: [], truncated: false }
    },
    readFile: async () => {
      calls.push('file_read')
      return { ok: false, reason: 'not-found' }
    },
    search: async () => {
      calls.push('file_search')
      return {
        ok: true,
        matches: [],
        truncated: false,
        secretFilesSkipped: true,
        unverifiedExcludedCount: 0
      }
    },
    writeFile: async (path) => {
      calls.push('file_write')
      return { ok: true, workspacePath: String(path) }
    },
    runCommand: async () => {
      calls.push('terminal_run')
      return {
        ok: true,
        exitCode: 0,
        output: {
          text: 'done\n',
          truncated: false,
          secretMasked: false,
          maskedCount: 0,
          categories: [],
          withheld: false
        }
      }
    },
    ...overrides
  }
}

/** 決まった出力を順に返す Provider（尽きたら complete）。 */
function provider(outputs: readonly unknown[] | ((step: number) => unknown)): AgentProvider {
  let step = 0

  return {
    id: 'fn-test-provider',
    contextWindowTokens: 32_000,
    next: async (payload) => {
      // Gate が発行し、まだ使われていない Payload だけが届く。
      expect(isSafeExternalPayload(payload)).toBe(true)
      payloads.push(payload)

      const output =
        typeof outputs === 'function'
          ? outputs(step)
          : (outputs[step] ?? { action: { type: 'complete', answer: 'done' } })

      step += 1

      return output
    }
  }
}

function loopOf(
  chosen: AgentProvider | null,
  overrides: Partial<AgentLoopDependencies> = {}
): ReturnType<typeof createAgentLoop> {
  const gate = createExternalSendGate({
    readPolicy: () => ({ permissionMode: 'ask' }),
    recordEvent: (event) => events.push(event)
  })

  return createAgentLoop({
    createProvider: () => chosen,
    isProviderAvailable: () => chosen !== null,
    isAgentEnabled: () => enabled,
    hasWorkspace: () => true,
    readPermissionMode: () => 'ask',
    sendToProvider: (request, deliver) => gate.send(request, deliver),
    toolbox,
    isSideEffectInProgress: () => sideEffectBusy,
    cancelPendingApprovals: () => {
      cancelled += 1
      return 1
    },
    recordEvent: (event) => events.push(event),
    emitState: (state) => states.push(state),
    ...overrides
  })
}

function agentEvents(): readonly AuditEvent[] {
  return events.filter((event) => event.type.startsWith('agent.'))
}

describe('始める', () => {
  it('指示・ON / OFF・Workspace・Provider・実行中を確かめる', () => {
    expect(loopOf(provider([])).start('')).toEqual({ started: false, reason: 'invalid-prompt' })
    expect(loopOf(provider([])).start(42)).toEqual({ started: false, reason: 'invalid-prompt' })
    expect(loopOf(provider([])).start('x'.repeat(20_001))).toEqual({
      started: false,
      reason: 'invalid-prompt'
    })
    expect(loopOf(null).start('do it')).toEqual({ started: false, reason: 'provider-unavailable' })
    expect(loopOf(provider([]), { hasWorkspace: () => false }).start('do it')).toEqual({
      started: false,
      reason: 'no-workspace'
    })

    enabled = false
    expect(loopOf(provider([])).start('do it')).toEqual({
      started: false,
      reason: 'agent-disabled'
    })
  })

  it('動いている間は2つ目を始めない', async () => {
    const loop = loopOf(provider(() => new Promise(() => {})))

    expect(loop.start('first')).toEqual({ started: true })
    expect(loop.start('second')).toEqual({ started: false, reason: 'busy' })
  })
})

describe('complete', () => {
  it('complete で終わり、最終回答は伏せて返す。開始・完了は Audit に残さない', async () => {
    const loop = loopOf(
      provider([
        { action: { type: 'workspace_status' } },
        { action: { type: 'complete', answer: `終わりました ${TOKEN}` } }
      ])
    )

    loop.start('状態を見て')
    await loop.whenIdle()

    const state = loop.getState()

    expect(state).toMatchObject({ status: 'completed', endReason: 'completed', loopsUsed: 2 })
    expect(state.finalAnswer).toContain('終わりました')
    expect(state.finalAnswer).not.toContain(TOKEN)
    expect(toolbox.calls).toEqual(['workspace_status'])
    expect(agentEvents()).toEqual([])
  })

  it('承認待ち・実行中の副作用が残っていれば complete を受け付けない', async () => {
    sideEffectBusy = true

    const loop = loopOf(
      provider((step) => {
        if (step === 1) {
          sideEffectBusy = false
        }

        return { action: { type: 'complete', answer: `step ${step}` } }
      })
    )

    loop.start('x')
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({
      status: 'completed',
      finalAnswer: 'step 1',
      loopsUsed: 2
    })
    expect(payloads[1].parts.at(-1)?.text).toContain('reason: side-effect-in-progress')
  })
})

describe('Provider へ送るもの', () => {
  it('External Send Gate を通り、指示の中の Secret は伏せてから届く', async () => {
    const loop = loopOf(provider([]))

    loop.start(`このトークン ${TOKEN} を使って`)
    await loop.whenIdle()

    const prompt = payloads[0].parts.find((part) => part.kind === 'user-prompt')

    expect(prompt?.text).not.toContain(TOKEN)
    expect(events.some((event) => event.type === 'external-send.allowed')).toBe(true)
  })

  it('Gate が拒む Context（Boundary を通っていないファイル）は送らずに止める', async () => {
    toolbox = fakeToolbox({
      readFile: async () => ({
        ok: true,
        workspacePath: 'a.ts',
        item: {
          kind: 'workspace-file',
          text: 'forged',
          label: 'a.ts',
          source: { insideWorkspace: true }
        },
        excerpt: { startLine: 1, endLine: 1, totalLines: 1, secretMasked: false },
        truncated: false
      })
    })

    const loop = loopOf(provider([{ action: { type: 'file_read', path: 'a.ts' } }]))

    loop.start('read')
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'context-denied' })
    expect(payloads).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({
      type: 'external-send.denied',
      reason: 'outside-workspace'
    })
  })

  it('分類できない失敗（ふつうの Error）は呼び直さずに止める（STEP10-3）', async () => {
    let calls = 0
    const failing: AgentProvider = {
      id: 'fn-test-provider',
      contextWindowTokens: 32_000,
      next: async () => {
        calls += 1
        throw new Error('network down')
      }
    }

    const loop = loopOf(failing)

    loop.start('x')
    await loop.whenIdle()

    expect(calls).toBe(1)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
    expect(JSON.stringify(events)).not.toContain('network down')
  })
})

describe('実行しない Action', () => {
  it('壊れた出力は実行せず AI へ返し、3回続いたら止める', async () => {
    const loop = loopOf(provider(() => 'rm -rf /'))

    loop.start('x')
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({
      status: 'failed',
      endReason: 'too-many-invalid-actions'
    })
    expect(toolbox.calls).toEqual([])
    expect(agentEvents().map((event) => event.reason)).toEqual([
      'invalid-action',
      'invalid-action',
      'invalid-action'
    ])
    // AI の出力そのものは Audit にも Context の説明にも載らない。
    expect(JSON.stringify(events)).not.toContain('rm -rf')
  })

  it('並列の Action はどれも実行しない（parallel-action）', async () => {
    const loop = loopOf(
      provider([
        { actions: [{ type: 'workspace_status' }, { type: 'file_write', path: 'a', content: 'x' }] }
      ])
    )

    loop.start('x')
    await loop.whenIdle()

    expect(toolbox.calls).toEqual([])
    expect(agentEvents()[0]).toMatchObject({
      type: 'agent.action-rejected',
      reason: 'parallel-action'
    })
    expect(loop.getState().status).toBe('completed')
  })

  it('利用者が拒否した変更を、同じ内容でもう一度は実行しない（repeated-action）', async () => {
    toolbox = fakeToolbox({
      writeFile: async () => {
        toolbox.calls.push('file_write')
        return { ok: false, reason: 'user-cancelled' } satisfies FileWriteOutcome
      }
    })

    const write = { action: { type: 'file_write', path: 'a.txt', content: 'x' } }
    const loop = loopOf(
      provider([write, write, { action: { type: 'file_write', path: 'a.txt', content: 'fixed' } }])
    )

    loop.start('x')
    await loop.whenIdle()

    // 1回目は Gate へ、2回目は拒否済みとして Gate へ渡さない、内容を直した3回目は Gate へ。
    expect(toolbox.calls).toEqual(['file_write', 'file_write'])
    expect(agentEvents()).toEqual([
      expect.objectContaining({
        type: 'agent.action-rejected',
        reason: 'repeated-action',
        subject: 'file_write'
      })
    ])
  })

  it('Security Core の deny（Secret ファイル）も同じ扱い', async () => {
    toolbox = fakeToolbox({
      readFile: async () => {
        toolbox.calls.push('file_read')
        return { ok: false, reason: 'secret-file' }
      }
    })

    const read = { action: { type: 'file_read', path: '.env' } }
    const loop = loopOf(provider([read, read]))

    loop.start('x')
    await loop.whenIdle()

    expect(toolbox.calls).toEqual(['file_read'])
    expect(agentEvents()[0]).toMatchObject({ reason: 'repeated-action' })
  })

  it('一時的な失敗は最大2回まで再試行し、それ以上は同じ Action を実行しない', async () => {
    toolbox = fakeToolbox({
      runCommand: async () => {
        toolbox.calls.push('terminal_run')
        return { ok: false, reason: 'spawn-failed', output: null } satisfies TerminalRunOutcome
      }
    })

    const run = { action: { type: 'terminal_run', command: 'npm', args: ['test'] } }
    const loop = loopOf(provider([run, run, run, run]))

    loop.start('x')
    await loop.whenIdle()

    expect(toolbox.calls).toEqual(['terminal_run', 'terminal_run', 'terminal_run'])
    expect(agentEvents()[0]).toMatchObject({ reason: 'repeated-action' })
  })
})

describe('Loop の上限', () => {
  it('20 回で止まって尋ね、続けると +10、やめると stopped', async () => {
    const loop = loopOf(provider(() => ({ action: { type: 'workspace_status' } })))

    loop.start('x')

    await vi.waitFor(() => expect(loop.getState().status).toBe('awaiting-continue'))
    expect(loop.getState()).toMatchObject({ loopsUsed: 20, loopLimit: 20 })

    loop.continueTask('continue')

    await vi.waitFor(() =>
      expect(loop.getState()).toMatchObject({
        status: 'awaiting-continue',
        loopsUsed: 30,
        loopLimit: 30
      })
    )

    loop.continueTask('stop')
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({
      status: 'stopped',
      endReason: 'loop-limit-declined',
      loopsUsed: 30
    })
  })

  it('尋ねている間は Provider を呼ばない（自動で続けない）', async () => {
    const loop = loopOf(provider(() => ({ action: { type: 'workspace_status' } })))

    loop.start('x')
    await vi.waitFor(() => expect(loop.getState().status).toBe('awaiting-continue'))

    const before = payloads.length
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(payloads.length).toBe(before)
    loop.stop()
    await loop.whenIdle()
  })
})

describe('停止', () => {
  it('承認待ちを取り消し、新しい Action を始めない', async () => {
    let settle: (outcome: FileWriteOutcome) => void = () => {}

    toolbox = fakeToolbox({
      writeFile: () => {
        toolbox.calls.push('file_write')
        return new Promise<FileWriteOutcome>((resolve) => {
          settle = resolve
        })
      }
    })

    const loop = loopOf(
      provider([
        { action: { type: 'file_write', path: 'a.txt', content: 'x' } },
        { action: { type: 'workspace_status' } }
      ])
    )

    loop.start('x')
    await vi.waitFor(() => expect(loop.getState().phase).toBe('proposing-change'))

    loop.stop()

    expect(loop.getState().status).toBe('stopping')
    expect(cancelled).toBe(1)
    expect(agentEvents()).toEqual([
      expect.objectContaining({ type: 'agent.stopped', reason: 'agent-stopped' })
    ])

    // Approval Manager の取り消しで、File Write Gate は deny で解ける。
    settle({ ok: false, reason: 'agent-stopped' })
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: 'user-stopped' })
    expect(toolbox.calls).toEqual(['file_write'])
    expect(payloads).toHaveLength(1)
  })

  it('実行中のコマンドは止めず、終わるのを待ってから stopped にする', async () => {
    let finish: (outcome: TerminalRunOutcome) => void = () => {}

    toolbox = fakeToolbox({
      runCommand: () =>
        new Promise<TerminalRunOutcome>((resolve) => {
          finish = resolve
        })
    })

    const loop = loopOf(
      provider([{ action: { type: 'terminal_run', command: 'npm', args: ['test'] } }])
    )

    loop.start('x')
    await vi.waitFor(() => expect(loop.getState().phase).toBe('running-command'))

    loop.stop()
    await new Promise((resolve) => setTimeout(resolve, 10))

    // まだ終わっていない（kill しない）。
    expect(loop.getState().status).toBe('stopping')

    finish({
      ok: true,
      exitCode: 0,
      output: {
        text: '',
        truncated: false,
        secretMasked: false,
        maskedCount: 0,
        categories: [],
        withheld: false
      }
    })
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: 'user-stopped' })
    expect(payloads).toHaveLength(1)
  })

  it('Provider の応答を待っている間の停止は、Provider へ中断を伝える', async () => {
    let aborted = false
    let called = false
    const waiting: AgentProvider = {
      id: 'fn-test-provider',
      contextWindowTokens: 32_000,
      next: (_payload, signal) => {
        called = true

        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          })
        })
      }
    }

    const loop = loopOf(waiting)

    loop.start('x')
    // 応答を待っている間は Turn を使っていない（STEP10-4）。呼ばれたことを合図にする。
    await vi.waitFor(() => expect(called).toBe(true))
    expect(loop.getState().loopsUsed).toBe(0)

    loop.stop()
    await loop.whenIdle()

    expect(aborted).toBe(true)
    expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: 'user-stopped' })
  })

  it('動いていなければ停止は何もしない（Audit にも残さない）', () => {
    const loop = loopOf(provider([]))

    loop.stop()

    expect(events).toEqual([])
    expect(cancelled).toBe(0)
  })
})

describe('利用者以外の理由で止まる', () => {
  it('Agent が OFF になったら、次の Action を始めない', async () => {
    const loop = loopOf(
      provider((step) => {
        if (step === 0) {
          enabled = false
        }

        return { action: { type: 'workspace_status' } }
      })
    )

    loop.start('x')
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: 'agent-disabled' })
    expect(toolbox.calls).toEqual([])
  })

  it('Workspace が切り替わったら止め、承認待ちも取り消す', async () => {
    const loop = loopOf(provider(() => new Promise(() => {})))

    loop.start('x')
    await vi.waitFor(() => expect(payloads).toHaveLength(1))

    loop.halt('workspace-changed')

    expect(cancelled).toBe(1)
    expect(loop.getState().status).toBe('stopping')
  })
})

/*
  作業の signal（2026-09-24 の修正）。止めた時点で承認がまだ無い（Gate がロックを取った後・
  承認を求める前）場合、cancelAll では消せない。Gate と Approval Manager がこの signal を見て、
  止まった後に新しい承認・新しい副作用を始めない。
*/
describe('作業の signal を副作用のある Tool へ渡す', () => {
  const CASES = [
    ['file_write', 'stop', 'user-stopped'],
    ['file_write', "halt('workspace-changed')", 'workspace-changed'],
    ['terminal_run', 'stop', 'user-stopped'],
    ['terminal_run', "halt('workspace-changed')", 'workspace-changed']
  ] as const

  it.each(CASES)(
    '%s: %s で abort され、Tool が断れば stopped で終わる',
    async (tool, how, reason) => {
      let received: AbortSignal | undefined
      let entered: () => void = () => {}
      const inTool = new Promise<void>((resolve) => {
        entered = resolve
      })

      /** Gate の代わり。signal が abort されたら agent-stopped で断る。 */
      function stoppable<T>(signal: AbortSignal | undefined, denied: T): Promise<T> {
        received = signal
        entered()

        return new Promise<T>((resolve) => {
          signal?.addEventListener('abort', () => resolve(denied), { once: true })
        })
      }

      toolbox = fakeToolbox({
        writeFile: (_path, _content, signal) =>
          stoppable<FileWriteOutcome>(signal, { ok: false, reason: 'agent-stopped' }),
        runCommand: (_request, signal) =>
          stoppable<TerminalRunOutcome>(signal, {
            ok: false,
            reason: 'agent-stopped',
            output: null
          })
      })

      const loop = loopOf(
        provider([
          tool === 'file_write'
            ? { action: { type: 'file_write', path: 'a.txt', content: 'x' } }
            : { action: { type: 'terminal_run', command: 'npm', args: ['test'] } },
          { action: { type: 'workspace_status' } }
        ])
      )

      loop.start('x')
      await inTool

      expect(received).toBeInstanceOf(AbortSignal)
      expect(received?.aborted).toBe(false)

      if (how === 'stop') {
        loop.stop()
      } else {
        loop.halt('workspace-changed')
      }

      expect(received?.aborted).toBe(true)

      await loop.whenIdle()

      expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: reason })
      // 止めた後は、次の Action（workspace_status）を始めない。
      expect(toolbox.calls).toEqual([])
      expect(payloads).toHaveLength(1)
    }
  )
})

/*
  Provider の呼び出しの境界（STEP10-2）。Provider は直に await せず、callAgentProvider が
  abort / timeout を Loop 側で強制する。signal を守らない Provider でも止まり、遅れた応答は捨てる。
*/
describe('Provider の呼び出しの境界（STEP10-2）', () => {
  const WRITE = { action: { type: 'file_write', path: 'a.txt', content: 'x' } }
  const RUN = { action: { type: 'terminal_run', command: 'npm', args: ['test'] } }

  /** signal を見ず、テストが決めるまで返さない Provider。`called` は呼ばれたこと。 */
  function ignoring(): {
    readonly provider: AgentProvider
    readonly called: Promise<void>
    readonly calls: () => number
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
  } {
    let markCalled!: () => void
    let count = 0
    const called = new Promise<void>((done) => {
      markCalled = done
    })
    const control = {
      called,
      calls: () => count,
      resolve: (_value: unknown) => {},
      reject: (_reason: unknown) => {},
      provider: {
        id: 'fn-test-provider',
        contextWindowTokens: 32_000,
        next: (payload: SafeExternalPayload) => {
          payloads.push(payload)
          count += 1
          markCalled()

          return new Promise<unknown>((resolve, reject) => {
            control.resolve = resolve
            control.reject = reject
          })
        }
      } satisfies AgentProvider
    }

    return control
  }

  let unhandled: unknown[]
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }

  beforeEach(() => {
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
  })

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
  })

  it.each([
    ['stop', 'user-stopped'],
    ["halt('workspace-changed')", 'workspace-changed']
  ] as const)(
    'signal を無視して返さない Provider でも、%s で stopping に残らず whenIdle が解ける',
    async (how, endReason) => {
      const control = ignoring()
      const loop = loopOf(control.provider)

      loop.start('x')
      await control.called

      if (how === 'stop') {
        loop.stop()
      } else {
        loop.halt('workspace-changed')
      }

      await loop.whenIdle()

      expect(loop.getState()).toMatchObject({ status: 'stopped', endReason })
      expect(cancelled).toBe(1)

      // 遅れて届いた副作用の Action は実行しない。状態も動かない。
      const settledStates = states.length

      control.resolve(WRITE)
      await new Promise((resolve) => setImmediate(resolve))

      expect(toolbox.calls).toEqual([])
      expect(states).toHaveLength(settledStates)
      expect(loop.getState()).toMatchObject({ status: 'stopped', endReason })
      expect(control.calls()).toBe(1)
    }
  )

  it('止めた後に Provider が reject しても、状態は変わらず unhandled rejection にもならない', async () => {
    const control = ignoring()
    const loop = loopOf(control.provider)

    loop.start('x')
    await control.called
    loop.stop()
    await loop.whenIdle()

    const settledStates = states.length

    control.reject(new Error(`late ${TOKEN}`))
    await new Promise((resolve) => setImmediate(resolve))

    expect(states).toHaveLength(settledStates)
    expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: 'user-stopped' })
    expect(unhandled).toEqual([])
    expect(JSON.stringify(states)).not.toContain(TOKEN)
    expect(JSON.stringify(events)).not.toContain(TOKEN)
  })

  it('返さない Provider は Policy の時間で打ち切り、送り直さずに終える。遅れた応答は使わない', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const control = ignoring()
    const loop = loopOf(control.provider, {
      providerCallPolicy: { timeoutMs: 5_000, maxResponseChars: 10_000 }
    })

    loop.start('x')
    await control.called

    await vi.advanceTimersByTimeAsync(4_999)
    expect(loop.getState().status).toBe('running')

    await vi.advanceTimersByTimeAsync(1)
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-timeout' })
    // timeout では呼び直さない（STEP10-3）。
    expect(control.calls()).toBe(1)

    control.resolve(RUN)
    await vi.advanceTimersByTimeAsync(0)

    expect(toolbox.calls).toEqual([])
    expect(control.calls()).toBe(1)
  })

  it('上限を超える応答は Schema へ渡さない（有効な Action でも実行しない）', async () => {
    const loop = loopOf(provider([{ action: { type: 'workspace_status' } }]), {
      providerCallPolicy: { timeoutMs: 5_000, maxResponseChars: 10 }
    })

    loop.start('x')
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({
      status: 'failed',
      endReason: 'provider-response-too-large'
    })
    expect(toolbox.calls).toEqual([])
    // Schema へ届いていれば、読めても読めなくても Audit（action-rejected）か Tool に跡が残る。
    expect(agentEvents().map((event) => event.type)).toEqual(['agent.provider-failed'])
    expect(payloads).toHaveLength(1)
  })

  it('上限以内の応答は、そのまま Schema と Gate へ進む', async () => {
    const loop = loopOf(provider([{ action: { type: 'workspace_status' } }]), {
      providerCallPolicy: { timeoutMs: 5_000, maxResponseChars: 1_000 }
    })

    loop.start('x')
    await loop.whenIdle()

    expect(toolbox.calls).toEqual(['workspace_status'])
    expect(loop.getState()).toMatchObject({ status: 'completed', endReason: 'completed' })
  })

  it('Payload の宛先と Provider の id が違えば、next を呼ばずに終える', async () => {
    let reads = 0
    const next = vi.fn(async () => ({ action: { type: 'workspace_status' } }))
    const shifting: AgentProvider = {
      // Context を組み立てるときの名前と、呼ぶときの名前が違う Provider。
      get id() {
        reads += 1
        return reads === 1 ? 'fn-test-provider' : 'fn-other-provider'
      },
      contextWindowTokens: 32_000,
      next
    }

    const loop = loopOf(shifting)

    loop.start('x')
    await loop.whenIdle()

    expect(next).not.toHaveBeenCalled()
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
    expect(toolbox.calls).toEqual([])
  })

  it('JSON で表せない応答は、Schema へ渡さず呼び直さずに終える（STEP10-3）', async () => {
    const loop = loopOf(
      provider([
        { action: { type: 'file_write', path: 'a.txt', content: 'x', approved: undefined } }
      ])
    )

    loop.start('x')
    await loop.whenIdle()

    expect(toolbox.calls).toEqual([])
    expect(payloads).toHaveLength(1)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
    expect(agentEvents()).toEqual([
      expect.objectContaining({ type: 'agent.provider-failed', reason: 'invalid-response' })
    ])
  })

  it('文字列の応答（実 Provider の形）も同じ Schema を通る', async () => {
    const loop = loopOf(
      provider([
        '{"action":{"type":"workspace_status"}}',
        '{"action":{"type":"complete","answer":"ok"}}'
      ])
    )

    loop.start('x')
    await loop.whenIdle()

    expect(toolbox.calls).toEqual(['workspace_status'])
    expect(loop.getState()).toMatchObject({ status: 'completed', finalAnswer: 'ok' })
  })
})

describe('Renderer へ知らせる状態', () => {
  it('Tool の詳細・ファイルの中身・AI の出力は載らない', async () => {
    const loop = loopOf(
      provider([
        { action: { type: 'file_write', path: 'a.txt', content: `SECRET_BODY ${TOKEN}` } },
        { action: { type: 'terminal_run', command: 'npm', args: ['run', TOKEN] } }
      ])
    )

    loop.start('x')
    await loop.whenIdle()

    const serialized = JSON.stringify(states)

    expect(serialized).not.toContain('SECRET_BODY')
    expect(serialized).not.toContain(TOKEN)
    expect(Object.keys(states[0]).sort()).toEqual([
      'agentEnabled',
      'endReason',
      'finalAnswer',
      'loopLimit',
      'loopsUsed',
      'phase',
      'providerAvailable',
      'status',
      'subject'
    ])
  })
})
