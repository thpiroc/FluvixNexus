import { describe, expect, it } from 'vitest'
import { decideExternalSend } from '../security/externalSend/externalSendDecision'
import type { SafeExternalPayload } from '../security/externalSend/safeExternalPayload'
import { createScriptedProvider, SCRIPTED_PROVIDER_ID } from './scriptedProvider'

/**
 * Scripted Provider（開発ビルド専用。Security Core v1 の STEP9）。
 *
 * 実際の AI ではないが、本物の Provider と同じく Gate の発行した Payload だけを受け取る。
 */

function payload(prompt: string): SafeExternalPayload {
  const decision = decideExternalSend(
    { permissionMode: 'ask' },
    { providerId: SCRIPTED_PROVIDER_ID, items: [{ kind: 'user-prompt', text: prompt }] }
  )

  if (decision.decision !== 'allow') {
    throw new Error('expected allow')
  }

  return decision.payload
}

const signal = new AbortController().signal

describe('境界', () => {
  it('識別子は External Send Gate が受け付ける形', () => {
    expect(SCRIPTED_PROVIDER_ID).toMatch(/^[a-z0-9-]{1,40}$/)
    expect(payload('x').providerId).toBe(SCRIPTED_PROVIDER_ID)
  })

  it('Gate が発行していない Payload は受け取らない', async () => {
    const provider = createScriptedProvider()
    const forged = { providerId: SCRIPTED_PROVIDER_ID, parts: [], totalChars: 0, notice: {} }

    await expect(provider.next(forged as unknown as SafeExternalPayload, signal)).rejects.toThrow()
  })

  it('別の Provider 宛ての Payload には答えない（Gate が発行したものでも）', async () => {
    const decision = decideExternalSend(
      { permissionMode: 'ask' },
      { providerId: 'fn-other-provider', items: [{ kind: 'user-prompt', text: 'x' }] }
    )

    if (decision.decision !== 'allow') {
      throw new Error('expected allow')
    }

    await expect(createScriptedProvider().next(decision.payload, signal)).rejects.toThrow()
  })

  it('中断されていれば答えない', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(createScriptedProvider().next(payload('x'), controller.signal)).rejects.toThrow()
  })
})

describe('手順', () => {
  it('印が無ければ E2E（状態 → 一覧 → 検索 → 書き込み）から始める', async () => {
    const provider = createScriptedProvider()
    const types: string[] = []

    for (let step = 0; step < 4; step += 1) {
      const output = (await provider.next(payload('E2E'), signal)) as {
        action: { type: string }
      }
      types.push(output.action.type)
    }

    expect(types).toEqual(['workspace_status', 'workspace_list', 'file_search', 'file_write'])
  })

  it('#secret は .env を読もうとする', async () => {
    const output = (await createScriptedProvider().next(payload('#secret'), signal)) as {
      action: { type: string; path: string }
    }

    expect(output.action).toEqual({ type: 'file_read', path: '.env' })
  })
})
