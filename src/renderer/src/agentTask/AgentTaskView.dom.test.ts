/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskState } from '@shared/agent'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { AgentStatusItem } from './AgentStatusItem'
import { AgentTaskProvider } from './AgentTaskProvider'
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

/**
 * パネル（AgentTaskView）とステータスバーの表示を、パネルの外の Provider の中に置く
 * （App.tsx と同じ形）。`view: false` はパネルを閉じた・別の場所へ運ぶ途中の状態にあたる。
 */
function harness({
  view = true,
  onShowPanel = () => {}
}: { readonly view?: boolean; readonly onShowPanel?: () => void } = {}): ReactElement {
  return createElement(
    I18nContext.Provider,
    { value: { language: 'ja', setLanguage: () => {}, t: createTranslator('ja') } },
    createElement(
      AgentTaskProvider,
      null,
      view ? createElement(AgentTaskView, { key: 'view' }) : null,
      createElement(AgentStatusItem, { key: 'status', onShowPanel })
    )
  )
}

async function render(options?: Parameters<typeof harness>[0]): Promise<void> {
  await act(async () => {
    root.render(harness(options))
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

describe('パネルの作り直し（移動・非表示・再表示）', () => {
  it('書きかけの指示は、パネルを閉じて出し直しても残る', async () => {
    await render()
    type('テストを実行して')

    await render({ view: false })
    expect(byTestId('agent-task')).toBeNull()

    await render()
    expect((byTestId('agent-task-prompt') as HTMLTextAreaElement).value).toBe('テストを実行して')
  })

  it('始められなかった理由も、出し直した後に残る', async () => {
    agentTaskApi.start.mockResolvedValue({
      ok: true,
      data: { started: false, reason: 'no-workspace' }
    })
    await render()
    type('x')
    await act(async () => {
      ;(byTestId('agent-task-start') as HTMLButtonElement).click()
    })

    await render({ view: false })
    await render()

    expect(byTestId('agent-task-rejected')?.textContent).toContain('Workspace')
  })

  it('閉じても出し直しても、Main へは何も送らず、購読も張り直さない', async () => {
    await render()
    push({ status: 'running', phase: 'reading', loopsUsed: 2 })

    await render({ view: false })
    await render()

    expect(agentTaskApi.stop).not.toHaveBeenCalled()
    expect(agentTaskApi.start).not.toHaveBeenCalled()
    expect(agentTaskApi.continueTask).not.toHaveBeenCalled()
    expect(agentTaskApi.onStateChanged).toHaveBeenCalledTimes(1)
    expect(agentTaskApi.getState).toHaveBeenCalledTimes(1)
    // 出し直した瞬間から、閉じている間の状態がそのまま見える（初期値に戻らない）。
    expect(byTestId('agent-task-status')?.textContent).toContain('ファイル確認中')
    expect(byTestId('agent-task-stop')).not.toBeNull()
  })

  it('閉じている間に届いた状態も、出し直すと見える', async () => {
    await render({ view: false })
    push({ status: 'awaiting-continue', loopsUsed: 20, loopLimit: 20 })

    await render()

    expect(byTestId('agent-task-limit')).not.toBeNull()
  })

  it('状態が届く前は、OFF / Provider 無しの案内を出さない', async () => {
    agentTaskApi.getState.mockReturnValue(new Promise(() => {}))
    await render()

    expect(byTestId('agent-task-disabled')).toBeNull()
    expect(byTestId('agent-task-no-provider')).toBeNull()

    push({ agentEnabled: false })
    expect(byTestId('agent-task-disabled')).not.toBeNull()
  })
})

describe('状態の取得と知らせが近接して届く場合（AgentTaskProvider）', () => {
  /** 取得の返事を、テストが決めた瞬間に届ける。 */
  function deferredGetState(): (state: AgentTaskState) => Promise<void> {
    let resolve: ((value: unknown) => void) | null = null
    agentTaskApi.getState.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )

    return async (state) => {
      await act(async () => {
        resolve?.({ ok: true, data: state })
      })
    }
  }

  it('知らせ → 返事 の順なら、後から届いた返事を採る（設定の変化は返事にしか出ない）', async () => {
    const reply = deferredGetState()
    await render({ view: true })

    push({ status: 'running', phase: 'reading', agentEnabled: true })
    await reply({ ...IDLE, status: 'running', phase: 'reading', agentEnabled: false })

    expect(byTestId('agent-task-disabled')).not.toBeNull()
    expect(byTestId('agent-task-status')?.dataset.status).toBe('running')
  })

  it('返事 → 知らせ の順なら、後から届いた知らせを採る', async () => {
    const reply = deferredGetState()
    await render()

    await reply({ ...IDLE, status: 'running', phase: 'reading' })
    push({ status: 'awaiting-continue', loopsUsed: 20, loopLimit: 20 })

    expect(byTestId('agent-task-limit')).not.toBeNull()
    expect(byTestId('statusbar-agent')?.dataset.agentStatus).toBe('awaiting')
  })

  it('同じ瞬間に続けて届いても、パネルとステータスバーは同じ状態を描く', async () => {
    const reply = deferredGetState()
    await render()

    await act(async () => {
      emit?.({ ...IDLE, status: 'running', phase: 'searching' })
      emit?.({ ...IDLE, status: 'stopping' })
    })
    await reply({ ...IDLE, status: 'stopping' })

    expect(byTestId('agent-task-status')?.dataset.status).toBe('stopping')
    expect(byTestId('statusbar-agent')?.dataset.agentStatus).toBe('running')
    expect((byTestId('agent-task-stop') as HTMLButtonElement).disabled).toBe(true)
  })

  it('取得が失敗しても、知らせで状態が揃う', async () => {
    agentTaskApi.getState.mockResolvedValue({ ok: false, error: { code: 'x', message: 'x' } })
    await render()

    expect(byTestId('agent-task-disabled')).toBeNull()

    push({ status: 'running', phase: 'reading' })
    expect(byTestId('agent-task-status')?.dataset.status).toBe('running')
    expect(byTestId('statusbar-agent')).not.toBeNull()
  })

  it('パネルを外している間に届いた返事も、出し直したパネルとステータスバーに同じく出る', async () => {
    const reply = deferredGetState()
    await render({ view: false })

    await reply({ ...IDLE, status: 'awaiting-continue', loopsUsed: 20, loopLimit: 20 })
    await render()

    expect(byTestId('agent-task-limit')).not.toBeNull()
    expect(byTestId('statusbar-agent')?.dataset.agentStatus).toBe('awaiting')
  })
})

describe('ステータスバーの表示', () => {
  it('動いていなければ何も出さない', async () => {
    await render()

    expect(byTestId('statusbar-agent')).toBeNull()

    push({ status: 'completed', endReason: 'completed', finalAnswer: 'ok' })
    expect(byTestId('statusbar-agent')).toBeNull()
  })

  it('動作中・止めている途中は「動作中」、上限の返事待ちは「確認待ち」', async () => {
    await render({ view: false })

    push({ status: 'running', phase: 'searching' })
    expect(byTestId('statusbar-agent')?.textContent).toBe('Agent: 動作中')
    expect(byTestId('statusbar-agent')?.dataset.agentStatus).toBe('running')
    expect(byTestId('statusbar-agent')?.title).toContain('検索中')

    push({ status: 'stopping' })
    expect(byTestId('statusbar-agent')?.dataset.agentStatus).toBe('running')

    push({ status: 'awaiting-continue', loopsUsed: 20, loopLimit: 20 })
    expect(byTestId('statusbar-agent')?.textContent).toBe('Agent: 確認待ち')
    expect(byTestId('statusbar-agent')?.dataset.agentStatus).toBe('awaiting')
  })

  it('出ているだけではパネルを開かない。押したときだけ開く', async () => {
    const onShowPanel = vi.fn()
    await render({ view: false, onShowPanel })

    push({ status: 'awaiting-continue', loopsUsed: 20, loopLimit: 20 })
    expect(onShowPanel).not.toHaveBeenCalled()

    act(() => (byTestId('statusbar-agent') as HTMLButtonElement).click())
    expect(onShowPanel).toHaveBeenCalledTimes(1)
    // 押しても Main へは何も送らない（返事はパネルの中のボタンだけ）。
    expect(agentTaskApi.continueTask).not.toHaveBeenCalled()
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
