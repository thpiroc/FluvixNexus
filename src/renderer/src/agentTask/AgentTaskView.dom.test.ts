/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskState } from '@shared/agent'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { AgentTaskView } from './AgentTaskView'
import { agentTaskStatusKey } from './agentTaskStatus'

/**
 * FN Agent の最小パネル（Security Core v1 の STEP9）。
 *
 *   - 送るのは「始めて・止めて・続けて / やめて」の意思表示だけ
 *   - 停止ボタンは動いている間だけ
 *   - 状態は Main から届いたものだけを描く（押しただけでは変わらない）
 *   - 最終回答は文字として描く
 */

const agentTaskApi = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  continueTask: vi.fn(),
  getState: vi.fn(),
  onStateChanged: vi.fn()
}))

vi.mock('../api/fluvix', () => ({ fluvix: { agentTask: agentTaskApi } }))

const IDLE: AgentTaskState = {
  status: 'idle',
  phase: null,
  subject: null,
  loopsUsed: 0,
  loopLimit: 20,
  finalAnswer: null,
  endReason: null,
  agentEnabled: true,
  providerAvailable: true
}

let container: HTMLDivElement
let root: Root
let emit: ((state: AgentTaskState) => void) | null

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  emit = null

  agentTaskApi.onStateChanged.mockImplementation((listener) => {
    emit = listener
    return () => {}
  })
  agentTaskApi.getState.mockResolvedValue({ ok: true, data: IDLE })
  agentTaskApi.start.mockResolvedValue({ ok: true, data: { started: true } })
  agentTaskApi.stop.mockResolvedValue({ ok: true, data: undefined })
  agentTaskApi.continueTask.mockResolvedValue({ ok: true, data: undefined })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

function harness(): ReactElement {
  return createElement(
    I18nContext.Provider,
    { value: { language: 'ja', setLanguage: () => {}, t: createTranslator('ja') } },
    createElement(AgentTaskView, null)
  )
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(harness())
  })
}

function push(state: Partial<AgentTaskState>): void {
  act(() => emit?.({ ...IDLE, ...state }))
}

function byTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`)
}

function type(text: string): void {
  const textarea = byTestId('agent-task-prompt') as HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

  act(() => {
    setter?.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('始める', () => {
  it('指示を入れて開始すると、指示だけを送る', async () => {
    await render()
    type('README を直して')

    await act(async () => {
      ;(byTestId('agent-task-start') as HTMLButtonElement).click()
    })

    expect(agentTaskApi.start).toHaveBeenCalledWith({ prompt: 'README を直して' })
  })

  it('空の指示・Agent OFF・Provider 無しでは開始できない', async () => {
    await render()

    expect((byTestId('agent-task-start') as HTMLButtonElement).disabled).toBe(true)

    type('x')
    expect((byTestId('agent-task-start') as HTMLButtonElement).disabled).toBe(false)

    push({ agentEnabled: false })
    expect((byTestId('agent-task-start') as HTMLButtonElement).disabled).toBe(true)
    expect(byTestId('agent-task-disabled')).not.toBeNull()

    push({ providerAvailable: false })
    expect(byTestId('agent-task-no-provider')).not.toBeNull()
  })

  it('始められなかった理由を出す', async () => {
    agentTaskApi.start.mockResolvedValue({
      ok: true,
      data: { started: false, reason: 'no-workspace' }
    })
    await render()
    type('x')

    await act(async () => {
      ;(byTestId('agent-task-start') as HTMLButtonElement).click()
    })

    expect(byTestId('agent-task-rejected')?.textContent).toContain('Workspace')
  })
})

describe('動いている間', () => {
  it('停止ボタンは動いている間だけ出て、押すと停止だけを送る', async () => {
    await render()

    expect(byTestId('agent-task-stop')).toBeNull()

    push({ status: 'running', phase: 'reading', subject: 'src/app.ts', loopsUsed: 3 })

    expect(byTestId('agent-task-start')).toBeNull()
    expect(byTestId('agent-task-status')?.textContent).toContain('ファイル確認中')
    expect(byTestId('agent-task-subject')?.textContent).toBe('src/app.ts')
    expect((byTestId('agent-task-prompt') as HTMLTextAreaElement).disabled).toBe(true)

    act(() => (byTestId('agent-task-stop') as HTMLButtonElement).click())

    expect(agentTaskApi.stop).toHaveBeenCalledTimes(1)
    // 押しただけでは画面は変わらない（Main から stopping が届いて変わる）。
    expect(byTestId('agent-task-stop')).not.toBeNull()

    push({ status: 'stopping' })
    expect((byTestId('agent-task-stop') as HTMLButtonElement).disabled).toBe(true)

    push({ status: 'stopped', endReason: 'user-stopped' })
    expect(byTestId('agent-task-stop')).toBeNull()
  })

  it('Loop の上限では「続ける / やめる」を尋ね、返事だけを送る', async () => {
    await render()
    push({ status: 'awaiting-continue', loopsUsed: 20, loopLimit: 20 })

    expect(byTestId('agent-task-limit')?.textContent).toContain(
      '最大実行回数に到達しました。続行しますか？'
    )

    act(() => (byTestId('agent-task-limit-continue') as HTMLButtonElement).click())
    act(() => (byTestId('agent-task-limit-stop') as HTMLButtonElement).click())

    expect(agentTaskApi.continueTask.mock.calls).toEqual([
      [{ decision: 'continue' }],
      [{ decision: 'stop' }]
    ])
  })
})

describe('最終回答', () => {
  it('文字として描く（HTML として解釈しない）', async () => {
    await render()
    push({
      status: 'completed',
      endReason: 'completed',
      finalAnswer: '<img src=x onerror=alert(1)>完了'
    })

    const answer = byTestId('agent-task-answer')

    expect(answer?.textContent).toContain('<img src=x onerror=alert(1)>完了')
    expect(answer?.querySelector('img')).toBeNull()
  })
})

describe('状態の1行', () => {
  it('作業の種類ごとに決まった文言', () => {
    expect(agentTaskStatusKey({ ...IDLE, status: 'running', phase: 'investigating' })).toBe(
      'agentTask.phase.investigating'
    )
    expect(agentTaskStatusKey({ ...IDLE, status: 'running', phase: 'proposing-change' })).toBe(
      'agentTask.phase.proposingChange'
    )
    expect(agentTaskStatusKey({ ...IDLE, status: 'completed' })).toBe('agentTask.status.completed')
    expect(agentTaskStatusKey({ ...IDLE, status: 'failed', endReason: 'context-denied' })).toBe(
      'agentTask.end.contextDenied'
    )
  })
})
