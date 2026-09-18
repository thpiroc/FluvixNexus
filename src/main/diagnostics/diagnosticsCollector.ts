import { app, BrowserWindow } from 'electron'
import { cpus, freemem, release, totalmem, version } from 'os'
import type { DiagnosticsAppState, DiagnosticsErrorRecord } from '@shared/diagnostics'
import { getDebugSessionState } from '../debug/debugSessionManager'
import { getLanguageServerStatuses } from '../lsp/serverStatus'
import { countTerminalSessions } from '../terminal/terminalSessions'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import type { DiagnosticsSources } from './diagnosticsReport'

/**
 * 診断情報の元になる値を集める（Electron / os を読む薄い層）。
 *
 * **どれも読むだけ。** 1つが取れなくても全体を失敗にしない ── 取れなかった欄は空や
 * null になり、診断情報はその欄を `unknown` と出す。診断情報が欲しいのは何かが
 * おかしいときなので、ここが投げると一番要るときに何も出ない。
 *
 * 載せないと決めたもの（Workspace の場所・ホスト名・ユーザー名・環境変数・設定の値）は、
 * **そもそも読まない。** 読んでから伏せるのではなく、読まないことで漏れる経路を作らない。
 */
export function collectDiagnosticsSources(
  errors: readonly DiagnosticsErrorRecord[]
): DiagnosticsSources {
  return {
    now: Date.now(),
    app: {
      name: attempt(() => app.getName(), ''),
      version: attempt(() => app.getVersion(), ''),
      isPackaged: app.isPackaged,
      locale: attempt(() => app.getLocale(), ''),
      uptimeSeconds: attempt(() => process.uptime(), 0)
    },
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8
    },
    system: {
      platform: process.platform,
      osName: attempt(() => version(), ''),
      osRelease: attempt(() => release(), ''),
      arch: process.arch,
      cpuModel: attempt(() => cpus()[0]?.model ?? '', ''),
      cpuCount: attempt(() => cpus().length, 0),
      totalMemoryBytes: attempt(() => totalmem(), 0),
      freeMemoryBytes: attempt(() => freemem(), 0)
    },
    memory: collectMemory(),
    state: collectState(),
    errors
  }
}

function collectMemory(): DiagnosticsSources['memory'] {
  const mainProcessBytes = attempt(() => process.memoryUsage().rss, 0)

  try {
    // workingSetSize は KB 単位。
    const metrics = app.getAppMetrics()
    const allProcessesBytes = metrics.reduce(
      (total, metric) => total + metric.memory.workingSetSize * 1024,
      0
    )

    return { mainProcessBytes, allProcessesBytes, processCount: metrics.length }
  } catch {
    return { mainProcessBytes, allProcessesBytes: null, processCount: null }
  }
}

function collectState(): DiagnosticsAppState {
  return {
    // 場所は読まない。開いているかどうかだけ。
    workspaceOpen: attempt(() => getCurrentWorkspaceFolder() !== null, false),
    windowCount: attempt(() => BrowserWindow.getAllWindows().length, 0),
    terminalSessionCount: attempt(() => countTerminalSessions(), 0),
    languageServers: attempt(
      () =>
        getLanguageServerStatuses().map((server) => ({
          serverId: server.serverId,
          status: server.status
        })),
      []
    ),
    debugSession: attempt(() => getDebugSessionState(), 'unknown')
  }
}

function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}
