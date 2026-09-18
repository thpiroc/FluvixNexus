/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DiagnosticsReport } from '@shared/diagnostics'
import { emptySettingsSections } from '@shared/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider } from '../i18n/LanguageProvider'
import { DiagnosticsView } from './DiagnosticsView'

/**
 * Settings の「診断情報」（DiagnosticsView.tsx）。
 *
 * 中身を作って伏せるのは Main（main/diagnostics/ のテストが持つ）。ここで見るのは
 * **届いたものを並べ、ボタンが正しい口を呼ぶこと**だけ。
 */

const api = vi.hoisted(() => ({
  load: vi.fn(),
  saveSection: vi.fn(),
  getReport: vi.fn(),
  copyReport: vi.fn(),
  clearErrors: vi.fn()
}))

vi.mock('../api/fluvix', () => ({
  fluvix: {
    settings: { load: api.load, saveSection: api.saveSection },
    diagnostics: {
      getReport: api.getReport,
      copyReport: api.copyReport,
      clearErrors: api.clearErrors
    }
  }
}))

function report(overrides: Partial<DiagnosticsReport> = {}): DiagnosticsReport {
  return {
    schemaVersion: 1,
    generatedAt: Date.UTC(2026, 8, 19),
    app: {
      name: 'Fluvix Nexus',
      version: '1.2.3',
      isPackaged: true,
      locale: 'ja',
      uptimeSeconds: 61
    },
    runtime: { electron: '43.3.0', chrome: '140', node: '24.18.1', v8: '14' },
    system: {
      platform: 'win32',
      osName: 'Windows 11 Home',
      osRelease: '10.0.26200',
      arch: 'x64',
      cpuModel: 'Example CPU',
      cpuCount: 8,
      totalMemoryBytes: 1024 ** 3,
      freeMemoryBytes: 512 * 1024 ** 2
    },
    memory: { mainProcessBytes: 1024, allProcessesBytes: 2048, processCount: 3 },
    state: {
      workspaceOpen: false,
      windowCount: 1,
      terminalSessionCount: 0,
      languageServers: [],
      debugSession: 'idle'
    },
    recentErrors: [
      {
        kind: 'renderer-process-gone',
        severity: 'fatal',
        occurredAt: Date.UTC(2026, 8, 18),
        appVersion: '1.2.3',
        name: 'crashed',
        message: 'The renderer process exited (exit code 1).',
        stack: []
      }
    ],
    storedErrorCount: 1,
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  api.load.mockResolvedValue({ ok: true, data: { sections: emptySettingsSections() } })
  api.saveSection.mockResolvedValue({ ok: true, data: undefined })
  api.getReport.mockResolvedValue({ ok: true, data: report() })
  api.copyReport.mockResolvedValue({ ok: true, data: { characters: 10 } })
  api.clearErrors.mockResolvedValue({ ok: true, data: undefined })
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

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(LanguageProvider, null, createElement(DiagnosticsView)))
  })
}

function byTestId(testId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)

  if (element === null) {
    throw new Error(`missing ${testId}`)
  }

  return element
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    byTestId(testId).click()
  })
}

describe('DiagnosticsView', () => {
  it('Main から届いた診断情報を並べる', async () => {
    await render()

    expect(api.getReport).toHaveBeenCalledTimes(1)
    expect(byTestId('settings-diagnostics-app').textContent).toContain('Fluvix Nexus 1.2.3')
    expect(byTestId('settings-diagnostics-system').textContent).toContain('Windows 11 Home')
    expect(byTestId('settings-diagnostics-system').textContent).toContain('x64')
    expect(byTestId('settings-diagnostics-runtime').textContent).toContain('43.3.0')
    expect(byTestId('settings-diagnostics-errors').textContent).toContain('crashed')
    expect(byTestId('settings-diagnostics-preview').textContent).toContain(
      'Version: Fluvix Nexus 1.2.3 (installed)'
    )
  })

  it('コピーは Main の口を呼ぶだけで、結果を一言出す', async () => {
    await render()
    await click('settings-diagnostics-copy')

    expect(api.copyReport).toHaveBeenCalledTimes(1)
    expect(byTestId('settings-diagnostics-notice').dataset.tone).toBe('ok')

    api.copyReport.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INTERNAL', message: 'x' }
    })
    await click('settings-diagnostics-copy')

    expect(byTestId('settings-diagnostics-notice').dataset.tone).toBe('error')
  })

  it('エラー記録を消すと取り直す', async () => {
    await render()

    api.getReport.mockResolvedValueOnce({
      ok: true,
      data: report({ recentErrors: [], storedErrorCount: 0 })
    })
    await click('settings-diagnostics-clear')

    expect(api.clearErrors).toHaveBeenCalledTimes(1)
    expect(api.getReport).toHaveBeenCalledTimes(2)
    expect(byTestId('settings-diagnostics-no-errors')).not.toBeNull()
    expect((byTestId('settings-diagnostics-clear') as HTMLButtonElement).disabled).toBe(true)
  })

  it('取れなければそう出し、コピーは押せない', async () => {
    api.getReport.mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'x' } })
    await render()

    expect(byTestId('settings-diagnostics-failed')).not.toBeNull()
    expect((byTestId('settings-diagnostics-copy') as HTMLButtonElement).disabled).toBe(true)
  })
})
