/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import type { PanelId } from '../workspace/panels/types'
import { WorkspaceTopBar } from '../workspace/shell/WorkspaceTopBar'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { EMPTY_FEEDBACK_DRAFT, type FeedbackDraft } from './feedbackForm'
import { FeedbackOverlay } from './FeedbackOverlay'
import type { FeedbackSender } from './feedbackSender'

function mockWorkspace(): WorkspaceFolderController {
  return {
    status: 'ready',
    workspace: null,
    unavailableRootPath: null,
    error: null,
    busy: false,
    openFolder: vi.fn(),
    closeWorkspace: vi.fn()
  }
}

/**
 * WorkspaceShell と同じ持ち方（開閉と下書きは外側、面は中身だけ）を再現する。
 * Shell そのものはレイアウトの復元や Dock を抱えているため、ここでは使わない。
 */
function FeedbackHarness({ sender }: { readonly sender?: FeedbackSender }): ReactElement {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_FEEDBACK_DRAFT)
  const visiblePanelIds: ReadonlySet<PanelId> = new Set(['files', 'editor'])

  return createElement(
    I18nContext.Provider,
    { value: { language: 'ja', setLanguage: vi.fn(), t: createTranslator('ja') } },
    createElement(
      WorkspaceFolderContext.Provider,
      { value: mockWorkspace() },
      createElement(WorkspaceTopBar, {
        visiblePanelIds,
        presetId: 'default',
        modified: false,
        onTogglePanel: vi.fn(),
        onApplyPreset: vi.fn(),
        onResetLayout: vi.fn(),
        settingsOpen: false,
        onOpenSettings: vi.fn(),
        feedbackOpen: open,
        onOpenFeedback: () => setOpen(true)
      }),
      open &&
        createElement(FeedbackOverlay, {
          draft,
          onDraftChange: setDraft,
          onClose: () => setOpen(false),
          sender
        })
    )
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function renderHarness(sender?: FeedbackSender): Promise<void> {
  await act(async () => {
    root.render(createElement(FeedbackHarness, { sender }))
  })
}

function query<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return container.querySelector<T>(`[data-testid="${testId}"]`)
}

function byTestId<T extends HTMLElement = HTMLElement>(testId: string): T {
  const element = query<T>(testId)

  expect(element, testId).not.toBeNull()

  return element as T
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    byTestId(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function typeDetail(value: string): Promise<void> {
  const textarea = byTestId<HTMLTextAreaElement>('feedback-detail')
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

  await act(async () => {
    setValue?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function pressEscape(init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ...init }))
  })
}

async function openFeedback(sender?: FeedbackSender): Promise<void> {
  await renderHarness(sender)
  await click('topbar-feedback')
}

function selectedCategories(): readonly string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid^="feedback-category-"][role="radio"]')
  )
    .filter((element) => element.getAttribute('aria-checked') === 'true')
    .map((element) => element.dataset.testid ?? '')
}

describe('FeedbackOverlay', () => {
  it('上部バーの「フィードバック」から開き、× と Esc で閉じる', async () => {
    await renderHarness()

    expect(byTestId('topbar-feedback').textContent).toBe('フィードバック')
    expect(query('feedback')).toBeNull()

    await click('topbar-feedback')
    expect(byTestId('feedback').getAttribute('role')).toBe('dialog')
    expect(byTestId('topbar-feedback').dataset.open).toBe('true')

    await click('feedback-close')
    expect(query('feedback')).toBeNull()

    await click('topbar-feedback')
    await pressEscape()
    expect(query('feedback')).toBeNull()
  })

  it('日本語入力の変換中の Esc では閉じない', async () => {
    await openFeedback()

    await pressEscape({ isComposing: true })

    expect(query('feedback')).not.toBeNull()
  })

  it('5種類の種別を並べ、1つだけ選べる', async () => {
    await openFeedback()

    const labels = Array.from(
      byTestId('feedback-category').querySelectorAll<HTMLButtonElement>('[role="radio"]')
    ).map((button) => button.textContent)
    expect(labels).toEqual(['バグ', 'Bad', 'Good', '安全性チェック', 'その他'])
    expect(selectedCategories()).toEqual([])

    for (const category of ['bug', 'bad', 'good', 'safety', 'other']) {
      await click(`feedback-category-${category}`)
      expect(selectedCategories()).toEqual([`feedback-category-${category}`])
    }
  })

  it('詳細に複数行の長い内容を入力できる', async () => {
    await openFeedback()

    const detail = Array.from({ length: 200 }, (_, index) => `${index + 1}行目の内容`).join('\n')
    await typeDetail(detail)

    const textarea = byTestId<HTMLTextAreaElement>('feedback-detail')
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea.value).toBe(detail)
  })

  it('開いた直後はエラーを出さない', async () => {
    await openFeedback()

    expect(query('feedback-category-error')).toBeNull()
    expect(query('feedback-detail-error')).toBeNull()
  })

  it('種別が未選択なら送信せず、エラーを出す', async () => {
    const send = vi.fn<FeedbackSender['send']>(async () => ({ ok: true }))
    await openFeedback({ send })

    await typeDetail('保存すると固まります')
    await click('feedback-submit')

    expect(send).not.toHaveBeenCalled()
    expect(byTestId('feedback-category-error').textContent).toBe(
      'フィードバックの種別を選んでください。'
    )
    expect(byTestId('feedback-category').getAttribute('aria-invalid')).toBe('true')
    expect(query('feedback-detail-error')).toBeNull()
    expect(byTestId('feedback-status').textContent).toBe('')
    // 直す場所（種別の先頭）へ focus が移る。
    expect(document.activeElement).toBe(byTestId('feedback-category-bug'))

    // 選べばその場で消える。
    await click('feedback-category-bug')
    expect(query('feedback-category-error')).toBeNull()
  })

  it('詳細が空なら送信せず、エラーを出す', async () => {
    const send = vi.fn<FeedbackSender['send']>(async () => ({ ok: true }))
    await openFeedback({ send })

    await click('feedback-category-good')
    await click('feedback-submit')

    expect(send).not.toHaveBeenCalled()
    expect(byTestId('feedback-detail-error').textContent).toBe('詳細を入力してください。')
    expect(byTestId('feedback-detail').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(byTestId('feedback-detail'))
  })

  it('詳細が空白だけなら送信せず、エラーを出す', async () => {
    const send = vi.fn<FeedbackSender['send']>(async () => ({ ok: true }))
    await openFeedback({ send })

    await click('feedback-category-bad')
    await typeDetail('  \n　\t ')
    await click('feedback-submit')

    expect(send).not.toHaveBeenCalled()
    expect(byTestId('feedback-detail-error').textContent).toBe(
      '空白だけでは送信できません。内容を入力してください。'
    )

    await typeDetail('  重いです ')
    expect(query('feedback-detail-error')).toBeNull()
  })

  it('何も入力せずに送信すると両方のエラーを出す', async () => {
    await openFeedback()

    await click('feedback-submit')

    expect(query('feedback-category-error')).not.toBeNull()
    expect(query('feedback-detail-error')).not.toBeNull()
  })

  it('正しい入力なら送り先へ渡し、完了を出して入力を空に戻す', async () => {
    const send = vi.fn<FeedbackSender['send']>(async () => ({ ok: true }))
    await openFeedback({ send })

    await click('feedback-category-safety')
    await typeDetail('\n  外部へ通信していないか確認しました  \n')
    await click('feedback-submit')

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      category: 'safety',
      detail: '外部へ通信していないか確認しました'
    })
    expect(byTestId('feedback-status').textContent).toBe(
      'フィードバックを受け付けました。ありがとうございます。'
    )
    expect(byTestId('feedback-status').dataset.outcome).toBe('accepted')
    expect(byTestId<HTMLTextAreaElement>('feedback-detail').value).toBe('')
    expect(selectedCategories()).toEqual([])
    // 空に戻したことをエラーとして責めない。
    expect(query('feedback-category-error')).toBeNull()
    expect(query('feedback-detail-error')).toBeNull()

    // 次を書き始めたら完了の表示は消える。
    await click('feedback-category-other')
    expect(byTestId('feedback-status').textContent).toBe('')
  })

  it('既定の送り先（v1）でも受け付けて入力を空に戻す', async () => {
    await openFeedback()

    await click('feedback-category-bug')
    await typeDetail('テスト')
    await click('feedback-submit')

    expect(byTestId('feedback-status').dataset.outcome).toBe('accepted')
    expect(byTestId<HTMLTextAreaElement>('feedback-detail').value).toBe('')
  })

  it('閉じても書きかけの内容は残る', async () => {
    await openFeedback()

    await click('feedback-category-good')
    await typeDetail('書きかけ')
    await pressEscape()
    await click('topbar-feedback')

    expect(byTestId<HTMLTextAreaElement>('feedback-detail').value).toBe('書きかけ')
    expect(selectedCategories()).toEqual(['feedback-category-good'])
  })

  it('送り先が失敗したら入力を残し、失敗を出す', async () => {
    const send = vi.fn<FeedbackSender['send']>(async () => ({ ok: false }))
    await openFeedback({ send })

    await click('feedback-category-bug')
    await typeDetail('消えては困る内容')
    await click('feedback-submit')

    expect(byTestId('feedback-status').dataset.outcome).toBe('failed')
    expect(byTestId<HTMLTextAreaElement>('feedback-detail').value).toBe('消えては困る内容')
    expect(selectedCategories()).toEqual(['feedback-category-bug'])
  })

  it('送り先が例外を投げても失敗として扱う', async () => {
    const send = vi.fn<FeedbackSender['send']>(async () => {
      throw new Error('network')
    })
    await openFeedback({ send })

    await click('feedback-category-bug')
    await typeDetail('内容')
    await click('feedback-submit')

    expect(byTestId('feedback-status').dataset.outcome).toBe('failed')
    expect(byTestId<HTMLTextAreaElement>('feedback-detail').value).toBe('内容')
  })
})
