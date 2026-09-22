import { describe, expect, it } from 'vitest'
import { sanitizeAuditEvent } from './auditRecord'
import { summarizeAuditRecord } from './auditSummary'
import type { AuditEvent } from './auditEvent'

/**
 * Activity（後の STEP）へ渡せる安全な要約（Security Core v1 の STEP4）。
 *
 * 閉じた集合の語だけを持つこと ── 伏せた後の文字列であっても、名前・パス・Error は
 * 要約に含めない。
 */

const TIME = new Date('2026-09-23T09:41:02.318Z')

function summarize(event: unknown): ReturnType<typeof summarizeAuditRecord> {
  return summarizeAuditRecord(sanitizeAuditEvent(event as AuditEvent, TIME))
}

describe('summarizeAuditRecord', () => {
  it('時刻・分類・種別・判定と、語をつないだ1行を返す', () => {
    expect(
      summarize({
        type: 'file-write.denied',
        decision: 'deny',
        reason: 'secret-file',
        outcome: 'failure'
      })
    ).toEqual({
      time: '2026-09-23T09:41:02.318Z',
      category: 'file-write',
      action: 'file-write.denied',
      decision: 'deny',
      summary: 'file-write.denied / deny / secret-file / failure',
      userNoticeRequired: false
    })
  })

  it('分かっている語だけをつなぐ', () => {
    expect(summarize({ type: 'approval.requested' }).summary).toBe('approval.requested')
  })

  it('名前・パス・Error は要約に入らない', () => {
    const summary = summarize({
      type: 'mcp-tool.failed',
      subject: 'notion.search',
      workspacePath: 'src/main/index.ts',
      error: new Error('connection refused')
    })

    expect(summary.summary).toBe('mcp-tool.failed')
    expect(Object.keys(summary).sort()).toEqual([
      'action',
      'category',
      'decision',
      'summary',
      'time',
      'userNoticeRequired'
    ])
    expect(JSON.stringify(summary)).not.toContain('notion.search')
    expect(JSON.stringify(summary)).not.toContain('index.ts')
    expect(JSON.stringify(summary)).not.toContain('connection refused')
  })

  it('「一部を伏せた」ことは伝える', () => {
    expect(
      summarize({ type: 'secret.masked', userNoticeRequired: true, maskedCount: 3 })
    ).toMatchObject({ category: 'secret', userNoticeRequired: true })
  })

  it('知らない種別の記録も、要約にできる', () => {
    expect(summarize({ type: 'made-up' })).toMatchObject({
      category: 'audit',
      action: 'audit.unrecognized-event',
      summary: 'audit.unrecognized-event / unrecognized-event'
    })
  })
})
