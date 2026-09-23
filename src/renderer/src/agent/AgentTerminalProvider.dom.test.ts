/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentTerminalProposedEvent,
  AgentTerminalSettledEvent,
  ApprovalRequestedEvent
} from '@shared/ipc'
import type { SafeTerminalCommandDisplay, SafeTerminalRunResult } from '@shared/security'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { matchAgentTerminal } from './agentTerminalPrompt'
import { AgentTerminalProvider } from './AgentTerminalProvider'

/**
 * FN Agent の Terminal の確認と結果（Security Core v1 の STEP8。第1段階の画面）。
 *
 *   - 揃ったときだけ出る（別のコマンドを見せて承認させない）
 *   - コマンドと引数を**省略せずに**、1つずつ見せる
 *   - **編集できる要素が1つも無い**
 *   - Renderer が返すのは `approvalId` / `actionKind` / `intent` の3つだけ
 *   - Main から届いた文字列は**文字として**描かれる
 *   - 実行した結果（伏せた後の出力）は見るだけ
 */

const agentApi = vi.hoisted(() => ({
  onFileWriteProposed: vi.fn(),
  onFileWriteSettled: vi.fn(),
  onTerminalProposed: vi.fn(),
  onTerminalSettled: vi.fn()
}))

const approvalApi = vi.hoisted(() => ({
  onRequested: vi.fn(),
  respond: vi.fn()
}))

vi.mock('../api/fluvix', () => ({ fluvix: { agent: agentApi, approval: approvalApi } }))

let container: HTMLDivElement
let root: Root
let emitProposed: ((event: AgentTerminalProposedEvent) => void) | null
let emitSettled: ((event: AgentTerminalSettledEvent) => void) | null
let emitApproval: ((event: ApprovalRequestedEvent) => void) | null

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  emitProposed = null
  emitSettled = null
  emitApproval = null

  agentApi.onTerminalProposed.mockImplementation((listener) => {
    emitProposed = listener
    return () => {}
  })
  agentApi.onTerminalSettled.mockImplementation((listener) => {
    emitSettled = listener
    return () => {}
  })
  approvalApi.onRequested.mockImplementation((listener) => {
    emitApproval = listener
    return () => {}
  })
  approvalApi.respond.mockResolvedValue({ ok: true, data: undefined })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

function render(): void {
  act(() => root.render(harness()))
}

function harness(): ReactElement {
  return createElement(
    I18nContext.Provider,
    { value: { language: 'ja', setLanguage: () => {}, t: createTranslator('ja') } },
    createElement(AgentTerminalProvider, null)
  )
}

const APPROVAL_ID = '22222222-2222-4222-8222-222222222222'

function commandOf(
  overrides: Partial<SafeTerminalCommandDisplay> = {}
): SafeTerminalCommandDisplay {
  return {
    commandName: 'git',
    commandArgs: ['commit', '-m', 'a "b" c', ''],
    commandSummary: 'git commit -m "a "b" c" ""',
    workspacePath: null,
    viaBatch: false,
    secretMasked: false,
    ...overrides
  }
}

function propose(
  command: Partial<SafeTerminalCommandDisplay> = {},
  approval: Partial<ApprovalRequestedEvent> = {}
): void {
  const display = commandOf(command)

  act(() => {
    emitProposed?.({ proposalId: 'p1', command: display })
  })

  act(() => {
    emitApproval?.({
      approvalId: APPROVAL_ID,
      actionKind: 'terminal.run',
      subject: display.commandName,
      workspacePath: display.workspacePath,
      commandSummary: display.commandSummary,
      expiresAt: 0,
      ...approval
    })
  })
}

function byTestId(testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

function click(testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)

  if (button === null) {
    throw new Error(`no button: ${testId}`)
  }

  act(() => button.click())
}

function result(overrides: Partial<SafeTerminalRunResult> = {}): SafeTerminalRunResult {
  return {
    status: 'completed',
    exitCode: 0,
    output: {
      lines: ['line 1', 'GITHUB_TOKEN=***REDACTED***'],
      truncated: false,
      secretMasked: true,
      withheld: false
    },
    ...overrides
  }
}

describe('出す / 出さない', () => {
  it('何も届いていない・提案だけ、では出ない', () => {
    render()

    expect(byTestId('agent-terminal-dialog')).toBeNull()

    act(() => {
      emitProposed?.({ proposalId: 'p1', command: commandOf() })
    })

    expect(byTestId('agent-terminal-dialog')).toBeNull()
  })

  it('2つ揃えば出る', () => {
    render()
    propose()

    expect(byTestId('agent-terminal-dialog')).not.toBeNull()
  })

  it('File Write の承認では出ない', () => {
    render()
    propose({}, { actionKind: 'file.write' })

    expect(byTestId('agent-terminal-dialog')).toBeNull()
  })

  it('別のコマンド・別の場所を指していたら、出さずに取り消す', () => {
    for (const approval of [{ commandSummary: 'git push' }, { workspacePath: 'other' }]) {
      render()
      propose({}, approval)

      expect(byTestId('agent-terminal-dialog')).toBeNull()
      expect(approvalApi.respond).toHaveBeenLastCalledWith({
        approvalId: APPROVAL_ID,
        actionKind: 'terminal.run',
        intent: 'cancel'
      })
    }
  })
})

describe('省略せずに見せる', () => {
  it('コマンド名・引数を1つずつ・場所を出す（空の引数も数に入る）', () => {
    render()
    propose()

    expect(byTestId('agent-terminal-command')?.textContent).toBe('git')

    const args = [...(byTestId('agent-terminal-args')?.querySelectorAll('li') ?? [])]

    expect(args.map((item) => item.textContent)).toEqual([
      '1commit',
      '2-m',
      '3a "b" c',
      '4（空の引数）'
    ])
    expect(byTestId('agent-terminal-cwd')?.textContent).toBe('Workspace のルート')
  })

  it('長い引数も切らずに全部出す', () => {
    const long = `--message=${'x'.repeat(1_500)}`

    render()
    propose({ commandArgs: [long], commandSummary: `git ${long}` })

    expect(byTestId('agent-terminal-args')?.textContent).toContain(long)
    expect(byTestId('agent-terminal-args')?.textContent).not.toContain('…')
  })

  it('権限の注意は常に、.cmd と Secret の注意は該当するときだけ出る', () => {
    render()
    propose()

    expect(byTestId('agent-terminal-privilege')).not.toBeNull()
    expect(byTestId('agent-terminal-via-batch')).toBeNull()
    expect(byTestId('agent-terminal-masked')).toBeNull()

    act(() => {
      emitSettled?.({ proposalId: 'p1', result: null })
    })

    propose({ viaBatch: true, secretMasked: true })

    expect(byTestId('agent-terminal-via-batch')).not.toBeNull()
    expect(byTestId('agent-terminal-masked')).not.toBeNull()
  })

  it('届いた文字列は HTML として解釈されない', () => {
    render()
    propose({
      commandArgs: ['<img src=x onerror="alert(1)">'],
      commandSummary: 'git "<img src=x onerror="alert(1)">"'
    })

    expect(container.querySelector('img')).toBeNull()
    expect(byTestId('agent-terminal-args')?.textContent).toContain('<img src=x')
  })

  it('編集できる要素は1つも無い', () => {
    render()
    propose()

    expect(container.querySelector('input, textarea, select, [contenteditable]')).toBeNull()
  })
})

describe('返すのは意思表示だけ', () => {
  it('続けると approvalId / actionKind / intent の3つだけを返し、画面は押せないまま残る', () => {
    render()
    propose()
    click('agent-terminal-continue')

    expect(approvalApi.respond).toHaveBeenCalledWith({
      approvalId: APPROVAL_ID,
      actionKind: 'terminal.run',
      intent: 'continue'
    })
    expect(Object.keys(approvalApi.respond.mock.calls[0][0]).sort()).toEqual([
      'actionKind',
      'approvalId',
      'intent'
    ])
    expect(byTestId('agent-terminal-dialog')).not.toBeNull()
    expect((byTestId('agent-terminal-continue') as HTMLButtonElement).disabled).toBe(true)
    expect((byTestId('agent-terminal-cancel') as HTMLButtonElement).disabled).toBe(true)
  })

  it('取り消すと cancel を返す。初期 focus は取り消し', () => {
    render()
    propose()

    expect(document.activeElement).toBe(byTestId('agent-terminal-cancel'))

    click('agent-terminal-cancel')

    expect(approvalApi.respond).toHaveBeenCalledWith({
      approvalId: APPROVAL_ID,
      actionKind: 'terminal.run',
      intent: 'cancel'
    })
  })
})

describe('終わったとき', () => {
  it('実行しなかった（結果なし）なら、そのまま閉じる', () => {
    render()
    propose()

    act(() => {
      emitSettled?.({ proposalId: 'p1', result: null })
    })

    expect(byTestId('agent-terminal-dialog')).toBeNull()
    expect(byTestId('agent-terminal-result')).toBeNull()
  })

  it('別の提案の終わりでは閉じない', () => {
    render()
    propose()

    act(() => {
      emitSettled?.({ proposalId: 'other', result: null })
    })

    expect(byTestId('agent-terminal-dialog')).not.toBeNull()
  })

  it('実行したなら、伏せた後の出力を見せ、閉じるまで残る', () => {
    render()
    propose()

    act(() => {
      emitSettled?.({ proposalId: 'p1', result: result() })
    })

    expect(byTestId('agent-terminal-dialog')).toBeNull()
    expect(byTestId('agent-terminal-result')).not.toBeNull()
    expect(byTestId('agent-terminal-status')?.textContent).toBe('終了コード 0 で終了しました')
    expect(byTestId('agent-terminal-output')?.textContent).toBe(
      'line 1\nGITHUB_TOKEN=***REDACTED***'
    )
    expect(byTestId('agent-terminal-output-masked')).not.toBeNull()
    expect(container.querySelector('input, textarea, select, [contenteditable]')).toBeNull()

    click('agent-terminal-close')

    expect(byTestId('agent-terminal-result')).toBeNull()
  })

  it('時間切れ・検査できなかった出力は、その旨だけを出す', () => {
    render()
    propose()

    act(() => {
      emitSettled?.({
        proposalId: 'p1',
        result: result({
          status: 'timed-out',
          exitCode: null,
          output: { lines: [], truncated: false, secretMasked: false, withheld: true }
        })
      })
    })

    expect(byTestId('agent-terminal-status')?.textContent).toBe('120 秒を過ぎたため終了させました')
    expect(byTestId('agent-terminal-withheld')).not.toBeNull()
    expect(byTestId('agent-terminal-output')).toBeNull()
  })
})

describe('matchAgentTerminal', () => {
  it('1行の要約と場所が完全に一致するときだけ ready', () => {
    const proposal = { proposalId: 'p1', command: commandOf({ workspacePath: 'pkg' }) }
    const approval: ApprovalRequestedEvent = {
      approvalId: APPROVAL_ID,
      actionKind: 'terminal.run',
      subject: 'git',
      workspacePath: 'pkg',
      commandSummary: proposal.command.commandSummary,
      expiresAt: 0
    }

    expect(matchAgentTerminal(proposal, approval).kind).toBe('ready')
    expect(matchAgentTerminal(proposal, { ...approval, workspacePath: null }).kind).toBe('mismatch')
    expect(
      matchAgentTerminal(proposal, { ...approval, commandSummary: `${approval.commandSummary}…` })
        .kind
    ).toBe('mismatch')
    expect(matchAgentTerminal(null, approval).kind).toBe('waiting')
    expect(matchAgentTerminal(proposal, null).kind).toBe('waiting')
  })
})
