import {
  DIAGNOSTICS_REPORT_ERRORS_MAX,
  DIAGNOSTICS_REPORT_SCHEMA_VERSION,
  type DiagnosticsAppState,
  type DiagnosticsErrorRecord,
  type DiagnosticsReport
} from '@shared/diagnostics'
import { sanitizeLogText } from '../logger/logRedaction'

/**
 * 集めた値から診断情報を組み立てる（Electron 非依存・テスト対象）。
 *
 * 値を集めるのは diagnosticsCollector.ts（Electron / os を読む薄い層）で、ここは
 * **形を揃えて伏せるだけ**を受け持つ。OS の製品名や CPU の型番は OS が返す文字列を
 * そのまま載せるので、念のためログと同じ伏せ方を通しておく（パスやユーザー名が入る
 * 経路は無いが、入っていても出さない）。
 */

export interface DiagnosticsSources {
  readonly now: number
  readonly app: {
    readonly name: string
    readonly version: string
    readonly isPackaged: boolean
    readonly locale: string
    readonly uptimeSeconds: number
  }
  readonly versions: {
    readonly electron?: string
    readonly chrome?: string
    readonly node?: string
    readonly v8?: string
  }
  readonly system: {
    readonly platform: string
    readonly osName: string
    readonly osRelease: string
    readonly arch: string
    readonly cpuModel: string
    readonly cpuCount: number
    readonly totalMemoryBytes: number
    readonly freeMemoryBytes: number
  }
  readonly memory: {
    readonly mainProcessBytes: number
    readonly allProcessesBytes: number | null
    readonly processCount: number | null
  }
  readonly state: DiagnosticsAppState
  /** 新しい順。 */
  readonly errors: readonly DiagnosticsErrorRecord[]
}

export function createDiagnosticsReport(sources: DiagnosticsSources): DiagnosticsReport {
  return {
    schemaVersion: DIAGNOSTICS_REPORT_SCHEMA_VERSION,
    generatedAt: sources.now,
    app: {
      name: text(sources.app.name),
      version: text(sources.app.version),
      isPackaged: sources.app.isPackaged,
      locale: text(sources.app.locale),
      uptimeSeconds: count(sources.app.uptimeSeconds)
    },
    runtime: {
      electron: text(sources.versions.electron),
      chrome: text(sources.versions.chrome),
      node: text(sources.versions.node),
      v8: text(sources.versions.v8)
    },
    system: {
      platform: text(sources.system.platform),
      osName: text(sources.system.osName),
      osRelease: text(sources.system.osRelease),
      arch: text(sources.system.arch),
      cpuModel: text(sources.system.cpuModel),
      cpuCount: count(sources.system.cpuCount),
      totalMemoryBytes: count(sources.system.totalMemoryBytes),
      freeMemoryBytes: count(sources.system.freeMemoryBytes)
    },
    memory: {
      mainProcessBytes: count(sources.memory.mainProcessBytes),
      allProcessesBytes:
        sources.memory.allProcessesBytes === null ? null : count(sources.memory.allProcessesBytes),
      processCount: sources.memory.processCount === null ? null : count(sources.memory.processCount)
    },
    state: {
      workspaceOpen: sources.state.workspaceOpen,
      windowCount: count(sources.state.windowCount),
      terminalSessionCount: count(sources.state.terminalSessionCount),
      languageServers: sources.state.languageServers.map((server) => ({
        serverId: text(server.serverId),
        status: text(server.status)
      })),
      debugSession: text(sources.state.debugSession)
    },
    recentErrors: sources.errors.slice(0, DIAGNOSTICS_REPORT_ERRORS_MAX),
    storedErrorCount: sources.errors.length
  }
}

/** 1語の値。空・文字列でないものは空文字。長いものは切る。 */
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return ''
  }

  const sanitized = sanitizeLogText(value.trim())

  return sanitized.length <= 200 ? sanitized : `${sanitized.slice(0, 200)}…`
}

/** 0 以上の整数。読めなければ 0。 */
function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
