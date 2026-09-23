import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretMaskResult } from '../secret/secretMasking'
import type { SecurityPolicy } from '../policy/securityPolicy'

/**
 * 伏せる処理が最後まで通らなかったときは送らない（Security Core v1 の STEP5）。
 *
 * STEP3 の Masking は「検出が落ちたら全体を伏せる」「上限を超えたら後ろを捨てる」と
 * いう形で**必ず何かを返す**。External Send Gate は、その返り値が
 * 「検査しきれなかった」ことを示している場合（`unscanned` / `truncated`）と、
 * 返り値の形そのものが壊れている場合を、**どちらも deny にする。**
 *
 * この確かめ方のためだけに、Gate 側へ Masking を差し替える引数は作らない
 * （差し替えられる口は、そのまま検査を外す口になる）。ここでは module ごと
 * 差し替えて、Gate の読み方だけを見る。
 */

const ASK: SecurityPolicy = Object.freeze({ permissionMode: 'ask' })

const maskSecretText = vi.fn()

vi.mock('../secret/secretMasking', () => ({
  SECRET_MASK: '***REDACTED***',
  SECRET_SCAN_MAX_CHARS: 1_000_000,
  maskSecretText: (input: unknown) => maskSecretText(input),
  redactSecretText: () => '***REDACTED***',
  describeErrorWithoutSecrets: () => 'error'
}))

const { decideExternalSend } = await import('./externalSendDecision')

function send(): ReturnType<typeof decideExternalSend> {
  return decideExternalSend(ASK, {
    providerId: 'anthropic',
    items: [{ kind: 'user-prompt', text: 'API_KEY=A1b2C3d4E5f6G7h8' }]
  })
}

/** 「Secret は見つからなかった」と名乗りつつ、検査しきれていない返り値。 */
function maskResult(overrides: Partial<SecretMaskResult>): SecretMaskResult {
  return {
    text: 'API_KEY=A1b2C3d4E5f6G7h8',
    secretsFound: false,
    maskedCount: 0,
    categories: [],
    userNoticeRequired: false,
    truncated: false,
    ...overrides
  }
}

beforeEach(() => {
  maskSecretText.mockReset()
})

describe('検査しきれなかったものは送らない', () => {
  it('検査できなかった範囲がある（unscanned）', () => {
    maskSecretText.mockImplementation(() => maskResult({ categories: ['unscanned'] }))

    expect(send()).toEqual({ decision: 'deny', reason: 'sanitize-failed' })
  })

  it('上限で後ろを捨てた（truncated）', () => {
    maskSecretText.mockImplementation(() => maskResult({ truncated: true }))

    expect(send()).toEqual({ decision: 'deny', reason: 'sanitize-failed' })
  })

  it.each([
    ['undefined', undefined],
    ['null', null]
  ])('返り値が読めない（%s）', (_name, result) => {
    // 欄を読もうとした時点で落ちる。捕まえて deny する（未検査の本文は先へ進まない）。
    maskSecretText.mockImplementation(() => result)

    expect(send()).toEqual({ decision: 'deny', reason: 'gate-failed' })
  })

  it.each([
    ['文字列', 'API_KEY=A1b2C3d4E5f6G7h8'],
    ['欄が足りない', { text: 'API_KEY=A1b2C3d4E5f6G7h8' }],
    ['text が文字列でない', maskResult({ text: 42 as unknown as string })],
    ['maskedCount が数でない', maskResult({ maskedCount: '1' as unknown as number })],
    ['categories が配列でない', maskResult({ categories: 'unscanned' as unknown as [] })],
    ['知らない categories', maskResult({ categories: ['invented' as never] })]
  ])('返り値の形が壊れている（%s）', (_name, result) => {
    maskSecretText.mockImplementation(() => result)

    expect(send()).toEqual({ decision: 'deny', reason: 'sanitize-failed' })
  })

  it('検査が例外で落ちた', () => {
    maskSecretText.mockImplementation(() => {
      throw new Error('regex exploded')
    })

    expect(send()).toEqual({ decision: 'deny', reason: 'gate-failed' })
  })

  it('拒んだ結果に、未検査の本文は入らない', () => {
    maskSecretText.mockImplementation(() => maskResult({ categories: ['unscanned'] }))

    expect(JSON.stringify(send())).not.toContain('A1b2C3d4E5f6G7h8')
  })
})
