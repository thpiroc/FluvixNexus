import { describe, expect, it } from 'vitest'
import {
  AUDIT_ERROR_MAX_LENGTH,
  AUDIT_PATH_MAX_LENGTH,
  AUDIT_SUBJECT_MAX_LENGTH,
  sanitizeAuditEvent,
  type AuditRecord
} from './auditRecord'
import type { AuditEvent } from './auditEvent'

/**
 * Audit 専用の最終 Sanitize 境界（Security Core v1 の STEP4）。
 *
 * 呼び出し側が「安全だ」と主張して渡しても、ここで Secret が落ちること・閉じた集合から
 * 外れた値が記録されないこと・1件が行の形を壊せないことを確かめる。
 */

const TIME = new Date('2026-09-23T09:41:02.318Z')

/** 記録から文字列の欄だけを集める（元の値が残っていないことを見るため）。 */
function texts(record: AuditRecord): string {
  return JSON.stringify(record)
}

function sanitize(event: unknown): AuditRecord {
  return sanitizeAuditEvent(event as AuditEvent, TIME)
}

describe('閉じた集合の欄', () => {
  it('知っている値はそのまま記録する', () => {
    const record = sanitize({
      type: 'file-write.denied',
      decision: 'deny',
      reason: 'secret-file',
      outcome: 'failure',
      actionKind: 'file.write',
      permissionMode: 'ask',
      userNoticeRequired: true
    })

    expect(record).toMatchObject({
      time: '2026-09-23T09:41:02.318Z',
      event: 'file-write.denied',
      category: 'file-write',
      decision: 'deny',
      reason: 'secret-file',
      outcome: 'failure',
      actionKind: 'file.write',
      permissionMode: 'ask',
      userNoticeRequired: true
    })
  })

  it.each([
    ['decision', 'allowed'],
    ['reason', 'because-i-said-so'],
    ['outcome', 'ok'],
    ['actionKind', 'file.delete'],
    ['permissionMode', 'auto']
  ])('一覧に無い %s は記録しない', (field, value) => {
    const record = sanitize({ type: 'policy.decided', [field]: value })

    expect(record[field as keyof AuditRecord]).toBeNull()
    expect(texts(record)).not.toContain(value)
  })

  it('STEP2 の拒否理由もそのまま記録できる', () => {
    expect(sanitize({ type: 'boundary.denied', reason: 'outside-workspace' }).reason).toBe(
      'outside-workspace'
    )
    expect(sanitize({ type: 'boundary.denied', reason: 'dangling-link' }).reason).toBe(
      'dangling-link'
    )
  })
})

describe('Event type の偽装', () => {
  it.each([
    ['知らない種別', 'file-write.allowed-by-agent'],
    ['空文字', ''],
    ['prototype の名前', 'toString'],
    ['文字列でない', 42]
  ])('%s は、その種別としては記録しない', (_label, type) => {
    const record = sanitize({ type, decision: 'allow', reason: 'read-allowed' })

    expect(record.event).toBe('audit.unrecognized-event')
    expect(record.category).toBe('audit')
    expect(record.reason).toBe('unrecognized-event')
  })

  it('偽装された種別の他の欄も、いっしょに捨てる', () => {
    const record = sanitize({
      type: 'file-write.allowed-by-agent',
      decision: 'allow',
      outcome: 'success',
      subject: 'trusted-tool',
      workspacePath: 'src/index.ts'
    })

    expect(record.decision).toBeNull()
    expect(record.outcome).toBeNull()
    expect(record.subject).toBeNull()
    expect(record.workspacePath).toBeNull()
  })

  it('Audit 自身の種別は、呼び出し側からは名乗れない', () => {
    const record = sanitize({ type: 'audit.unrecognized-event', reason: 'read-allowed' })

    // 記録としては同じ形に落ちるが、理由は「知らない種別が来た」になる。
    expect(record.event).toBe('audit.unrecognized-event')
    expect(record.reason).toBe('unrecognized-event')
  })
})

describe('Secret', () => {
  const SECRETS: readonly (readonly [string, string])[] = [
    ['Provider の API Key', 'sk-ant-api03-ABCdefGHIjklMNOpqrSTUvwx1234567890'],
    ['GitHub の token', `ghp_${'A1b2C3d4E5f6G7h8'.repeat(2)}`],
    ['password', 'password=Sup3rS3cretValue'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r']
  ]

  it.each(SECRETS)('%s は subject に残らない', (_label, secret) => {
    const record = sanitize({ type: 'mcp-tool.requested', subject: `tool ${secret}` })

    expect(texts(record)).not.toContain(secret)
    // STEP3 の伏せ字（***REDACTED***）か、既存のログの伏せ字（<redacted>）のどちらかになる。
    expect(record.subject).toMatch(/\*\*\*REDACTED\*\*\*|<redacted>/)
  })

  it.each(SECRETS)('%s は workspacePath に残らない', (_label, secret) => {
    const record = sanitize({ type: 'file-write.requested', workspacePath: `src/${secret}.ts` })

    expect(texts(record)).not.toContain(secret)
  })

  it('Private Key は block 全体が消える（改行を含む Secret）', () => {
    const key = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA1234567890abcdefghij',
      'KLMNOPQRSTUVWXYZ0987654321zyxwvutsrq',
      '-----END RSA PRIVATE KEY-----'
    ].join('\n')
    const record = sanitize({ type: 'secret.masked', subject: key })

    expect(texts(record)).not.toContain('MIIEowIBAAKCAQEA')
    expect(texts(record)).not.toContain('KLMNOPQRSTUVWXYZ')
  })

  it('Error の message に入った Secret も残らない', () => {
    const record = sanitize({
      type: 'external-send.denied',
      error: new Error('request failed: Authorization: Bearer sk-ant-api03-ABCdefGHIjkl12345678')
    })

    expect(texts(record)).not.toContain('sk-ant-api03')
    expect(record.error).toContain('Error')
  })

  it('Error の stack は記録しない', () => {
    const error = new Error('boom')
    error.stack = 'Error: boom\n    at C:\\Users\\taro\\app\\out\\main\\index.js:1:1'

    const record = sanitize({ type: 'file-write.failed', error })

    expect(texts(record)).not.toContain('at C:')
    expect(texts(record)).not.toContain('index.js')
  })

  it('Error でないものは中身を辿らない', () => {
    const record = sanitize({
      type: 'file-write.failed',
      error: { message: 'token=A1b2C3d4E5f6G7h8', nested: { key: 'value' } }
    })

    expect(record.error).toBe('[object]')
  })

  it('知らない欄に紛れ込ませた Secret は、そもそも記録されない', () => {
    const record = sanitize({
      type: 'mcp-tool.requested',
      prompt: 'sk-ant-api03-ABCdefGHIjklMNOpqrSTUvwx1234567890',
      rawInput: { token: 'ghp_A1b2C3d4E5f6G7h8A1b2' },
      stdout: 'password=Sup3rS3cretValue',
      metadata: { apiKey: 'AKIAIOSFODNN7EXAMPLE' }
    })

    const text = texts(record)

    expect(text).not.toContain('sk-ant-api03')
    expect(text).not.toContain('ghp_')
    expect(text).not.toContain('Sup3rS3cretValue')
    expect(text).not.toContain('AKIA')
    expect(Object.keys(record).sort()).toEqual([
      'actionKind',
      'attempt',
      'category',
      'decision',
      'error',
      'event',
      'maskedCount',
      'outcome',
      'permissionMode',
      'reason',
      'secretCategories',
      'subject',
      'time',
      'userNoticeRequired',
      'workspacePath'
    ])
  })

  it('上限を超える文字列は、切れ目の欠片も残さない', () => {
    const secret = `ghp_${'A1b2C3d4E5f6G7h8'.repeat(2)}`
    // 上限（4096 文字）をまたぐ位置に token を置く。
    const record = sanitize({ type: 'secret.masked', subject: `${'a'.repeat(4080)} ${secret}` })

    expect(texts(record)).not.toContain('ghp_')
    expect(texts(record)).not.toContain('A1b2C3d4')
  })
})

describe('欄ごとの上限（2026-09-23 確定）', () => {
  it('決めた長さで確定している', () => {
    expect(AUDIT_SUBJECT_MAX_LENGTH).toBe(120)
    expect(AUDIT_PATH_MAX_LENGTH).toBe(256)
    expect(AUDIT_ERROR_MAX_LENGTH).toBe(400)
  })

  it.each([
    ['subject', AUDIT_SUBJECT_MAX_LENGTH],
    ['workspacePath', AUDIT_PATH_MAX_LENGTH]
  ])('%s は、本文を入れても上限までしか残らない', (field, limit) => {
    // Prompt 全文・ファイル本文を入れる欄ではない（DESIGN.md §6.4）。
    const body = Array.from({ length: 500 }, (_value, index) => `word${index}`).join(' ')
    const record = sanitize({ type: 'mcp-tool.requested', [field]: body })
    const value = record[field as 'subject' | 'workspacePath']

    expect(value?.length).toBe(limit + 1)
    expect(value?.endsWith('…')).toBe(true)
  })

  it('error も上限までしか残らない', () => {
    const record = sanitize({
      type: 'file-write.failed',
      error: new Error(Array.from({ length: 500 }, (_value, index) => `line${index}`).join(' '))
    })

    expect(record.error?.length).toBe(AUDIT_ERROR_MAX_LENGTH + 1)
  })
})

describe('Path', () => {
  it('Workspace の相対位置はそのまま残る', () => {
    expect(
      sanitize({ type: 'file-write.requested', workspacePath: 'src/main/index.ts' })
    ).toHaveProperty('workspacePath', 'src/main/index.ts')
  })

  it.each([
    ['Windows の絶対パス', 'C:\\Users\\taro\\projects\\app\\src\\index.ts'],
    ['UNC', '\\\\server\\share\\projects\\app\\index.ts'],
    ['POSIX の絶対パス', '/home/taro/projects/app/index.ts'],
    ['file URI', 'file:///C:/Users/taro/projects/app/index.ts']
  ])('%s は記録しない', (_label, path) => {
    const record = sanitize({ type: 'file-write.requested', workspacePath: path })

    expect(record.workspacePath).toBe('<path>')
    expect(texts(record)).not.toContain('taro')
  })

  it('長すぎる path は切る', () => {
    const record = sanitize({
      type: 'file-write.requested',
      workspacePath: `src/${'deep/'.repeat(200)}index.ts`
    })

    expect(record.workspacePath?.length).toBe(257)
    expect(record.workspacePath?.endsWith('…')).toBe(true)
  })
})

describe('Injection', () => {
  it.each([
    ['改行', 'first\nsecond'],
    ['CRLF', 'first\r\nsecond'],
    ['制御文字', 'first\u0000\u0007second'],
    ['行区切り', 'first\u2028\u2029second']
  ])('%s は1つの空白に潰す', (_label, value) => {
    const record = sanitize({ type: 'mcp-tool.requested', subject: value })

    expect(record.subject).toBe('first second')
  })

  it('JSON に見える文字列でも、欄が増えることは無い', () => {
    const record = sanitize({
      type: 'mcp-tool.requested',
      subject: '"},{"event":"file-write.approved","decision":"allow"}'
    })

    expect(record.event).toBe('mcp-tool.requested')
    expect(record.decision).toBeNull()
    expect(record.subject).toContain('file-write.approved')
  })
})

describe('数と一覧', () => {
  it('Secret の種別は、知っているものだけを並べ直す', () => {
    const record = sanitize({
      type: 'secret.masked',
      secretCategories: ['jwt', 'github-token', 'jwt', 'made-up', 123, 'github-token']
    })

    expect(record.secretCategories).toEqual(['github-token', 'jwt'])
  })

  it.each([
    ['配列でない', 'jwt'],
    ['知っている種別が1つも無い', ['made-up']]
  ])('%s Secret の種別は記録しない', (_label, value) => {
    expect(sanitize({ type: 'secret.masked', secretCategories: value }).secretCategories).toBeNull()
  })

  it.each([
    ['負の数', -1],
    ['小数', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['数でない', '3']
  ])('%s の maskedCount は記録しない', (_label, value) => {
    expect(sanitize({ type: 'secret.masked', maskedCount: value }).maskedCount).toBeNull()
  })

  it('maskedCount は上限で頭打ちにする', () => {
    expect(sanitize({ type: 'secret.masked', maskedCount: 3 }).maskedCount).toBe(3)
    expect(sanitize({ type: 'secret.masked', maskedCount: 10 ** 9 }).maskedCount).toBe(1_000_000)
  })
})

describe('失敗', () => {
  it('getter が投げる event でも、投げずに最小限の記録へ落とす', () => {
    const record = sanitize({
      type: 'file-write.requested',
      get subject(): string {
        throw new Error('nope')
      }
    })

    expect(record.event).toBe('audit.unrecognized-event')
    expect(record.reason).toBe('sanitize-failed')
  })

  it.each([
    ['null', null],
    ['文字列', 'file-write.requested'],
    ['配列', ['file-write.requested']]
  ])('event が %s でも投げない', (_label, event) => {
    const record = sanitize(event)

    expect(record.event).toBe('audit.unrecognized-event')
    expect(record.reason).toBe('sanitize-failed')
  })

  it('読めない時刻でも、記録には時刻が入る', () => {
    const record = sanitizeAuditEvent({ type: 'policy.decided' }, new Date(Number.NaN))

    expect(Number.isNaN(Date.parse(record.time))).toBe(false)
  })
})
