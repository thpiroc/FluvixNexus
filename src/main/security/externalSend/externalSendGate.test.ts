import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '../audit/auditEvent'
import { sanitizeAuditEvent } from '../audit/auditRecord'
import type { SecurityPolicy } from '../policy/securityPolicy'
import { SECRET_MASK } from '../secret/secretMasking'
import { createExternalSendGate, type ExternalSendGate } from './externalSendGate'
import { isSafeExternalPayload, type SafeExternalPayload } from './safeExternalPayload'

/**
 * External Send Gate の動き（Security Core v1 の STEP5）。
 *
 * Provider へ渡るのは Gate を通った Payload だけであること・Audit（STEP4）へ本文が
 * 渡らないこと・Audit の失敗で結論が変わらないこと。
 */

const ASK: SecurityPolicy = Object.freeze({ permissionMode: 'ask' })

interface Harness {
  readonly gate: ExternalSendGate
  readonly events: AuditEvent[]
  readonly delivered: SafeExternalPayload[]
  readonly deliver: (payload: SafeExternalPayload) => string
}

function harness(
  options: {
    readonly readPolicy?: () => SecurityPolicy
    readonly recordEvent?: (event: AuditEvent) => void
  } = {}
): Harness {
  const events: AuditEvent[] = []
  const delivered: SafeExternalPayload[] = []

  const gate = createExternalSendGate({
    readPolicy: options.readPolicy ?? (() => ASK),
    recordEvent:
      options.recordEvent ??
      ((event) => {
        events.push(event)
      })
  })

  return {
    gate,
    events,
    delivered,
    deliver: (payload) => {
      delivered.push(payload)
      return 'sent'
    }
  }
}

function prompt(text: string): unknown {
  return { providerId: 'anthropic', items: [{ kind: 'user-prompt', text }] }
}

describe('allow', () => {
  it('Safe Payload だけを送る手続きへ渡す', async () => {
    const { gate, delivered, deliver } = harness()
    const outcome = await gate.send(prompt('この関数を説明して'), deliver)

    expect(outcome.decision).toBe('allow')

    if (outcome.decision !== 'allow') {
      return
    }

    expect(outcome.delivered).toBe('sent')
    expect(outcome.notice.userNoticeRequired).toBe(false)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].parts).toEqual([
      { kind: 'user-prompt', label: null, text: 'この関数を説明して' }
    ])
  })

  it('送る手続きの中では Safe Payload だと確かめられ、送った後は使い回せない', async () => {
    const { gate } = harness()
    let inside: boolean | null = null
    let captured: SafeExternalPayload | null = null

    await gate.send(prompt('hello'), (payload) => {
      inside = isSafeExternalPayload(payload)
      captured = payload
      return null
    })

    expect(inside).toBe(true)
    expect(captured).not.toBeNull()
    expect(isSafeExternalPayload(captured)).toBe(false)
  })

  it('Secret は伏せて送り、知らせるための metadata が残る', async () => {
    const { gate, delivered, deliver } = harness()
    const outcome = await gate.send(
      prompt('token は ghp_0123456789abcdefghijklmnopqrstuvwxyz'),
      deliver
    )

    if (outcome.decision !== 'allow') {
      throw new Error(`expected allow, got ${outcome.reason}`)
    }

    expect(outcome.notice).toEqual({
      secretsMasked: true,
      maskedCount: 1,
      categories: ['github-token'],
      userNoticeRequired: true
    })
    expect(delivered[0].parts[0].text).toBe(`token は ${SECRET_MASK}`)
  })

  it('Policy が読めなくても送れる（外部送信は Permission で止めない）', async () => {
    const { gate, delivered, deliver } = harness({
      readPolicy: () => {
        throw new Error('settings unreadable')
      }
    })

    expect((await gate.send(prompt('hello'), deliver)).decision).toBe('allow')
    expect(delivered).toHaveLength(1)
  })
})

describe('deny', () => {
  it('拒んだときは送る手続きを呼ばない', async () => {
    const { gate, delivered, deliver } = harness()
    const outcome = await gate.send({ providerId: 'anthropic', items: [] }, deliver)

    expect(outcome).toEqual({ decision: 'deny', reason: 'empty-context' })
    expect(delivered).toEqual([])
  })

  it('送る手続きが関数でなければ deny（判定より先に落とす）', async () => {
    const { gate, events } = harness()
    const outcome = await gate.send(prompt('hello'), undefined as never)

    expect(outcome).toEqual({ decision: 'deny', reason: 'invalid-payload' })
    expect(events.map((event) => event.type)).toEqual(['external-send.denied'])
  })

  it('raw で送り直す経路は無い（拒否の結果に Payload は入らない）', async () => {
    const { gate, deliver } = harness()
    const outcome = await gate.send(
      { providerId: 'anthropic', items: [{ kind: 'terminal-output', text: 'ls -al' }] },
      deliver
    )

    expect(outcome).toEqual({ decision: 'deny', reason: 'unknown-context-kind' })
    expect(Object.keys(outcome).sort()).toEqual(['decision', 'reason'])
    expect(JSON.stringify(outcome)).not.toContain('ls -al')
  })
})

describe('送る手続きが失敗したとき', () => {
  it('例外はそのまま伝わり、Payload は取り消される（raw fallback は無い）', async () => {
    const { gate } = harness()
    let captured: SafeExternalPayload | null = null

    await expect(
      gate.send(prompt('hello'), (payload) => {
        captured = payload
        throw new Error('provider unreachable')
      })
    ).rejects.toThrow('provider unreachable')

    expect(captured).not.toBeNull()
    expect(isSafeExternalPayload(captured)).toBe(false)
  })
})

describe('Audit（STEP4）への接続', () => {
  it('allow を記録する', async () => {
    const { gate, events, deliver } = harness()

    await gate.send(prompt('token は ghp_0123456789abcdefghijklmnopqrstuvwxyz'), deliver)

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'external-send.allowed',
      decision: 'allow',
      reason: 'context-sanitized',
      permissionMode: 'ask',
      subject: 'anthropic',
      secretCategories: ['github-token'],
      maskedCount: 1,
      userNoticeRequired: true
    })
  })

  it('deny を記録する', async () => {
    const { gate, events, deliver } = harness()

    await gate.send({ providerId: 'anthropic', items: [{ kind: 'x', text: 'a' }] }, deliver)

    expect(events).toEqual([
      {
        type: 'external-send.denied',
        decision: 'deny',
        reason: 'unknown-context-kind',
        permissionMode: 'ask',
        subject: 'anthropic'
      }
    ])
  })

  it('識別子の形が通らなければ、その文字列は記録しない', async () => {
    const { gate, events, deliver } = harness()

    await gate.send(
      { providerId: 'sk-ant-api03-abcdefghijklmnop', items: [{ kind: 'user-prompt', text: 'a' }] },
      deliver
    )

    expect(events[0].reason).toBe('invalid-provider')
    expect(events[0].subject).toBeUndefined()
    expect(JSON.stringify(events)).not.toContain('sk-ant')
  })

  it('Prompt 本文・ファイルの中身・Secret・Credential は記録に入らない', async () => {
    const { gate, events, deliver } = harness()

    await gate.send(
      {
        providerId: 'anthropic',
        // Gate は読まない欄（Credential を混ぜても Context にも Audit にも入らない）。
        apiKey: 'sk-ant-api03-Abcdefghijklmnopqrstuvwxyz0123',
        items: [
          { kind: 'user-prompt', text: '社外秘の設計をレビューして' },
          {
            kind: 'tool-result',
            text: 'GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz',
            label: 'src/deploy.ts'
          }
        ]
      },
      deliver
    )

    const recorded = JSON.stringify(events.map((event) => sanitizeAuditEvent(event)))

    for (const forbidden of [
      '社外秘の設計をレビューして',
      'GITHUB_TOKEN',
      'ghp_0123456789',
      'sk-ant-api03',
      'src/deploy.ts'
    ]) {
      expect(recorded).not.toContain(forbidden)
    }

    expect(JSON.parse(recorded)[0]).toMatchObject({
      event: 'external-send.allowed',
      decision: 'allow',
      reason: 'context-sanitized',
      subject: 'anthropic'
    })
  })

  it('記録した event は、Audit がそのまま書ける形になっている', async () => {
    const { gate, events, deliver } = harness()

    await gate.send(prompt('hello'), deliver)

    const record = sanitizeAuditEvent(events[0])

    expect(record.event).toBe('external-send.allowed')
    expect(record.reason).toBe('context-sanitized')
    expect(record.subject).toBe('anthropic')
  })

  it('Audit が失敗しても allow / deny は変わらない', async () => {
    const recordEvent = vi.fn(() => {
      throw new Error('audit log is full')
    })

    const allowing = harness({ recordEvent })
    const allowed = await allowing.gate.send(prompt('hello'), allowing.deliver)

    expect(allowed.decision).toBe('allow')
    expect(allowing.delivered).toHaveLength(1)

    const denying = harness({ recordEvent })
    const denied = await denying.gate.send({ providerId: 'anthropic', items: [] }, denying.deliver)

    expect(denied).toEqual({ decision: 'deny', reason: 'empty-context' })
    expect(denying.delivered).toEqual([])
    expect(recordEvent).toHaveBeenCalledTimes(2)
  })
})

describe('Safe Payload は偽造できない', () => {
  it('手で組んだもの・写し・JSON を通したものは、実行時の検査で落ちる', async () => {
    const { gate } = harness()
    let real: SafeExternalPayload | null = null

    await gate.send(prompt('hello'), (payload) => {
      real = payload
      return null
    })

    const payload = real as SafeExternalPayload | null

    if (payload === null) {
      throw new Error('expected a payload')
    }

    for (const forged of [
      { providerId: 'anthropic', parts: [], totalChars: 0, notice: {} },
      { ...payload },
      JSON.parse(JSON.stringify(payload)),
      Object.create(payload),
      Object.assign(Object.create(null), payload)
    ]) {
      expect(isSafeExternalPayload(forged)).toBe(false)
    }
  })
})
