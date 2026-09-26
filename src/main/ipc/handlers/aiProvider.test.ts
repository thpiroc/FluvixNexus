import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  createAiProviderCredentialStore,
  type AiProviderCredentialCipher,
  type AiProviderCredentialStore
} from '../../aiProvider/aiProviderCredentialStore'
import { IpcError, toIpcErrorPayload } from '../errors'

/**
 * ai-provider ハンドラの境界（STEP10-5）。
 *
 * 本物の Credential Store（一時フォルダ・偽の暗号）をつなぎ、IPC の要求として届く素の値で
 * 呼ぶ。確かめるのは「3本だけ」「要求を Main で確かめ直す」「応答・失敗に Key も Error の本文も
 * 載らない」。Key はすべて架空のもの。
 */

const CANARY = 'sk-fn-test-CANARY-ipc-5d1e9b3f7a2c'
const REPLACED = 'sk-fn-test-REPLACED-ipc-8a6c4e2f0b1d'

const handlers = vi.hoisted(() => new Map<string, (request: unknown) => unknown>())
const current = vi.hoisted(() => ({ store: null as AiProviderCredentialStore | null }))

vi.mock('../registry', () => ({
  handleIpc: (channel: string, handler: (request: unknown) => unknown) => {
    handlers.set(channel, handler)
  }
}))

vi.mock('../../aiProvider/aiProviderService', () => ({
  getAiProviderCredentialStore: () => {
    if (current.store === null) {
      throw new Error('store not prepared')
    }
    return current.store
  }
}))

const { registerAiProviderHandlers } = await import('./aiProvider')

let directory: string
let available: boolean

const cipher: AiProviderCredentialCipher = {
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${Buffer.from(plain).reverse().toString('hex')}`),
  decryptString: (encrypted) => {
    const text = encrypted.toString('utf8')

    if (!text.startsWith('enc:')) {
      throw new Error('cannot decrypt')
    }

    return Buffer.from(text.slice(4), 'hex').reverse().toString('utf8')
  }
}

function call(channel: string, request: unknown): unknown {
  const handler = handlers.get(channel)

  if (handler === undefined) {
    throw new Error(`no handler for ${channel}`)
  }

  return handler(request)
}

/** 投げられたものを、Renderer へ返る形（registry と同じ変換）にして返す。 */
function rejectionOf(channel: string, request: unknown): ReturnType<typeof toIpcErrorPayload> {
  try {
    call(channel, request)
  } catch (cause) {
    return toIpcErrorPayload(cause)
  }

  throw new Error('expected the handler to throw')
}

beforeEach(() => {
  handlers.clear()
  directory = mkdtempSync(join(tmpdir(), 'fluvix-ai-provider-ipc-'))
  available = true
  current.store = createAiProviderCredentialStore(directory, cipher)
  registerAiProviderHandlers()
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('チャンネル', () => {
  it('設定済みか・設定・削除の3本だけを登録する', () => {
    expect([...handlers.keys()].sort()).toEqual([
      IPC_CHANNELS.AI_PROVIDER_DELETE_CREDENTIAL,
      IPC_CHANNELS.AI_PROVIDER_HAS_CREDENTIAL,
      IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL
    ])
  })
})

describe('set / replace / delete / has', () => {
  it('設定 → 置き換え → 削除を、状態だけで返す', () => {
    expect(call(IPC_CHANNELS.AI_PROVIDER_HAS_CREDENTIAL, { providerId: 'openai' })).toEqual({
      providerId: 'openai',
      state: 'not-set',
      canStore: true
    })

    expect(
      call(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, { providerId: 'openai', apiKey: CANARY })
    ).toEqual({ ok: true, status: { providerId: 'openai', state: 'set', canStore: true } })

    expect(
      call(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, { providerId: 'openai', apiKey: REPLACED })
    ).toEqual({ ok: true, status: { providerId: 'openai', state: 'set', canStore: true } })

    const used = current.store?.withCredential('openai', (apiKey) => apiKey)
    expect(used).toEqual({ ok: true, value: REPLACED })

    expect(call(IPC_CHANNELS.AI_PROVIDER_DELETE_CREDENTIAL, { providerId: 'openai' })).toEqual({
      ok: true,
      status: { providerId: 'openai', state: 'not-set', canStore: true }
    })
    expect(readdirSync(directory)).toEqual([])
  })

  it('Key の形が通らなければ保存せず、分類だけを返す（IPC の失敗にしない）', () => {
    for (const apiKey of ['', 'sk with space', undefined, 42, { nested: CANARY }]) {
      expect(
        call(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, { providerId: 'openai', apiKey })
      ).toEqual({
        ok: false,
        failure: 'value-invalid',
        status: { providerId: 'openai', state: 'not-set', canStore: true }
      })
    }
  })

  it('OS の暗号化が使えなければ保存せず、encryption-unavailable を返す', () => {
    available = false

    expect(
      call(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, { providerId: 'openai', apiKey: CANARY })
    ).toEqual({
      ok: false,
      failure: 'encryption-unavailable',
      status: { providerId: 'openai', state: 'not-set', canStore: false }
    })
    expect(readdirSync(directory)).toEqual([])
  })
})

describe('要求は Main で確かめ直す', () => {
  it('正式でない Provider（scripted・任意の文字列・欠け）は INVALID_REQUEST。届いた値は文言に載らない', () => {
    for (const channel of [
      IPC_CHANNELS.AI_PROVIDER_HAS_CREDENTIAL,
      IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL,
      IPC_CHANNELS.AI_PROVIDER_DELETE_CREDENTIAL
    ]) {
      for (const request of [
        { providerId: 'scripted', apiKey: CANARY },
        { providerId: 'fn-scripted-dev', apiKey: CANARY },
        { providerId: 'anthropic', apiKey: CANARY },
        { providerId: 'OpenAI', apiKey: CANARY },
        { providerId: '__proto__', apiKey: CANARY },
        { providerId: CANARY, apiKey: CANARY },
        { apiKey: CANARY },
        null,
        undefined,
        CANARY
      ]) {
        const payload = rejectionOf(channel, request)

        expect(payload).toEqual({ code: 'INVALID_REQUEST', message: 'unknown AI provider.' })
        expect(JSON.stringify(payload)).not.toContain(CANARY)
      }
    }

    expect(readdirSync(directory)).toEqual([])
  })
})

describe('Key も Error の本文も Renderer へ返らない', () => {
  it('どの応答にも Key が載らない', () => {
    const responses = [
      call(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, { providerId: 'openai', apiKey: CANARY }),
      call(IPC_CHANNELS.AI_PROVIDER_HAS_CREDENTIAL, { providerId: 'openai' }),
      call(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, {
        providerId: 'openai',
        apiKey: `${CANARY} x`
      }),
      call(IPC_CHANNELS.AI_PROVIDER_DELETE_CREDENTIAL, { providerId: 'openai' })
    ]

    expect(JSON.stringify(responses)).not.toContain(CANARY)
  })

  it('想定外の例外は、固定の文言だけの INTERNAL になる（detail も Error の本文も無い）', () => {
    const leaky = (): never => {
      throw new Error(`EPERM while writing ${CANARY} to C:\\Users\\someone\\AppData`)
    }

    current.store = {
      canStore: leaky,
      getState: leaky,
      getStatus: leaky,
      setCredential: leaky,
      deleteCredential: leaky,
      withCredential: leaky
    }

    for (const [channel, request] of [
      [IPC_CHANNELS.AI_PROVIDER_HAS_CREDENTIAL, { providerId: 'openai' }],
      [IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, { providerId: 'openai', apiKey: CANARY }],
      [IPC_CHANNELS.AI_PROVIDER_DELETE_CREDENTIAL, { providerId: 'openai' }]
    ] as const) {
      let thrown: unknown

      try {
        call(channel, request)
      } catch (cause) {
        thrown = cause
      }

      expect(thrown).toBeInstanceOf(IpcError)
      expect(toIpcErrorPayload(thrown)).toEqual({
        code: 'INTERNAL',
        message: 'the AI provider credential operation failed.'
      })
      expect(JSON.stringify(toIpcErrorPayload(thrown))).not.toMatch(/CANARY|EPERM|AppData/)
    }
  })

  it('保存したファイルにも平文の Key は無い', () => {
    call(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, { providerId: 'openai', apiKey: CANARY })

    for (const name of readdirSync(directory)) {
      expect(readFileSync(join(directory, name), 'utf8')).not.toContain(CANARY)
    }
  })
})
