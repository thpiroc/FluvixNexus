/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpConnectionId, McpConnectionStatus, McpCustomServerId } from '@shared/mcp'
import type { McpCustomServerList, McpCustomServerSummary } from '@shared/mcp/customServers'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { McpConnectionPanel } from './McpConnectionPanel'

/**
 * MCP の面（McpConnectionPanel.tsx）の「+ New MCP Server」（§21.10）。
 *
 * Main の代わりに、一覧を持つだけの偽の `fluvix.mcp` を置く。確かめたいのは
 * 「どこに何が出るか」と「押したら何が送られるか」で、保存の規則そのものは
 * shared / main のテストが持つ。秘密の値はすべて架空のもの。
 */

const SECRET = 'fictitious-secret-value'
const EXISTING_ID = 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'

const EXISTING: McpCustomServerSummary = {
  id: EXISTING_ID,
  name: 'Existing',
  enabled: false,
  transport: { kind: 'stdio', command: 'uvx', args: ['example-mcp'] },
  env: [{ name: 'EXAMPLE_API_KEY', secret: true, stored: true }]
}

let container: HTMLDivElement
let root: Root
let list: McpCustomServerList
let saveCustomServer: ReturnType<typeof vi.fn>
let deleteCustomServer: ReturnType<typeof vi.fn>
let setCustomServerEnabled: ReturnType<typeof vi.fn>

function statusOf(connectionId: McpConnectionId): McpConnectionStatus {
  const custom = list.servers.find((server) => server.id === connectionId)
  const enabled = custom?.enabled ?? false

  return {
    connectionId,
    configured: enabled,
    problems: enabled ? [] : ['disabled'],
    enabled,
    secret: { source: 'none', canStore: true },
    testing: false,
    lastTest: null
  }
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  list = { servers: [EXISTING], canStoreSecrets: true }

  saveCustomServer = vi.fn(
    async (request: { id: string | null; draft: Record<string, unknown> }) => {
      const summary: McpCustomServerSummary = {
        ...(request.draft as unknown as McpCustomServerSummary),
        id: (request.id ?? 'custom-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d') as McpCustomServerId,
        env: []
      }
      list = { ...list, servers: [...list.servers.filter((s) => s.id !== summary.id), summary] }
      return { ok: true, data: { ok: true, server: summary } }
    }
  )
  deleteCustomServer = vi.fn(async (request: { id: string }) => {
    list = { ...list, servers: list.servers.filter((server) => server.id !== request.id) }
    return { ok: true, data: list }
  })
  setCustomServerEnabled = vi.fn(async (request: { id: string; enabled: boolean }) => {
    list = {
      ...list,
      servers: list.servers.map((server) =>
        server.id === request.id ? { ...server, enabled: request.enabled } : server
      )
    }
    return { ok: true, data: list }
  })
  ;(globalThis as { fluvix?: unknown }).fluvix = {
    mcp: {
      getStatus: vi.fn(async (request: { connectionId: McpConnectionId }) => ({
        ok: true,
        data: statusOf(request.connectionId)
      })),
      testConnection: vi.fn(),
      setSecret: vi.fn(),
      clearSecret: vi.fn(),
      listCustomServers: vi.fn(async () => ({ ok: true, data: list })),
      saveCustomServer,
      deleteCustomServer,
      setCustomServerEnabled
    }
  }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  delete (globalThis as { fluvix?: unknown }).fluvix
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
        createElement(McpConnectionPanel)
      )
    )
  )
  await flush()
}

function byTestId<T extends Element = HTMLElement>(id: string): T | null {
  return container.querySelector<T>(`[data-testid="${id}"]`)
}

function click(element: Element | null): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function type(id: string, text: string): void {
  const element = byTestId<HTMLInputElement | HTMLTextAreaElement>(id)

  if (element === null) {
    throw new Error(`no field: ${id}`)
  }

  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype

  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(): Promise<void> {
  act(() => {
    byTestId('settings-mcp-custom-form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    )
  })
  await flush()
}

describe('+ New MCP Server', () => {
  it('面の先頭に置き、組み込みの接続（Notion）より前に出る', async () => {
    await render()

    const button = byTestId('settings-mcp-new-server')
    const notion = container.querySelector('[data-connection="notion"]')

    expect(button?.textContent).toBe('+ New MCP Server')
    expect(
      button !== null &&
        notion !== null &&
        button.compareDocumentPosition(notion) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('押すと入力欄が開き、Command と引数を分けたまま保存の要求に載せる', async () => {
    await render()
    click(byTestId('settings-mcp-new-server'))

    type('settings-mcp-custom-name', 'GitHub')
    type('settings-mcp-custom-command', 'npx')
    type('settings-mcp-custom-args', '-y\n@modelcontextprotocol/server-github\nC:\\My Files')
    click(byTestId('settings-mcp-custom-env-add'))
    type('settings-mcp-custom-env-name-0', 'GITHUB_PERSONAL_ACCESS_TOKEN')
    type('settings-mcp-custom-env-value-0', SECRET)

    // 秘密の欄は既定で入っていて、値は伏せて見せる。
    expect(byTestId<HTMLInputElement>('settings-mcp-custom-env-secret-0')?.checked).toBe(true)
    expect(byTestId<HTMLInputElement>('settings-mcp-custom-env-value-0')?.type).toBe('password')

    await submit()

    expect(saveCustomServer).toHaveBeenCalledWith({
      id: null,
      draft: {
        name: 'GitHub',
        enabled: false,
        transport: {
          kind: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github', 'C:\\My Files']
        },
        env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', secret: true, value: SECRET }]
      }
    })
    expect(byTestId('settings-mcp-custom-form')).toBeNull()
    expect(byTestId('settings-mcp-custom-notice')?.textContent).toContain('保存しました')
    expect(container.textContent).toContain('GitHub')
  })

  it('通らない入力は要求を送らずに、どの欄が何故かを出す', async () => {
    await render()
    click(byTestId('settings-mcp-new-server'))

    type('settings-mcp-custom-name', 'Broken')
    type('settings-mcp-custom-command', 'npx -y @example/server')
    await submit()

    expect(saveCustomServer).not.toHaveBeenCalled()
    expect(byTestId('settings-mcp-custom-error')?.textContent).toContain('Command')
  })

  it('キャンセルで閉じ、何も送らない', async () => {
    await render()
    click(byTestId('settings-mcp-new-server'))
    click(byTestId('settings-mcp-custom-cancel'))

    expect(byTestId('settings-mcp-custom-form')).toBeNull()
    expect(saveCustomServer).not.toHaveBeenCalled()
  })
})

describe('追加したサーバーのカード', () => {
  it('名前・コマンド・状態を出し、秘密の値は出さない', async () => {
    await render()

    const card = byTestId(`settings-mcp-custom-${EXISTING_ID}`)

    expect(card?.textContent).toContain('Existing')
    expect(byTestId(`settings-mcp-command-${EXISTING_ID}`)?.textContent).toContain(
      'uvx example-mcp'
    )
    expect(byTestId(`settings-mcp-status-${EXISTING_ID}`)?.textContent).toBe('使わない設定です')
    // 無効のうちは接続テストを押せない。
    expect(byTestId<HTMLButtonElement>(`settings-mcp-test-${EXISTING_ID}`)?.disabled).toBe(true)
  })

  it('編集で秘密の欄を空のまま保存すると、「今のまま」（null）を送る', async () => {
    await render()
    click(byTestId(`settings-mcp-custom-edit-${EXISTING_ID}`))

    const value = byTestId<HTMLInputElement>('settings-mcp-custom-env-value-0')
    expect(value?.value).toBe('')
    expect(value?.placeholder).toContain('保存済み')

    await submit()

    expect(saveCustomServer).toHaveBeenCalledWith({
      id: EXISTING_ID,
      draft: expect.objectContaining({
        env: [{ name: 'EXAMPLE_API_KEY', secret: true, value: null }]
      })
    })
  })

  it('有効 / 無効を切り替える', async () => {
    await render()
    click(byTestId(`settings-mcp-custom-toggle-${EXISTING_ID}`))
    await flush()

    expect(setCustomServerEnabled).toHaveBeenCalledWith({ id: EXISTING_ID, enabled: true })
    expect(
      byTestId(`settings-mcp-custom-toggle-${EXISTING_ID}`)?.getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('削除は2段で、確かめた後にだけ送る', async () => {
    await render()
    click(byTestId(`settings-mcp-custom-delete-${EXISTING_ID}`))

    expect(deleteCustomServer).not.toHaveBeenCalled()

    click(byTestId(`settings-mcp-custom-delete-confirm-${EXISTING_ID}`))
    await flush()

    expect(deleteCustomServer).toHaveBeenCalledWith({ id: EXISTING_ID })
    expect(byTestId(`settings-mcp-custom-${EXISTING_ID}`)).toBeNull()
  })
})
