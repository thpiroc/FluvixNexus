import { describe, expect, it } from 'vitest'
import type { SecurityPolicy } from '../policy/securityPolicy'
import { SECRET_MASK } from '../secret/secretMasking'
import {
  EXTERNAL_CONTEXT_KINDS,
  EXTERNAL_PROVIDER_ID_MAX_LENGTH,
  EXTERNAL_SEND_ITEM_MAX_CHARS,
  EXTERNAL_SEND_LABEL_MAX_LENGTH,
  EXTERNAL_SEND_MAX_ITEMS,
  EXTERNAL_SEND_TOTAL_MAX_CHARS
} from './externalSendContext'
import { decideExternalSend, type ExternalSendDecision } from './externalSendDecision'
import { isSafeExternalPayload, type SafeExternalPayload } from './safeExternalPayload'

/**
 * External Send Gate の判定（Security Core v1 の STEP5）。
 *
 * Workspace のファイル（Boundary が要るもの）は externalSendWorkspace.test.ts、
 * Audit との接続は externalSendGate.test.ts が見る。
 */

const ASK: SecurityPolicy = Object.freeze({ permissionMode: 'ask' })
const READ: SecurityPolicy = Object.freeze({ permissionMode: 'read' })

function send(items: unknown, providerId: unknown = 'anthropic'): ExternalSendDecision {
  return decideExternalSend(ASK, { providerId, items })
}

function allowed(decision: ExternalSendDecision): SafeExternalPayload {
  if (decision.decision !== 'allow') {
    throw new Error(`expected allow, got deny (${decision.reason})`)
  }

  return decision.payload
}

function denialOf(decision: ExternalSendDecision): string {
  return decision.decision === 'deny' ? decision.reason : `allow`
}

describe('基本', () => {
  it('Secret の無い Prompt は allow', () => {
    const payload = allowed(send([{ kind: 'user-prompt', text: 'この関数の意味を教えて' }]))

    expect(payload.providerId).toBe('anthropic')
    expect(payload.parts).toEqual([
      { kind: 'user-prompt', label: null, text: 'この関数の意味を教えて' }
    ])
    expect(payload.notice).toEqual({
      secretsMasked: false,
      maskedCount: 0,
      categories: [],
      userNoticeRequired: false
    })
    expect(isSafeExternalPayload(payload)).toBe(true)
  })

  it('知っている種類はすべて allow', () => {
    const payload = allowed(
      send(
        EXTERNAL_CONTEXT_KINDS.filter((kind) => kind !== 'workspace-file').map((kind) => ({
          kind,
          text: `${kind} の中身`
        }))
      )
    )

    expect(payload.parts.map((part) => part.kind)).toEqual([
      'agent-instruction',
      'error-summary',
      'mcp-read-result',
      'tool-result',
      'user-prompt'
    ])
  })

  it('複数の Context は順番のまま並ぶ', () => {
    const payload = allowed(
      send([
        { kind: 'agent-instruction', text: 'あなたは開発の補助をします' },
        { kind: 'user-prompt', text: 'テストを足して' },
        { kind: 'tool-result', text: '3 files changed', label: 'files.search' }
      ])
    )

    expect(payload.parts.map((part) => part.text)).toEqual([
      'あなたは開発の補助をします',
      'テストを足して',
      '3 files changed'
    ])
    expect(payload.parts[2].label).toBe('files.search')
    expect(payload.totalChars).toBe(payload.parts.reduce((sum, part) => sum + part.text.length, 0))
  })

  it('Permission が read でも、外部への送信そのものは止めない', () => {
    const decision = decideExternalSend(READ, {
      providerId: 'anthropic',
      items: [{ kind: 'user-prompt', text: 'こんにちは' }]
    })

    expect(decision.decision).toBe('allow')
  })

  /*
    v1 では External Send そのものに承認を求めない（2026-09-23 確定。DESIGN.md §6.4）。
    Permission を変えても・拒まれる形を渡しても、返るのは allow か deny のどちらかだけで、
    `ask` は出てこない ── STEP6 の Approval Manager は External Send を扱わない。
  */
  it('返る判定は allow / deny の2値だけ（ask は返さない）', () => {
    const requests: readonly unknown[] = [
      { providerId: 'anthropic', items: [{ kind: 'user-prompt', text: 'hello' }] },
      { providerId: 'anthropic', items: [] },
      { providerId: 'Anthropic', items: [{ kind: 'user-prompt', text: 'hello' }] },
      { providerId: 'anthropic', items: [{ kind: 'workspace-file', text: 'a' }] },
      null
    ]

    for (const policy of [READ, ASK]) {
      for (const request of requests) {
        expect(['allow', 'deny']).toContain(decideExternalSend(policy, request).decision)
      }
    }
  })

  it('返す Payload と欄は凍結されている', () => {
    const payload = allowed(send([{ kind: 'user-prompt', text: 'hello' }]))

    expect(Object.isFrozen(payload)).toBe(true)
    expect(Object.isFrozen(payload.parts)).toBe(true)
    expect(Object.isFrozen(payload.parts[0])).toBe(true)
    expect(Object.isFrozen(payload.notice)).toBe(true)
  })
})

describe('形が違うものは deny', () => {
  it('Payload そのもの', () => {
    for (const request of [null, undefined, 'prompt', 42, [], () => undefined]) {
      expect(denialOf(decideExternalSend(ASK, request))).toBe('invalid-payload')
    }
  })

  it('items が配列でない', () => {
    for (const items of [undefined, null, 'text', {}, 3]) {
      expect(denialOf(send(items))).toBe('invalid-payload')
    }
  })

  it('Context が object でない', () => {
    for (const item of [null, 'text', 5, []]) {
      expect(denialOf(send([item]))).toBe('invalid-payload')
    }
  })

  it('text が文字列でない', () => {
    for (const text of [undefined, null, 5, {}, ['a']]) {
      expect(denialOf(send([{ kind: 'user-prompt', text }]))).toBe('invalid-payload')
    }
  })

  it('label が文字列でない・長すぎる', () => {
    expect(denialOf(send([{ kind: 'user-prompt', text: 'a', label: 7 }]))).toBe('invalid-payload')
    expect(
      denialOf(
        send([
          { kind: 'user-prompt', text: 'a', label: 'x'.repeat(EXTERNAL_SEND_LABEL_MAX_LENGTH + 1) }
        ])
      )
    ).toBe('invalid-payload')
  })

  it('workspace-file 以外に source が付いている', () => {
    expect(
      denialOf(
        send([
          { kind: 'tool-result', text: 'a', source: { insideWorkspace: true, secretFile: false } }
        ])
      )
    ).toBe('invalid-payload')
  })

  it('知らない Context の種類', () => {
    for (const kind of ['terminal-output', 'raw-mcp', '', null, undefined, 'toString']) {
      expect(denialOf(send([{ kind, text: 'a' }]))).toBe('unknown-context-kind')
    }
  })

  it('送るものが無い', () => {
    expect(denialOf(send([]))).toBe('empty-context')
    expect(denialOf(send([{ kind: 'user-prompt', text: '' }]))).toBe('empty-context')
    expect(
      denialOf(
        send([
          { kind: 'user-prompt', text: '' },
          { kind: 'tool-result', text: '' }
        ])
      )
    ).toBe('empty-context')
  })

  it('label だけがあれば、送るものはある', () => {
    const payload = allowed(send([{ kind: 'tool-result', text: '', label: 'files.search' }]))

    expect(payload.parts[0]).toEqual({ kind: 'tool-result', label: 'files.search', text: '' })
  })
})

describe('Provider の識別子', () => {
  it('短い名前だけを受け付ける', () => {
    for (const providerId of ['anthropic', 'openai-compatible', 'local-llm2']) {
      expect(send([{ kind: 'user-prompt', text: 'a' }], providerId).decision).toBe('allow')
    }
  })

  it.each([
    [''],
    ['Anthropic'],
    ['https://api.anthropic.com'],
    ['sk-ant-api03-abcdefghijklmnop'],
    ['a'.repeat(EXTERNAL_PROVIDER_ID_MAX_LENGTH + 1)],
    ['-anthropic'],
    ['anthropic-'],
    ['anthropic provider'],
    [undefined],
    [null],
    [7]
  ])('URL・API Key・大文字・長すぎるものは deny（%s）', (providerId) => {
    const request = { providerId, items: [{ kind: 'user-prompt', text: 'a' }] }

    expect(denialOf(decideExternalSend(ASK, request))).toBe('invalid-provider')
  })
})

describe('Context の中の Secret は伏せて送る', () => {
  /** [種別, Context に入れる文（伏せる前）, 1文字も残ってはいけない値] */
  const secrets: readonly (readonly [string, string, string])[] = [
    [
      'provider-api-key',
      'sk-ant-api03-Abcdefghijklmnopqrstuvwxyz0123456789',
      'sk-ant-api03-Abcdefghijklmnopqrstuvwxyz0123456789'
    ],
    [
      'github-token',
      'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
      'ghp_0123456789abcdefghijklmnopqrstuvwxyz'
    ],
    [
      'jwt',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'
    ],
    ['key-value', 'password = "Tr0ub4dor&3xKcd"', 'Tr0ub4dor&3xKcd'],
    [
      'authorization-value',
      'Authorization: Bearer Abcdefghijklmnopqrstuvwxyz0123',
      'Abcdefghijklmnopqrstuvwxyz0123'
    ]
  ]

  it.each(secrets)('%s は完全に伏せられる', (category, text, value) => {
    const payload = allowed(send([{ kind: 'user-prompt', text: `使う値は ${text} です` }]))
    const serialized = JSON.stringify(payload)

    expect(payload.parts[0].text).toContain(SECRET_MASK)
    expect(payload.notice.secretsMasked).toBe(true)
    expect(payload.notice.maskedCount).toBeGreaterThanOrEqual(1)
    expect(payload.notice.categories).toContain(category)
    expect(payload.notice.userNoticeRequired).toBe(true)

    // 値も、値の断片も、Payload のどこにも残らない。
    for (const fragment of [value, value.slice(0, 10), value.slice(-10)]) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it('Private Key は block ごと伏せる', () => {
    const key = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA3Tz2mr7SZiAMfQyuvBjM9OiJjRazXBZ1BjP5CE/Wm/Rr500P',
      '-----END RSA PRIVATE KEY-----'
    ].join('\n')

    const payload = allowed(send([{ kind: 'tool-result', text: `key:\n${key}\n`, label: 'notes' }]))

    expect(payload.parts[0].text).toBe(`key:\n${SECRET_MASK}\n`)
    expect(payload.notice.categories).toEqual(['private-key'])
  })

  it('複数の Secret が複数の Context にあっても、すべて伏せて数え上げる', () => {
    const payload = allowed(
      send([
        { kind: 'user-prompt', text: 'token は ghp_0123456789abcdefghijklmnopqrstuvwxyz' },
        { kind: 'tool-result', text: 'AWS は AKIAIOSFODNN7EXAMPLE' }
      ])
    )

    expect(payload.notice.maskedCount).toBe(2)
    expect(payload.notice.categories).toEqual(['github-token', 'provider-api-key'])
    expect(JSON.stringify(payload)).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('伏せた後も、安全な Context はそのまま残る', () => {
    const payload = allowed(
      send([
        {
          kind: 'tool-result',
          text: 'const client = new Client({ apiKey: "sk-Abcdefghijklmnopqrstuvwxyz01" })',
          label: 'src/client.ts'
        }
      ])
    )

    expect(payload.parts[0].text).toBe(`const client = new Client({ apiKey: "${SECRET_MASK}" })`)
    expect(payload.parts[0].label).toBe('src/client.ts')
  })

  it('label の中の Secret も伏せる', () => {
    const payload = allowed(
      send([
        {
          kind: 'tool-result',
          text: 'ok',
          label: 'https://user:Tr0ub4dor3xKcd@example.com/repo'
        }
      ])
    )

    expect(payload.parts[0].label).toContain(SECRET_MASK)
    expect(JSON.stringify(payload)).not.toContain('Tr0ub4dor3xKcd')
    expect(payload.notice.categories).toEqual(['url-credential'])
  })

  it('metadata に、元の値を持つ欄は無い', () => {
    const payload = allowed(
      send([{ kind: 'user-prompt', text: 'ghp_0123456789abcdefghijklmnopqrstuvwxyz' }])
    )

    expect(Object.keys(payload.notice).sort()).toEqual([
      'categories',
      'maskedCount',
      'secretsMasked',
      'userNoticeRequired'
    ])
    expect(Object.keys(payload).sort()).toEqual(['notice', 'parts', 'providerId', 'totalChars'])
  })
})

describe('大きさの上限', () => {
  it('1件が上限を超えたら deny（縮めて送らない）', () => {
    const text = 'a'.repeat(EXTERNAL_SEND_ITEM_MAX_CHARS + 1)

    expect(denialOf(send([{ kind: 'user-prompt', text }]))).toBe('context-too-large')
  })

  it('1件が上限ちょうどなら通る', () => {
    const text = 'a'.repeat(EXTERNAL_SEND_ITEM_MAX_CHARS)

    expect(send([{ kind: 'user-prompt', text }]).decision).toBe('allow')
  })

  it('合計が上限を超えたら deny', () => {
    const full = 'b'.repeat(EXTERNAL_SEND_TOTAL_MAX_CHARS)

    expect(
      denialOf(
        send([
          { kind: 'user-prompt', text: full },
          { kind: 'tool-result', text: 'c' }
        ])
      )
    ).toBe('context-too-large')
  })

  it('件数が上限を超えたら deny', () => {
    const items = Array.from({ length: EXTERNAL_SEND_MAX_ITEMS + 1 }, () => ({
      kind: 'user-prompt',
      text: 'a'
    }))

    expect(denialOf(send(items))).toBe('context-too-large')
  })
})

describe('判定の途中で落ちても、未検査のまま進まない', () => {
  it('欄の getter が投げたら gate-failed', () => {
    const items = [
      {
        kind: 'user-prompt',
        get text(): string {
          throw new Error('boom')
        }
      }
    ]

    expect(denialOf(send(items))).toBe('gate-failed')
  })

  it('items を辿る途中で投げたら gate-failed', () => {
    const items = new Proxy([{ kind: 'user-prompt', text: 'a' }], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error('boom')
        }

        return Reflect.get(target, property, receiver)
      }
    })

    expect(Array.isArray(items)).toBe(true)
    expect(denialOf(send(items))).toBe('gate-failed')
  })
})
