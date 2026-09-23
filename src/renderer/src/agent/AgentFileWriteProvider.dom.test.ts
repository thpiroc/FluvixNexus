/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentFileWriteProposedEvent, ApprovalRequestedEvent } from '@shared/ipc'
import type { SafeFileWriteDiff } from '@shared/security'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { AgentFileWriteProvider } from './AgentFileWriteProvider'

/**
 * FN Agent の変更の確認（Security Core v1 の STEP7。第1段階の画面）。
 *
 * 固定したいのは4つ。
 *
 *   - 揃ったときだけ出る（取り違えた Diff を見せない）
 *   - **内容を編集できる要素が1つも無い**
 *   - Renderer が返すのは `approvalId` / `actionKind` / `intent` の3つだけ
 *   - Main から届いた文字列は**文字として**描かれる（HTML として解釈されない）
 */

const agentApi = vi.hoisted(() => ({
  onFileWriteProposed: vi.fn(),
  onFileWriteSettled: vi.fn()
}))

const approvalApi = vi.hoisted(() => ({
  onRequested: vi.fn(),
  respond: vi.fn()
}))

vi.mock('../api/fluvix', () => ({ fluvix: { agent: agentApi, approval: approvalApi } }))

let container: HTMLDivElement
let root: Root
let emitProposed: ((event: AgentFileWriteProposedEvent) => void) | null
let emitSettled: ((event: { readonly proposalId: string }) => void) | null
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

  agentApi.onFileWriteProposed.mockImplementation((listener) => {
    emitProposed = listener
    return () => {}
  })
  agentApi.onFileWriteSettled.mockImplementation((listener) => {
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
    createElement(AgentFileWriteProvider, null)
  )
}

const APPROVAL_ID = '11111111-1111-4111-8111-111111111111'

function diffOf(overrides: Partial<SafeFileWriteDiff> = {}): SafeFileWriteDiff {
  return {
    lines: [
      { kind: 'context', oldLine: 1, newLine: 1, text: 'one' },
      { kind: 'removed', oldLine: 2, newLine: null, text: 'two' },
      { kind: 'added', oldLine: null, newLine: 2, text: 'TWO' }
    ],
    addedCount: 1,
    removedCount: 1,
    truncated: false,
    secretMasked: false,
    ...overrides
  }
}

/** Main から2つの知らせが届いた状態にする。 */
function propose(
  proposal: Partial<AgentFileWriteProposedEvent> = {},
  approval: Partial<ApprovalRequestedEvent> = {}
): void {
  act(() => {
    emitProposed?.({
      proposalId: 'p1',
      workspacePath: 'src/app.ts',
      newFile: false,
      diff: diffOf(),
      ...proposal
    })
  })

  act(() => {
    emitApproval?.({
      approvalId: APPROVAL_ID,
      actionKind: 'file.write',
      subject: 'src/app.ts',
      workspacePath: 'src/app.ts',
      commandSummary: null,
      expiresAt: 0,
      ...approval
    })
  })
}

function dialog(): HTMLElement | null {
  return container.querySelector('[data-testid="agent-file-write-dialog"]')
}

function click(testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)

  if (button === null) {
    throw new Error(`no button: ${testId}`)
  }

  act(() => button.click())
}

describe('出す / 出さない', () => {
  it('何も届いていなければ、画面に何も出ない', () => {
    render()

    expect(dialog()).toBeNull()
  })

  it('提案だけでは出ない（承認の知らせを待つ）', () => {
    render()
    act(() => {
      emitProposed?.({
        proposalId: 'p1',
        workspacePath: 'src/app.ts',
        newFile: false,
        diff: diffOf()
      })
    })

    expect(dialog()).toBeNull()
  })

  it('2つ揃えば出る', () => {
    render()
    propose()

    expect(dialog()).not.toBeNull()
  })

  it('Terminal の承認では出ない', () => {
    render()
    propose({}, { actionKind: 'terminal.run' })

    expect(dialog()).toBeNull()
  })

  it('別の変更を指していたら、出さずに取り消す', () => {
    render()
    propose({}, { workspacePath: 'other.ts' })

    expect(dialog()).toBeNull()
    expect(approvalApi.respond).toHaveBeenCalledWith({
      approvalId: APPROVAL_ID,
      actionKind: 'file.write',
      intent: 'cancel'
    })
  })

  it('終わったと知らされたら閉じる', () => {
    render()
    propose()

    act(() => {
      emitSettled?.({ proposalId: 'p1' })
    })

    expect(dialog()).toBeNull()
  })
})

describe('見せるもの', () => {
  it('Workspace 相対の Path を出す', () => {
    render()
    propose()

    expect(container.querySelector('[data-testid="agent-file-write-path"]')?.textContent).toContain(
      'src/app.ts'
    )
  })

  it('Diff の行をすべて出す', () => {
    render()
    propose()

    const lines = [...container.querySelectorAll('[data-testid="agent-file-write-diff"] li')]

    expect(lines.length).toBe(3)
    expect(lines.map((line) => line.getAttribute('data-kind'))).toEqual([
      'context',
      'removed',
      'added'
    ])
    expect(lines[2].textContent).toContain('TWO')
  })

  it('足した行と消した行の数を出す', () => {
    render()
    propose()

    expect(
      container.querySelector('[data-testid="agent-file-write-counts"]')?.textContent
    ).toContain('+1')
  })

  it('新規ファイルであることを出す', () => {
    render()
    propose({ newFile: true })

    expect(dialog()?.textContent).toContain('新規ファイル')
  })

  it('切ったことを伝える', () => {
    render()
    propose({ diff: diffOf({ truncated: true }) })

    expect(container.querySelector('[data-testid="agent-file-write-truncated"]')).not.toBeNull()
  })

  it('Secret を伏せたことを伝える', () => {
    render()
    propose({ diff: diffOf({ secretMasked: true }) })

    expect(container.querySelector('[data-testid="agent-file-write-masked"]')).not.toBeNull()
  })

  it('Diff が空でも、画面は出る', () => {
    render()
    propose({ diff: diffOf({ lines: [], addedCount: 0, removedCount: 0 }) })

    expect(dialog()).not.toBeNull()
    expect(container.querySelector('[data-testid="agent-file-write-diff"]')).toBeNull()
  })
})

describe('中身は編集できない', () => {
  it('入力できる要素が1つも無い', () => {
    render()
    propose()

    expect(dialog()?.querySelectorAll('input, textarea, select').length).toBe(0)
    expect(dialog()?.querySelectorAll('[contenteditable]').length).toBe(0)
  })

  it('置いてあるのは、取り消すと続けるの2つだけ', () => {
    render()
    propose()

    expect([...(dialog()?.querySelectorAll('button') ?? [])].map((b) => b.dataset.testid)).toEqual([
      'agent-file-write-cancel',
      'agent-file-write-continue'
    ])
  })
})

describe('Main から届いた文字列', () => {
  it('HTML として解釈されない（文字として描かれる）', () => {
    render()
    propose({
      diff: diffOf({
        lines: [
          {
            kind: 'added',
            oldLine: null,
            newLine: 1,
            text: '<img src=x onerror="document.title=1">'
          }
        ]
      })
    })

    expect(dialog()?.querySelectorAll('img').length).toBe(0)
    expect(dialog()?.textContent).toContain('<img src=x onerror="document.title=1">')
  })

  it('Path も文字として描かれる', () => {
    render()
    propose({ workspacePath: '<b>bold</b>.ts' }, { workspacePath: '<b>bold</b>.ts' })

    expect(dialog()).not.toBeNull()
    expect(dialog()?.querySelectorAll('b').length).toBe(0)
    expect(dialog()?.textContent).toContain('<b>bold</b>.ts')
  })
})

describe('返すもの', () => {
  it('続けるは、承認の識別子と intent だけを返す', () => {
    render()
    propose()
    click('agent-file-write-continue')

    expect(approvalApi.respond).toHaveBeenCalledTimes(1)
    expect(approvalApi.respond).toHaveBeenCalledWith({
      approvalId: APPROVAL_ID,
      actionKind: 'file.write',
      intent: 'continue'
    })
  })

  it('取り消すも、同じ3つだけを返す', () => {
    render()
    propose()
    click('agent-file-write-cancel')

    expect(approvalApi.respond).toHaveBeenCalledWith({
      approvalId: APPROVAL_ID,
      actionKind: 'file.write',
      intent: 'cancel'
    })
  })

  it('本文も Diff も fingerprint も返さない', () => {
    render()
    propose()
    click('agent-file-write-continue')

    const sent = JSON.stringify(approvalApi.respond.mock.calls[0][0])

    expect(sent).not.toContain('TWO')
    expect(sent).not.toMatch(/diff|content|fingerprint|approved|proposalId/i)
  })

  it('続けた後は、返事が済むまで押せない', () => {
    render()
    propose()
    click('agent-file-write-continue')

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="agent-file-write-continue"]')
        ?.disabled
    ).toBe(true)
  })

  it('続けた後も、Main が終わったと言うまで画面は残る', () => {
    render()
    propose()
    click('agent-file-write-continue')

    expect(dialog()).not.toBeNull()
  })
})
