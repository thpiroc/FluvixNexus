import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupportedProviderId } from '@shared/aiProvider'
import {
  AI_PROVIDER_CREDENTIALS_FILE_NAME,
  createAiProviderCredentialStore,
  type AiProviderCredentialCipher,
  type AiProviderCredentialStore
} from './aiProviderCredentialStore'

/**
 * AI Provider の API Key の保存（STEP10-5）。
 *
 * `safeStorage` の代わりに、平文を XOR して印を付けるだけの偽の暗号を渡す。確かめたいのは
 * 「暗号化できないときに書かない」「壊れていたら使わない」「Key がファイル・知らせ・戻り値へ
 * 平文で出ない」で、DPAPI そのものの強さではない。Key はすべて架空のもの。
 */

const CANARY = 'sk-fn-test-CANARY-7f3a9c1e5b2d4f6a8c0e'
const REPLACED = 'sk-fn-test-REPLACED-0e8c6a4f2d1b3c5e7a9f'
const MARK = Buffer.from('FXENC1')

let directory: string
let file: string
let issues: string[]

function xor(bytes: Buffer): Buffer {
  return Buffer.from(bytes.map((byte) => byte ^ 0x5a))
}

/** 偽の safeStorage。呼ばれ方も数える。 */
function fakeCipher(
  overrides: Partial<AiProviderCredentialCipher> = {}
): AiProviderCredentialCipher {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((plain: string) => Buffer.concat([MARK, xor(Buffer.from(plain, 'utf8'))])),
    decryptString: vi.fn((encrypted: Buffer) => {
      if (!encrypted.subarray(0, MARK.length).equals(MARK)) {
        throw new Error(
          'Error while decrypting the ciphertext provided to safeStorage.decryptString.'
        )
      }

      return xor(encrypted.subarray(MARK.length)).toString('utf8')
    }),
    ...overrides
  }
}

function createStore(cipher: AiProviderCredentialCipher = fakeCipher()): AiProviderCredentialStore {
  return createAiProviderCredentialStore(directory, cipher, {
    onIssue: (message) => issues.push(message)
  })
}

function readStored(): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeStored(value: unknown): void {
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
}

/** ディスクに残ったものすべて（一時ファイルを含む）。 */
function everythingOnDisk(): string {
  return readdirSync(directory)
    .map((name) => readFileSync(join(directory, name), 'utf8'))
    .join('\n')
}

function peek(
  store: AiProviderCredentialStore,
  providerId: SupportedProviderId = 'openai'
): unknown {
  const used = store.withCredential(providerId, (apiKey) => apiKey)
  return used.ok ? used.value : used.failure
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fluvix-ai-credential-'))
  file = join(directory, AI_PROVIDER_CREDENTIALS_FILE_NAME)
  issues = []
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('safeStorage で暗号化して保存する', () => {
  it('暗号化・復号に成功すれば、設定済みになり、Main の中でだけ Key を使える', () => {
    const cipher = fakeCipher()
    const store = createStore(cipher)

    expect(store.getState('openai')).toBe('not-set')
    expect(store.setCredential('openai', CANARY)).toEqual({ ok: true })
    expect(cipher.encryptString).toHaveBeenCalledWith(CANARY)
    expect(store.getState('openai')).toBe('set')
    expect(store.getStatus('openai')).toEqual({
      providerId: 'openai',
      state: 'set',
      canStore: true
    })
    expect(peek(store)).toBe(CANARY)
    expect(cipher.decryptString).toHaveBeenCalled()
  })

  it('保存形式は版・Provider の識別子・暗号文（base64）だけ', () => {
    const store = createStore()

    store.setCredential('openai', CANARY)

    const stored = readStored() as { version: number; credentials: Record<string, string> }

    expect(Object.keys(stored).sort()).toEqual(['credentials', 'version'])
    expect(stored.version).toBe(1)
    expect(Object.keys(stored.credentials)).toEqual(['openai'])
    expect(stored.credentials.openai).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(Buffer.from(stored.credentials.openai, 'base64').subarray(0, MARK.length)).toEqual(MARK)
  })

  it('OS の暗号化が使えなければ、書かない（平文へ落ちない）', () => {
    const cipher = fakeCipher({ isEncryptionAvailable: vi.fn(() => false) })
    const store = createStore(cipher)

    expect(store.canStore()).toBe(false)
    expect(store.setCredential('openai', CANARY)).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
    expect(cipher.encryptString).not.toHaveBeenCalled()
    expect(readdirSync(directory)).toEqual([])
    expect(store.getStatus('openai')).toEqual({
      providerId: 'openai',
      state: 'not-set',
      canStore: false
    })
  })

  it('使えるかを尋ねるだけで投げる環境でも、使えないものとして断る', () => {
    const store = createStore(
      fakeCipher({
        isEncryptionAvailable: vi.fn(() => {
          throw new Error(`keyring locked ${CANARY}`)
        })
      })
    )

    expect(store.canStore()).toBe(false)
    expect(store.setCredential('openai', CANARY)).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
    expect(readdirSync(directory)).toEqual([])
    expect(issues.join('\n')).not.toContain(CANARY)
  })

  it('暗号化に失敗したら（投げる・空の暗号文）、書かない', () => {
    for (const encryptString of [
      vi.fn(() => {
        throw new Error(`encrypt failed for ${CANARY}`)
      }),
      vi.fn(() => Buffer.alloc(0)),
      vi.fn(() => CANARY as unknown as Buffer)
    ]) {
      const store = createStore(fakeCipher({ encryptString }))

      expect(store.setCredential('openai', CANARY)).toEqual({
        ok: false,
        failure: 'encryption-unavailable'
      })
      expect(readdirSync(directory)).toEqual([])
    }

    expect(issues.join('\n')).not.toContain(CANARY)
  })

  it('復号に失敗したら使えない（Key を渡さない・平文として読み直さない）', () => {
    createStore().setCredential('openai', CANARY)

    const store = createStore(
      fakeCipher({
        decryptString: vi.fn(() => {
          throw new Error('The ciphertext was produced on another machine.')
        })
      })
    )
    const use = vi.fn()

    expect(store.getState('openai')).toBe('unusable')
    expect(store.withCredential('openai', use)).toEqual({ ok: false, failure: 'unusable' })
    expect(use).not.toHaveBeenCalled()
  })

  it('復号できても Key の形でなければ使えない', () => {
    createStore().setCredential('openai', CANARY)

    for (const decrypted of ['', 'with space inside', 'x'.repeat(2000), 42]) {
      const store = createStore(fakeCipher({ decryptString: vi.fn(() => decrypted as string) }))

      expect(store.getState('openai')).toBe('unusable')
      expect(peek(store)).toBe('unusable')
    }
  })

  it('保存した後に OS の暗号化が使えなくなったら、使えない（暗号文を平文として扱わない）', () => {
    createStore().setCredential('openai', CANARY)

    const store = createStore(fakeCipher({ isEncryptionAvailable: vi.fn(() => false) }))

    expect(store.getStatus('openai')).toEqual({
      providerId: 'openai',
      state: 'unusable',
      canStore: false
    })
    expect(peek(store)).toBe('unusable')
  })
})

describe('設定・置き換え・削除・設定済みか', () => {
  it('置き換えると、前の Key は残らない', () => {
    const store = createStore()

    store.setCredential('openai', CANARY)
    const before = readFileSync(file, 'utf8')

    expect(store.setCredential('openai', REPLACED)).toEqual({ ok: true })
    expect(readFileSync(file, 'utf8')).not.toBe(before)
    expect(peek(store)).toBe(REPLACED)
  })

  it('削除するとファイルごと消え、未設定に戻る。無いものの削除も成功', () => {
    const store = createStore()

    store.setCredential('openai', CANARY)
    expect(store.deleteCredential('openai')).toEqual({ ok: true })
    expect(readdirSync(directory)).toEqual([])
    expect(store.getState('openai')).toBe('not-set')
    expect(peek(store)).toBe('not-set')
    expect(store.deleteCredential('openai')).toEqual({ ok: true })
  })

  it('前後の空白・改行は落とし、中に空白や制御文字がある値・空・長すぎる値・文字列でない値は保存しない', () => {
    const store = createStore()

    expect(store.setCredential('openai', `  ${CANARY}\r\n`)).toEqual({ ok: true })
    expect(peek(store)).toBe(CANARY)

    for (const invalid of [
      '',
      '   ',
      'sk-with space',
      'sk-with\ttab',
      'sk-\u0000null',
      'sk-全角',
      'x'.repeat(1025),
      undefined,
      null,
      42,
      { apiKey: CANARY },
      [CANARY]
    ]) {
      expect(store.setCredential('openai', invalid)).toEqual({
        ok: false,
        failure: 'value-invalid'
      })
    }

    // 通らなかった値で、保存済みの Key は変わらない。
    expect(peek(store)).toBe(CANARY)
  })

  it('読んだ内容を覚えない（外でファイルが消えれば、その場で未設定）', () => {
    const store = createStore()

    store.setCredential('openai', CANARY)
    rmSync(file)

    expect(store.getState('openai')).toBe('not-set')
    expect(peek(store)).toBe('not-set')
  })

  it('callback が投げたものはそのまま投げる（Store は中身を読まない）', () => {
    const store = createStore()

    store.setCredential('openai', CANARY)

    expect(() =>
      store.withCredential('openai', () => {
        throw new Error('adapter failed')
      })
    ).toThrow('adapter failed')
  })
})

describe('Provider の識別子（閉じた集合）', () => {
  it('openai だけを受け付け、それ以外（scripted を含む）は Fail Closed', () => {
    const store = createStore()

    for (const unknown of [
      'scripted',
      'fn-scripted-dev',
      'OpenAI',
      'anthropic',
      'gemini',
      '__proto__',
      'toString',
      '',
      '../settings'
    ]) {
      const id = unknown as SupportedProviderId

      expect(store.setCredential(id, CANARY)).toEqual({
        ok: false,
        failure: 'unsupported-provider'
      })
      expect(store.deleteCredential(id)).toEqual({ ok: false, failure: 'unsupported-provider' })
      expect(store.getState(id)).toBe('unusable')
      expect(store.withCredential(id, () => 'used')).toEqual({
        ok: false,
        failure: 'unsupported-provider'
      })
    }

    expect(readdirSync(directory)).toEqual([])
  })
})

describe('壊れた・書き換えられたファイルは使わない', () => {
  const valid = (): string => {
    createStore().setCredential('openai', CANARY)
    return (readStored() as { credentials: { openai: string } }).credentials.openai
  }

  const cases: ReadonlyArray<readonly [string, (encoded: string) => unknown]> = [
    ['JSON でない', () => '{ "version": 1, "credentials": '],
    ['object でない', () => '"plain"'],
    ['配列', () => []],
    ['版が無い', (encoded) => ({ credentials: { openai: encoded } })],
    ['知らない版', (encoded) => ({ version: 2, credentials: { openai: encoded } })],
    ['版が文字列', (encoded) => ({ version: '1', credentials: { openai: encoded } })],
    ['credentials が object でない', () => ({ version: 1, credentials: 'x' })],
    [
      '知らない Provider',
      (encoded) => ({ version: 1, credentials: { openai: encoded, evil: encoded } })
    ],
    ['scripted の Credential', (encoded) => ({ version: 1, credentials: { scripted: encoded } })],
    ['__proto__', (encoded) => `{"version":1,"credentials":{"__proto__":"${encoded}"}}`],
    ['暗号文が base64 でない', () => ({ version: 1, credentials: { openai: `${CANARY} !` } })],
    ['暗号文が空', () => ({ version: 1, credentials: { openai: '' } })],
    ['暗号文が文字列でない', () => ({ version: 1, credentials: { openai: { encrypted: 'x' } } })],
    ['暗号文が大きすぎる', () => ({ version: 1, credentials: { openai: 'A'.repeat(20_000) } })],
    ['平文の Key が書かれている', () => ({ version: 1, credentials: { openai: 'c2stcGxhaW4' } })]
  ]

  for (const [name, build] of cases) {
    it(`${name} → 使えない（Key を渡さない）`, () => {
      writeStored(build(valid()))

      const use = vi.fn()
      const store = createStore()

      expect(store.getState('openai')).toBe('unusable')
      expect(store.withCredential('openai', use).ok).toBe(false)
      expect(use).not.toHaveBeenCalled()
    })
  }

  it('新しい Key で置き換えると、壊れた中身を持ち越さずに作り直す', () => {
    writeStored({ version: 1, credentials: { openai: valid(), evil: 'QUFBQQ==' } })

    const store = createStore()

    expect(store.setCredential('openai', REPLACED)).toEqual({ ok: true })
    expect(Object.keys((readStored() as { credentials: object }).credentials)).toEqual(['openai'])
    expect(peek(store)).toBe(REPLACED)
  })

  it('削除すると、壊れたファイルごと消す', () => {
    writeStored('not json')

    const store = createStore()

    expect(store.deleteCredential('openai')).toEqual({ ok: true })
    expect(readdirSync(directory)).toEqual([])
    expect(store.getState('openai')).toBe('not-set')
  })
})

describe('Key を漏らさない', () => {
  it('ディスク（一時ファイルを含む）に平文の Key が無く、保存先のフォルダには1ファイルだけ', () => {
    const store = createStore()

    store.setCredential('openai', CANARY)
    store.setCredential('openai', REPLACED)

    expect(readdirSync(directory)).toEqual([AI_PROVIDER_CREDENTIALS_FILE_NAME])

    const disk = everythingOnDisk()

    for (const secret of [CANARY, REPLACED]) {
      expect(disk).not.toContain(secret)
      expect(disk).not.toContain(Buffer.from(secret).toString('base64'))
    }
  })

  it('知らせ（ログ）は固定の文言だけ。Error が Key を含んでいても運ばない', () => {
    const leaky = (): never => {
      throw new Error(`failure while handling ${CANARY}`)
    }

    createStore().setCredential('openai', CANARY)
    createStore(fakeCipher({ decryptString: leaky })).getState('openai')
    createStore(fakeCipher({ encryptString: leaky })).setCredential('openai', CANARY)
    createStore(fakeCipher({ isEncryptionAvailable: leaky })).setCredential('openai', CANARY)
    writeStored('{ broken')
    createStore().getState('openai')

    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      expect(issue).not.toContain(CANARY)
      expect(issue).toMatch(/^ai-provider-credentials\.json: [a-z ,'.]+$/i)
    }
  })

  it('戻り値・状態・Store の object のどこにも Key が残らない', () => {
    const store = createStore()
    const results = [
      store.setCredential('openai', CANARY),
      store.getState('openai'),
      store.getStatus('openai'),
      store.canStore(),
      store.withCredential('openai', () => 'used'),
      store.deleteCredential('openai'),
      store.setCredential('openai', `${CANARY} broken`)
    ]

    expect(JSON.stringify(results)).not.toContain(CANARY)
    expect(JSON.stringify(Object.entries(store))).not.toContain(CANARY)
    expect(Object.keys(store).sort()).toEqual([
      'canStore',
      'deleteCredential',
      'getState',
      'getStatus',
      'setCredential',
      'withCredential'
    ])
  })
})
