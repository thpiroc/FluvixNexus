/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageServerStatus } from '@shared/lsp'
import { emptySettingsSections } from '@shared/settings'
import { useI18n } from '../i18n/context'
import { LanguageProvider } from '../i18n/LanguageProvider'
import { SettingsScopeProvider } from '../settings/SettingsScopeProvider'
import { LanguageServerStatusItem } from './LanguageServerStatusItem'

/**
 * ステータスバーに出る Language Server の状態（Session 5-4）。
 *
 * 確かめたいのは4つ。
 *
 *   - **最初の1回を読む**（`lsp:status-changed` は変わったときにしか流れない）
 *   - **後から届いた通知が勝つ**（読んでいる間に変わっていることがある）
 *   - まとめた1語が出て、内訳は `title` で読める
 *   - **言語を切り替えると、その場で言葉が変わる**（runtime language switching）
 *
 * まとめ方そのもの（1本でも答えていれば Ready）は shared/lsp/serverStatus.ts の
 * 試験が持つ ── ここで見るのは、それが画面に出るところまでの繋がりになる。
 */

const lspApi = vi.hoisted(() => ({
  getStatus: vi.fn(),
  onStatusChanged: vi.fn()
}))

const settingsStore = vi.hoisted(() => ({
  load: vi.fn(),
  saveSection: vi.fn(),
  onWorkspaceChanged: vi.fn(() => () => {})
}))

vi.mock('../api/fluvix', () => ({
  fluvix: {
    lsp: lspApi,
    settings: settingsStore
  }
}))

/** 届いた購読者（通知を後から流すために持つ）。 */
let listeners: ((event: { servers: readonly LanguageServerStatus[] }) => void)[] = []

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  listeners = []

  lspApi.onStatusChanged.mockImplementation(
    (listener: (event: { servers: readonly LanguageServerStatus[] }) => void) => {
      listeners.push(listener)

      return () => {
        listeners = listeners.filter((entry) => entry !== listener)
      }
    }
  )

  lspApi.getStatus.mockResolvedValue({ ok: true, data: { servers: [] } })
  settingsStore.load.mockResolvedValue({
    ok: true,
    data: { user: emptySettingsSections(), workspace: null }
  })
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

function statuses(
  entries: readonly [LanguageServerStatus['serverId'], LanguageServerStatus['status']][]
): readonly LanguageServerStatus[] {
  return entries.map(([serverId, status]) => ({ serverId, status }))
}

async function render(children?: ReactElement): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        SettingsScopeProvider,
        null,
        createElement(
          LanguageProvider,
          null,
          createElement('div', null, createElement(LanguageServerStatusItem), children)
        )
      )
    )
  })
}

function item(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-testid="statusbar-lsp"]')

  expect(element).not.toBeNull()

  return element as HTMLElement
}

async function publish(servers: readonly LanguageServerStatus[]): Promise<void> {
  await act(async () => {
    for (const listener of [...listeners]) {
      listener({ servers })
    }
  })
}

describe('LanguageServerStatusItem', () => {
  it('画面を開いた時点の状態を1度読む', async () => {
    lspApi.getStatus.mockResolvedValue({
      ok: true,
      data: {
        servers: statuses([
          ['typescript', 'ready'],
          ['python', 'unavailable'],
          ['csharp', 'stopped']
        ])
      }
    })

    await render()

    expect(lspApi.getStatus).toHaveBeenCalledTimes(1)
    expect(item().dataset.lspStatus).toBe('ready')
    expect(item().textContent).toBe('LSP: 利用可能')
  })

  it('内訳は title で読める（見えてはいないが、確かめられる）', async () => {
    lspApi.getStatus.mockResolvedValue({
      ok: true,
      data: {
        servers: statuses([
          ['typescript', 'ready'],
          ['python', 'unavailable'],
          ['csharp', 'disabled']
        ])
      }
    })

    await render()

    expect(item().getAttribute('title')).toBe(
      ['TypeScript / JavaScript: 利用可能', 'Python: 未インストール', 'C#: 使わない'].join('\n')
    )
  })

  it('通知が届くと、その場で置き換わる', async () => {
    await render()

    expect(item().dataset.lspStatus).toBe('stopped')

    await publish(statuses([['typescript', 'starting']]))
    expect(item().dataset.lspStatus).toBe('starting')

    await publish(statuses([['typescript', 'ready']]))
    expect(item().dataset.lspStatus).toBe('ready')

    /*
      設定で切った場合（Session 5-4）。Main が `disabled` を配るので、
      画面の側に「切ってあるかどうか」を持たずに出せる。
    */
    await publish(
      statuses([
        ['typescript', 'disabled'],
        ['python', 'disabled'],
        ['csharp', 'disabled']
      ])
    )
    expect(item().dataset.lspStatus).toBe('disabled')
    expect(item().textContent).toBe('LSP: 使わない')
  })

  /*
    読んでいる間に状態が変わることがある（サーバは Renderer を待たない）。
    **後から届いた最初の1回で、新しい状態を上書きしない。**
  */
  it('読み込みの応答より、先に届いた通知が勝つ', async () => {
    let resolveStatus: ((value: unknown) => void) | null = null

    lspApi.getStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve
      })
    )

    await render()

    await publish(statuses([['typescript', 'ready']]))
    expect(item().dataset.lspStatus).toBe('ready')

    await act(async () => {
      resolveStatus?.({ ok: true, data: { servers: statuses([['typescript', 'stopped']]) } })
    })

    expect(item().dataset.lspStatus).toBe('ready')
  })

  it('読めなくても画面は出る（状態が無いだけ）', async () => {
    lspApi.getStatus.mockResolvedValue({ ok: false, error: { code: 'UNKNOWN', message: 'x' } })

    await render()

    expect(item().dataset.lspStatus).toBe('stopped')
    expect(item().getAttribute('title')).toBeNull()
  })

  /*
    runtime language switching。**言葉は Language の切り替えでその場で変わる**
    ── 状態そのものは Main から届いた語のままで、翻訳し直すだけになる。
  */
  it('表示言語を切り替えると、その場で言い回しが変わる', async () => {
    lspApi.getStatus.mockResolvedValue({
      ok: true,
      data: { servers: statuses([['typescript', 'ready']]) }
    })

    await render(createElement(LanguageSwitch))

    expect(item().textContent).toBe('LSP: 利用可能')

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="switch-en"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(item().textContent).toBe('LSP: Ready')
    expect(item().getAttribute('title')).toBe('TypeScript / JavaScript: Ready')
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
