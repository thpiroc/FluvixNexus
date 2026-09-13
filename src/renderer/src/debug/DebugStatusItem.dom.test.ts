/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySettingsSections } from '@shared/settings'
import { useI18n } from '../i18n/context'
import { LanguageProvider } from '../i18n/LanguageProvider'
import { DebugStatusItem } from './DebugStatusItem'

/**
 * ステータスバーに出る Debug の状態（Session 6-9）。
 *
 * LanguageServerStatusItem.dom.test.ts と同じ4点に、Debug 固有の2点を足した。
 *
 *   - 最初の1回を読む／後から届いた通知が勝つ／読めなくても画面は出る／言語の切り替えに追従する
 *   - **閉じた集合の外の語を描かない**（Main から届いた文字列を画面へ出す経路を作らない）
 *   - **押せない**（状態を出す場所で、操作の入口ではない）
 */

const debugApi = vi.hoisted(() => ({
  getStatus: vi.fn(),
  onStatusChanged: vi.fn()
}))

const settingsStore = vi.hoisted(() => ({
  load: vi.fn(),
  saveSection: vi.fn()
}))

vi.mock('../api/fluvix', () => ({
  fluvix: {
    debug: debugApi,
    settings: settingsStore
  }
}))

let listeners: ((event: { status: unknown }) => void)[] = []

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  listeners = []

  debugApi.onStatusChanged.mockImplementation((listener: (event: { status: unknown }) => void) => {
    listeners.push(listener)

    return () => {
      listeners = listeners.filter((entry) => entry !== listener)
    }
  })

  debugApi.getStatus.mockResolvedValue({ ok: true, data: { status: 'unavailable' } })
  settingsStore.load.mockResolvedValue({ ok: true, data: { sections: emptySettingsSections() } })
  settingsStore.saveSection.mockResolvedValue({ ok: true, data: undefined })

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.documentElement.removeAttribute('data-fx-language')
  document.documentElement.removeAttribute('lang')
  vi.clearAllMocks()
})

async function render(children?: ReactElement): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LanguageProvider,
        null,
        createElement('div', null, createElement(DebugStatusItem), children)
      )
    )
  })
}

function item(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-testid="statusbar-debug"]')

  expect(element).not.toBeNull()

  return element as HTMLElement
}

async function publish(status: unknown): Promise<void> {
  await act(async () => {
    for (const listener of [...listeners]) {
      listener({ status })
    }
  })
}

describe('DebugStatusItem', () => {
  it('画面を開いた時点の状態を1度読む', async () => {
    await render()

    expect(debugApi.getStatus).toHaveBeenCalledTimes(1)
    expect(item().dataset.debugStatus).toBe('unavailable')
    expect(item().textContent).toBe('デバッグ: 利用不可')
    expect(item().getAttribute('title')).toBe('Debug adapter を利用できません。')
  })

  it('通知が届くと、その場で置き換わる（stopped は「一時停止中」と読む）', async () => {
    await render()

    const expected = [
      ['starting', 'デバッグ: 起動中…'],
      ['running', 'デバッグ: 実行中'],
      ['stopped', 'デバッグ: 一時停止中'],
      ['terminating', 'デバッグ: 終了中…'],
      ['idle', 'デバッグ: 待機中']
    ] as const

    for (const [status, text] of expected) {
      await publish(status)
      expect(item().dataset.debugStatus).toBe(status)
      expect(item().textContent).toBe(text)
    }
  })

  it('読み込みの応答より、先に届いた通知が勝つ', async () => {
    let resolveStatus: ((value: unknown) => void) | null = null

    debugApi.getStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve
      })
    )

    await render()

    await publish('running')
    expect(item().dataset.debugStatus).toBe('running')

    await act(async () => {
      resolveStatus?.({ ok: true, data: { status: 'unavailable' } })
    })

    expect(item().dataset.debugStatus).toBe('running')
  })

  it('読めなくても画面は出る（状態が無いだけで、既定の語を作らない）', async () => {
    debugApi.getStatus.mockResolvedValue({ ok: false, error: { code: 'UNKNOWN', message: 'x' } })

    await render()

    expect(item().dataset.debugStatus).toBeUndefined()
    expect(item().textContent).toBe('')
    expect(item().getAttribute('title')).toBeNull()
  })

  /** 閉じた集合の外の語・パスのような文字列は、翻訳キーへ差し込まずに捨てる。 */
  it('知らない語が届いても描かない', async () => {
    await render()

    for (const bogus of ['failed', 'C:\\adapter\\netcoredbg.exe', 42, null, { state: 'running' }]) {
      await publish(bogus)
      expect(item().dataset.debugStatus).toBe('unavailable')
      expect(item().textContent).toBe('デバッグ: 利用不可')
    }

    debugApi.getStatus.mockResolvedValue({ ok: true, data: { status: 'launch' } })
    act(() => root.unmount())
    root = createRoot(container)
    await render()

    expect(item().dataset.debugStatus).toBeUndefined()
    expect(item().textContent).toBe('')
  })

  it('押せない（ボタンでも、操作の入口でもない）', async () => {
    await render()

    expect(item().tagName).toBe('SPAN')
    expect(item().getAttribute('role')).toBeNull()
    expect(item().getAttribute('tabindex')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })

  it('表示言語を切り替えると、その場で言い回しが変わる', async () => {
    debugApi.getStatus.mockResolvedValue({ ok: true, data: { status: 'stopped' } })

    await render(createElement(LanguageSwitch))

    expect(item().textContent).toBe('デバッグ: 一時停止中')

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="switch-en"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(item().textContent).toBe('Debug: Paused')
    expect(item().getAttribute('title')).toBe('The program is paused.')
  })

  it('外すと購読も外れる', async () => {
    await render()

    expect(listeners).toHaveLength(1)

    act(() => root.unmount())
    root = createRoot(container)

    expect(listeners).toHaveLength(0)
  })
})

/** 表示言語を切り替えるだけの部品（実物の Settings 画面と同じ setter を通る）。 */
function LanguageSwitch(): ReactElement {
  const { setLanguage } = useI18n()

  return createElement(
    'button',
    {
      type: 'button',
      'data-testid': 'switch-en',
      onClick: () => setLanguage('en')
    },
    'en'
  )
}
