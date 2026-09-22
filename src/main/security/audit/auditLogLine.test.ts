import { describe, expect, it } from 'vitest'
import { AUDIT_RECORD_MAX_BYTES, formatAuditRecordLine } from './auditLogLine'
import { sanitizeAuditEvent } from './auditRecord'
import type { AuditEvent } from './auditEvent'

/**
 * Log の形式（JSON Lines）（Security Core v1 の STEP4）。
 *
 * 1件が1行で閉じること・値で行の区切りを偽装できないこと・1件が上限を超えないこと。
 */

const TIME = new Date('2026-09-23T09:41:02.318Z')

function line(event: unknown): string {
  return formatAuditRecordLine(sanitizeAuditEvent(event as AuditEvent, TIME))
}

describe('1件 = 1行の JSON', () => {
  it('決めた順に並べ、分かっていない欄は書かない', () => {
    expect(line({ type: 'file-write.denied', decision: 'deny', reason: 'secret-file' })).toBe(
      '{"time":"2026-09-23T09:41:02.318Z","event":"file-write.denied","category":"file-write","decision":"deny","reason":"secret-file"}'
    )
  })

  it('JSON として読み直せる', () => {
    const parsed: unknown = JSON.parse(
      line({ type: 'secret.masked', secretCategories: ['jwt'], maskedCount: 2 })
    )

    expect(parsed).toEqual({
      time: '2026-09-23T09:41:02.318Z',
      event: 'secret.masked',
      category: 'secret',
      secretCategories: ['jwt'],
      maskedCount: 2
    })
  })

  it.each([
    ['改行', 'a\nb'],
    ['CRLF', 'a\r\nb'],
    ['行区切り', 'a\u2028b'],
    ['引用符と括弧', 'a"}{"b'],
    ['制御文字', 'a\u0000b']
  ])('%s を含む値でも、行は1つのまま', (_label, value) => {
    const text = line({ type: 'mcp-tool.requested', subject: value })

    expect(text.split('\n')).toHaveLength(1)
    expect(text.split('\r')).toHaveLength(1)
    expect(text).not.toContain('\u2028')
    expect(() => JSON.parse(text) as unknown).not.toThrow()
  })

  it('偽の行を差し込めない', () => {
    const text = line({
      type: 'mcp-tool.requested',
      subject: '{"event":"file-write.approved","decision":"allow"}'
    })
    const parsed = JSON.parse(text) as Record<string, unknown>

    expect(parsed.event).toBe('mcp-tool.requested')
    expect(parsed.decision).toBeUndefined()
  })
})

describe('1件の上限', () => {
  it('Sanitize を通った記録は、上限にまったく届かない', () => {
    const text = line({
      type: 'mcp-tool.failed',
      decision: 'deny',
      reason: 'mcp-not-allowlisted',
      outcome: 'failure',
      actionKind: 'mcp.read',
      permissionMode: 'ask',
      subject: 'x'.repeat(10_000),
      workspacePath: 'y/'.repeat(10_000),
      secretCategories: ['jwt', 'github-token', 'private-key'],
      maskedCount: 7,
      userNoticeRequired: true,
      error: new Error('z'.repeat(10_000))
    })

    expect(Buffer.byteLength(text, 'utf8') + 1).toBeLessThanOrEqual(AUDIT_RECORD_MAX_BYTES)
  })

  it('上限を超える1件は、最小限の記録へ落とす（途中で切らない）', () => {
    const record = sanitizeAuditEvent(
      { type: 'mcp-tool.requested', subject: 'tool-name-'.repeat(10) } as AuditEvent,
      TIME
    )
    const text = formatAuditRecordLine(record, 130)
    const parsed = JSON.parse(text) as Record<string, unknown>

    expect(parsed).toEqual({
      time: '2026-09-23T09:41:02.318Z',
      event: 'audit.unrecognized-event',
      category: 'audit',
      reason: 'record-too-large'
    })
  })

  it('最小限の記録すら入らない上限では、空の object にする', () => {
    const record = sanitizeAuditEvent({ type: 'policy.decided' } as AuditEvent, TIME)

    expect(formatAuditRecordLine(record, 10)).toBe('{}')
  })
})
