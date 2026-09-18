import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTICS_REPORT_ERRORS_MAX,
  formatDiagnosticsBytes,
  formatDiagnosticsDuration,
  formatDiagnosticsReportText,
  type DiagnosticsErrorRecord
} from '@shared/diagnostics'
import { createDiagnosticsReport, type DiagnosticsSources } from './diagnosticsReport'

function sources(overrides: Partial<DiagnosticsSources> = {}): DiagnosticsSources {
  return {
    now: Date.UTC(2026, 8, 19, 12, 0, 0),
    app: {
      name: 'Fluvix Nexus',
      version: '1.0.0',
      isPackaged: true,
      locale: 'ja',
      uptimeSeconds: 3723.9
    },
    versions: { electron: '43.3.0', chrome: '140.0.0.0', node: '24.18.1', v8: '14.0' },
    system: {
      platform: 'win32',
      osName: 'Windows 11 Home',
      osRelease: '10.0.26200',
      arch: 'x64',
      cpuModel: 'Example CPU',
      cpuCount: 16,
      totalMemoryBytes: 32 * 1024 ** 3,
      freeMemoryBytes: 8 * 1024 ** 3
    },
    memory: {
      mainProcessBytes: 150 * 1024 ** 2,
      allProcessesBytes: 600 * 1024 ** 2,
      processCount: 5
    },
    state: {
      workspaceOpen: true,
      windowCount: 1,
      terminalSessionCount: 2,
      languageServers: [
        { serverId: 'typescript', status: 'ready' },
        { serverId: 'python', status: 'unavailable' }
      ],
      debugSession: 'idle'
    },
    errors: [],
    ...overrides
  }
}

function errorRecord(index: number): DiagnosticsErrorRecord {
  return {
    kind: 'renderer-error',
    severity: 'error',
    occurredAt: Date.UTC(2026, 8, 19, 11, 0, index),
    appVersion: '1.0.0',
    name: 'TypeError',
    message: `failure ${index}`,
    stack: ['at f (index.js:1:2)']
  }
}

describe('createDiagnosticsReport', () => {
  it('集めた値を形に揃える（秒・数は整数、空は空文字）', () => {
    const report = createDiagnosticsReport(
      sources({ versions: { electron: '43.3.0', chrome: undefined, node: '24.18.1', v8: '' } })
    )

    expect(report.schemaVersion).toBe(1)
    expect(report.app.uptimeSeconds).toBe(3723)
    expect(report.runtime.chrome).toBe('')
    expect(report.runtime.v8).toBe('')
    expect(report.state.languageServers).toHaveLength(2)
  })

  it('OS が返す文字列にパスが入っていても伏せる', () => {
    const report = createDiagnosticsReport(
      sources({
        system: {
          ...sources().system,
          cpuModel: 'CPU C:\\Users\\taro\\cpu',
          osName: 'OS /home/taro/x'
        }
      })
    )

    expect(JSON.stringify(report)).not.toContain('taro')
  })

  it('エラーは上限まで載せ、保存されている総数は別に持つ', () => {
    const errors = Array.from({ length: DIAGNOSTICS_REPORT_ERRORS_MAX + 5 }, (_, index) =>
      errorRecord(index)
    )
    const report = createDiagnosticsReport(sources({ errors }))

    expect(report.recentErrors).toHaveLength(DIAGNOSTICS_REPORT_ERRORS_MAX)
    expect(report.storedErrorCount).toBe(DIAGNOSTICS_REPORT_ERRORS_MAX + 5)
    expect(report.recentErrors[0].message).toBe('failure 0')
  })

  it('読めない数は 0 にする', () => {
    const report = createDiagnosticsReport(
      sources({
        memory: { mainProcessBytes: Number.NaN, allProcessesBytes: null, processCount: null }
      })
    )

    expect(report.memory.mainProcessBytes).toBe(0)
    expect(report.memory.allProcessesBytes).toBeNull()
  })
})

describe('formatDiagnosticsReportText', () => {
  it('要求された項目がすべて入った英語の固定書式になる', () => {
    const text = formatDiagnosticsReportText(
      createDiagnosticsReport(sources({ errors: [errorRecord(1)] }))
    )

    for (const expected of [
      'Version: Fluvix Nexus 1.0.0 (installed)',
      'OS: Windows 11 Home',
      'OS version: win32 10.0.26200',
      'Architecture: x64',
      'CPU: Example CPU (16 logical)',
      'Memory: 32.0 GiB total, 8.0 GiB free',
      'Electron: 43.3.0',
      'Node.js: 24.18.1',
      'Workspace open: yes',
      'Terminal sessions: 2',
      'Language servers: typescript=ready, python=unavailable',
      'Debug session: idle',
      '1. [error] renderer-error at 2026-09-19T11:00:01.000Z (v1.0.0)',
      '   TypeError: failure 1',
      '     at f (index.js:1:2)'
    ]) {
      expect(text).toContain(expected)
    }
  })

  it('エラーが無ければ None', () => {
    const text = formatDiagnosticsReportText(createDiagnosticsReport(sources()))

    expect(text).toContain('## Recent errors (0 shown, 0 stored)\nNone')
  })
})

describe('formatDiagnosticsBytes / formatDiagnosticsDuration', () => {
  it('人が読める1語にする', () => {
    expect(formatDiagnosticsBytes(512)).toBe('512 B')
    expect(formatDiagnosticsBytes(1536)).toBe('1.5 KiB')
    expect(formatDiagnosticsBytes(-1)).toBe('unknown')
    expect(formatDiagnosticsDuration(59)).toBe('0m 59s')
    expect(formatDiagnosticsDuration(3723)).toBe('1h 02m 03s')
    expect(formatDiagnosticsDuration(Number.NaN)).toBe('unknown')
  })
})
