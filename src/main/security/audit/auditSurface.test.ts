import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import * as eventModule from './auditEvent'
import * as lineModule from './auditLogLine'
import * as recordModule from './auditRecord'
import * as summaryModule from './auditSummary'
import * as writerModule from './auditLogWriter'

/**
 * Audit Log を Renderer / Agent から直接書けないこと（Security Core v1 の STEP4）。
 *
 * securityPolicySurface（STEP1）・boundarySurface（STEP2）・secretSurface（STEP3）と同じく、
 * 公開する名前を**一覧で固定**する。名前を足すときはこのテストも書き換えることになり、
 * 「それは Audit を外から書ける口ではないか」を見直す機会が必ず生まれる。
 */

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    getPath: () => ''
  }
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const auditApi = await import('./index')
const currentModule = await import('./currentAuditLog')

/** Audit を外から書ける・記録を緩める口に見える名前。 */
const FORBIDDEN_NAME =
  /disable|bypass|override|skip|unsafe|allowAll|trust|force|assume|unchecked|insecure|grant|unlock|unmask|unredact|reveal|plainText|rawSecret|secretValue|setPath|customPath|logPath|rawRecord/i

const AUDIT_DIRECTORY = join(__dirname)

function sourceFiles(): readonly string[] {
  return readdirSync(AUDIT_DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
}

describe('公開する名前', () => {
  it('Audit API の入口', () => {
    expect(Object.keys(auditApi).sort()).toEqual([
      'AUDIT_EVENT_TYPES',
      'AUDIT_LOG_FILE_NAME',
      'AUDIT_LOG_MAX_BYTES',
      'AUDIT_REASONS',
      'recordAuditEvent',
      'summarizeAuditRecord',
      'whenAuditLogIdle'
    ])
  })

  it('内部の module も、決めた名前しか公開しない', () => {
    expect(Object.keys(eventModule).sort()).toEqual([
      'AUDIT_EVENT_TYPES',
      'AUDIT_INTERNAL_CATEGORY',
      'AUDIT_REASONS',
      'AUDIT_UNRECOGNIZED_EVENT',
      'auditEventCategory',
      'isAuditActionKind',
      'isAuditDecision',
      'isAuditOutcome',
      'isAuditPermissionMode',
      'isAuditReason'
    ])
    expect(Object.keys(recordModule).sort()).toEqual([
      'AUDIT_ERROR_MAX_LENGTH',
      'AUDIT_PATH_MAX_LENGTH',
      'AUDIT_SUBJECT_MAX_LENGTH',
      'minimalAuditRecord',
      'sanitizeAuditEvent',
      'sanitizeAuditText'
    ])
    expect(Object.keys(lineModule).sort()).toEqual([
      'AUDIT_RECORD_MAX_BYTES',
      'formatAuditRecordLine'
    ])
    expect(Object.keys(writerModule).sort()).toEqual([
      'AUDIT_LOG_FILE_NAME',
      'AUDIT_LOG_MAX_BYTES',
      'AUDIT_ROTATED_LOG_FILE_NAME',
      'createAuditLogWriter',
      'nodeAuditFileSystem'
    ])
    expect(Object.keys(summaryModule).sort()).toEqual(['summarizeAuditRecord'])
    expect(Object.keys(currentModule).sort()).toEqual(['recordAuditEvent', 'whenAuditLogIdle'])
  })

  it('audit フォルダのどのファイルも、外から書ける名前を export していない', () => {
    expect(sourceFiles()).toEqual([
      'auditEvent.ts',
      'auditLogLine.ts',
      'auditLogWriter.ts',
      'auditRecord.ts',
      'auditSummary.ts',
      'currentAuditLog.ts',
      'index.ts'
    ])

    for (const name of sourceFiles()) {
      const exported = readFileSync(join(AUDIT_DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(exported.filter((line) => FORBIDDEN_NAME.test(line))).toEqual([])
    }
  })

  it('公開している定数は凍結されている', () => {
    expect(Object.isFrozen(auditApi.AUDIT_EVENT_TYPES)).toBe(true)
    expect(Object.isFrozen(auditApi.AUDIT_REASONS)).toBe(true)
  })
})

describe('置き場所を指定できない', () => {
  it('記録する入口は event 1つしか受け取らない', () => {
    expect(auditApi.recordAuditEvent.length).toBe(1)
    expect(auditApi.recordAuditEvent({ type: 'policy.decided' })).toBeUndefined()
  })

  it('置き場所を渡せる Writer は、入口から公開されていない', () => {
    expect(Object.keys(auditApi)).not.toContain('createAuditLogWriter')
    expect(Object.keys(auditApi)).not.toContain('nodeAuditFileSystem')
  })

  it('正式な置き場所は userData の logs で、そこでだけ決まる', () => {
    const source = readFileSync(join(AUDIT_DIRECTORY, 'currentAuditLog.ts'), 'utf8')

    expect(source).toContain("app.getPath('userData')")
    expect(source).toContain('LOG_DIRECTORY_NAME')
    expect(writerModule.AUDIT_LOG_FILE_NAME).toBe('agent-audit.log')
    expect(writerModule.AUDIT_ROTATED_LOG_FILE_NAME).toBe('agent-audit.log.1')
    expect(writerModule.AUDIT_LOG_MAX_BYTES).toBe(1024 * 1024)
  })
})

describe('種別は閉じた集合', () => {
  it('記録を頼むときに使える種別は、一覧にあるものだけ', () => {
    expect([...auditApi.AUDIT_EVENT_TYPES]).toEqual([
      'approval.approved',
      'approval.denied',
      'approval.requested',
      'boundary.denied',
      'external-send.allowed',
      'external-send.denied',
      'file-write.approved',
      'file-write.denied',
      'file-write.failed',
      'file-write.requested',
      'file-write.succeeded',
      'mcp-tool.allowed',
      'mcp-tool.denied',
      'mcp-tool.failed',
      'mcp-tool.requested',
      'policy.decided',
      'secret.masked',
      'security-settings.changed',
      'terminal.approved',
      'terminal.denied',
      'terminal.failed',
      'terminal.requested'
    ])
  })

  it('Audit 自身の種別は、一覧に無い（呼び出し側からは名乗れない）', () => {
    expect(auditApi.AUDIT_EVENT_TYPES).not.toContain('audit.unrecognized-event')
    expect(eventModule.auditEventCategory('audit.unrecognized-event')).toBeNull()
  })

  it('理由も閉じた集合で、STEP1 / STEP2 の語を含む', () => {
    expect(auditApi.AUDIT_REASONS).toContain('secret-file')
    expect(auditApi.AUDIT_REASONS).toContain('outside-workspace')
    expect(auditApi.AUDIT_REASONS).toContain('dangling-link')
    // STEP5（External Send Gate）が足した語。
    expect(auditApi.AUDIT_REASONS).toContain('context-sanitized')
    expect(auditApi.AUDIT_REASONS).toContain('unknown-context-kind')
    expect(auditApi.AUDIT_REASONS).toContain('gate-failed')
    // STEP7（File Write Gate）が足した語。
    expect(auditApi.AUDIT_REASONS).toContain('aliased-target')
    expect(auditApi.AUDIT_REASONS).toContain('existing-file-changed')
    expect(auditApi.AUDIT_REASONS).toContain('handle-unconfirmed')
    expect(auditApi.AUDIT_REASONS).toContain('verify-failed')
    expect(eventModule.isAuditReason('because-i-said-so')).toBe(false)
    expect(eventModule.isAuditReason('toString')).toBe(false)
  })
})

describe('Renderer から届く経路', () => {
  /*
    STEP4 では Renderer から Audit へ直接届く IPC は無い。Activity を作る STEP で
    「安全な要約を Main から Renderer へ送る」経路を足すことになるが、そのときも
    Renderer が Audit Event を**書く**口は作らない。
  */
  it('Audit / Log を名乗る IPC チャンネルは無い', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    expect(channels.filter((channel) => /audit|log/i.test(channel))).toEqual([])
  })

  it('Preload は Audit を公開していない', () => {
    const preload = join(__dirname, '..', '..', '..', 'preload')
    const files = readdirSync(preload, { recursive: true, encoding: 'utf8' }).filter((name) =>
      name.endsWith('.ts')
    )

    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      expect(readFileSync(join(preload, name), 'utf8')).not.toMatch(/audit/i)
    }
  })

  it('Main の IPC handler も Audit を受け取らない', () => {
    const handlers = join(__dirname, '..', '..', 'ipc')
    const files = readdirSync(handlers, { recursive: true, encoding: 'utf8' }).filter((name) =>
      name.endsWith('.ts')
    )

    for (const name of files) {
      expect(readFileSync(join(handlers, name), 'utf8')).not.toMatch(/recordAuditEvent|audit/i)
    }
  })
})
