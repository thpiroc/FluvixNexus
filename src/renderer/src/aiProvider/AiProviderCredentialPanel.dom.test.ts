/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type {
  AiProviderCredentialFailure,
  AiProviderCredentialState,
  AiProviderCredentialStatus
} from '@shared/aiProvider'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { AiProviderCredentialPanel } from './AiProviderCredentialPanel'

/**
 * AI Provider の API Key の面（AiProviderCredentialPanel.tsx。STEP10-5）。
 *
 * Main の代わりに、状態だけを持つ偽の `fluvix.aiProvider` を置く。**偽物にも Key を返す関数は
 * 無い**（3つ以外の名前に触れたら落ちる Proxy）。確かめるのは「入れた Key が画面・state・
 * console・ブラウザの保存に残らない」「状態だけが出る」「置き換え・削除ができる」。
 * Key はすべて架空のもの。
 */

const CANARY = 'sk-fn-test-CANARY-renderer-9b7d5f3a1c'
const REPLACED = 'sk-fn-test-REPLACED-renderer-2e4c6a8f0d'

let container: HTMLDivElement
let root: Root
let state: AiProviderCredentialState
let canStore: boolean
let nextFailure: AiProviderCredentialFailure | null
let ipcFails: boolean
let hasCredential: ReturnType<typeof vi.fn>
let setCredential: ReturnType<typeof vi.fn>
let deleteCredential: ReturnType<typeof vi.fn>
let consoleSpies: MockInstance[]

function status(): AiProviderCredentialStatus {
  return { providerId: 'openai', state, canStore }
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  state = 'not-set'
  canStore = true
  nextFailure = null
  ipcFails = false

  hasCredential = vi.fn(async () => ({ ok: true, data: status() }))
  setCredential = vi.fn(async () => {
    if (ipcFails) {
      return { ok: false, error: { code: 'INTERNAL', message: 'failed' } }
    }

    if (nextFailure !== null) {
      return { ok: true, data: { ok: false, failure: nextFailure, status: status() } }
    }

    state = 'set'
    return { ok: true, data: { ok: true, status: status() } }
  })
  deleteCredential = vi.fn(async () => {
    state = 'not-set'
    return { ok: true, data: { ok: true, status: status() } }
  })

  const aiProvider = { hasCredential, setCredential, deleteCredential }

  ;(globalThis as { fluvix?: unknown }).fluvix = {
    aiProvider: new Proxy(aiProvider, {
      get(target, name) {
        if (!Object.hasOwn(target, name)) {
          throw new Error(`the panel touched fluvix.aiProvider.${String(name)}`)
        }
        return target[name as keyof typeof target]
      }
    })
  }

  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method)
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  delete (globalThis as { fluvix?: unknown }).fluvix
  vi.restoreAllMocks()
})

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function render(): Promise<void> {
  act(() =>
    root.render(
      createElement(
        I18nContext.Provider,
        { value: { language: 'ja', setLanguage: () => {}, t: createTranslator('ja') } },
        createElement(AiProviderCredentialPanel)
      )
    )
  )
  await flush()
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = container.querySelector<T>(`[data-testid="${id}"]`)

  expect(element, id).not.toBeNull()

  return element as T
}

function input(): HTMLInputElement {
  return byTestId<HTMLInputElement>('settings-ai-provider-credential-input-openai')
}

function type(text: string): void {
  act(() => {
    const element = input()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickSave(): Promise<void> {
  act(() => {
    byTestId('settings-ai-provider-credential-save-openai').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
  })
  await flush()
}

async function clickDelete(): Promise<void> {
  act(() => {
    byTestId('settings-ai-provider-credential-delete-openai').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
  })
  await flush()
}

function statusText(): string {
  return byTestId('settings-ai-provider-credential-status-openai').textContent ?? ''
}

/** 画面・console・ブラウザの保存のどこにも Key が無いこと。 */
function expectNoTrace(...secrets: string[]): void {
  const html = container.innerHTML
  const logged = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))
  const stored = JSON.stringify([{ ...localStorage }, { ...sessionStorage }])

  for (const secret of secrets) {
    expect(html).not.toContain(secret)
    expect(input().value).not.toContain(secret)
    expect(logged).not.toContain(secret)
    expect(stored).not.toContain(secret)
  }
}

describe('状態だけが分かる', () => {
  it('未設定・設定済み・使えないを文字で出し、Key を取り寄せない', async () => {
    await render()
    expect(statusText()).toBe('未設定')
    expect(input().type).toBe('password')
    expect(input().value).toBe('')

    state = 'set'
    act(() => root.unmount())
    root = createRoot(container)
    await render()
    expect(statusText()).toBe('設定済み')
    // 設定済みでも欄は空のまま（伏せ字で長さを見せることもしない）。
    expect(input().value).toBe('')
    expect(input().placeholder).not.toMatch(/\*|•|●/)
    expect(byTestId('settings-ai-provider-credential-save-openai').textContent).toBe('置き換える')

    state = 'unusable'
    act(() => root.unmount())
    root = createRoot(container)
    await render()
    expect(statusText()).toContain('利用できません')
    expect(
      byTestId<HTMLButtonElement>('settings-ai-provider-credential-delete-openai').disabled
    ).toBe(false)
    expect(hasCredential).toHaveBeenCalledWith({ providerId: 'openai' })
  })
})

describe('保存・置き換え・削除', () => {
  it('保存すると欄がすぐ空になり、状態だけが「設定済み」になる', async () => {
    await render()

    type(CANARY)
    expect(input().value).toBe(CANARY)

    await clickSave()

    expect(setCredential).toHaveBeenCalledWith({ providerId: 'openai', apiKey: CANARY })
    expect(input().value).toBe('')
    expect(statusText()).toBe('設定済み')
    expect(byTestId('settings-ai-provider-credential-notice-openai').textContent).toBe(
      'API Key を保存しました。'
    )
    expectNoTrace(CANARY)
  })

  it('置き換えは新しい Key を丸ごと送る', async () => {
    state = 'set'
    await render()

    type(REPLACED)
    await clickSave()

    expect(setCredential).toHaveBeenLastCalledWith({ providerId: 'openai', apiKey: REPLACED })
    expect(input().value).toBe('')
    expectNoTrace(REPLACED)
  })

  it('削除すると未設定に戻る', async () => {
    state = 'set'
    await render()

    await clickDelete()

    expect(deleteCredential).toHaveBeenCalledWith({ providerId: 'openai' })
    expect(statusText()).toBe('未設定')
    expect(
      byTestId<HTMLButtonElement>('settings-ai-provider-credential-delete-openai').disabled
    ).toBe(true)
  })

  it('保存に失敗しても欄は空になり、理由だけが出る（Key は残らない）', async () => {
    await render()

    nextFailure = 'encryption-unavailable'
    type(CANARY)
    await clickSave()

    expect(input().value).toBe('')
    expect(byTestId('settings-ai-provider-credential-notice-openai').textContent).toContain(
      'OS の暗号化'
    )
    expect(statusText()).toBe('未設定')

    nextFailure = null
    ipcFails = true
    type(CANARY)
    await clickSave()

    expect(input().value).toBe('')
    expect(byTestId('settings-ai-provider-credential-notice-openai').textContent).toBe(
      'API Key を保存できませんでした。'
    )
    expectNoTrace(CANARY)
  })

  it('形の通らない Key は送らずに欄を空にする', async () => {
    await render()

    type('sk-fn-test with space')
    await clickSave()

    expect(setCredential).not.toHaveBeenCalled()
    expect(input().value).toBe('')
    expect(byTestId('settings-ai-provider-credential-notice-openai').textContent).toContain(
      '形が正しくありません'
    )
  })

  it('この PC で保存できなければ、欄と保存を押せなくして理由を出す', async () => {
    canStore = false
    await render()

    expect(input().disabled).toBe(true)
    expect(
      byTestId<HTMLButtonElement>('settings-ai-provider-credential-save-openai').disabled
    ).toBe(true)
    expect(byTestId('settings-ai-provider-credential-cannot-store-openai').textContent).toContain(
      '暗号化'
    )
  })
})
