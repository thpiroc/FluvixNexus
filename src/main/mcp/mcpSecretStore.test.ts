import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpSecretStore, MCP_SECRETS_FILE_NAME, type McpSecretCipher } from './mcpSecretStore'

/**
 * token の保存（mcpSecretStore.ts）。
 *
 * settingsStore.test.ts と同じく**実際のディスクを触る側の例外**にあたる。
 * 確かめたいのは、
 *
 *   - `settings.json` ではない別のファイルに、**平文でない形**で入ること
 *   - 暗号化できない PC では**書かない**こと（平文へ落ちない）
 *   - 他の PC から持ってきたファイル（復号できない）で落ちないこと
 *   - 消したら、ファイルごと残らないこと
 *
 * であり、どれも写しのファイルシステムでは確かめられない。
 *
 * token はすべて架空の値。暗号化そのもの（DPAPI）はここでは試さない
 * ── 試せるのは「渡された道具を使うか・使えないときにどうするか」になる。
 */

/* 見た目で平文と区別が付く、可逆な置き換え。本物の safeStorage の代わり。 */
const CIPHER_PREFIX = 'sealed:'

const TOKEN = 'ntn_fictitiousTestToken0123456789'

let directory: string

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'fx-mcp-secrets-')))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

interface CipherOptions {
  readonly available?: boolean
  /** 復号できない（他の PC で作られた暗号文）。 */
  readonly decryptThrows?: boolean
  readonly encryptThrows?: boolean
  readonly availableThrows?: boolean
}

function cipherWith(options: CipherOptions = {}): McpSecretCipher {
  return {
    isEncryptionAvailable: () => {
      if (options.availableThrows === true) {
        throw new Error('no credential service')
      }

      return options.available ?? true
    },
    encryptString: (plainText) => {
      if (options.encryptThrows === true) {
        throw new Error('could not encrypt')
      }

      return Buffer.from(`${CIPHER_PREFIX}${plainText}`, 'utf8')
    },
    decryptString: (encrypted) => {
      if (options.decryptThrows === true) {
        throw new Error('could not decrypt')
      }

      const text = encrypted.toString('utf8')

      if (!text.startsWith(CIPHER_PREFIX)) {
        throw new Error('not sealed here')
      }

      return text.slice(CIPHER_PREFIX.length)
    }
  }
}

function storeWith(options: CipherOptions = {}): ReturnType<typeof createMcpSecretStore> {
  return createMcpSecretStore(directory, cipherWith(options))
}

async function readSecretsFile(): Promise<string> {
  return readFile(join(directory, MCP_SECRETS_FILE_NAME), 'utf8')
}

describe('保存と読み出し', () => {
  it('保存が無ければ null で、ファイルも作らない', async () => {
    const store = storeWith()

    expect(store.read('notion')).toBeNull()
    expect(store.has('notion')).toBe(false)
    expect(await readdir(directory)).toEqual([])
  })

  it('保存した token を読み戻せる', () => {
    const store = storeWith()

    expect(store.write('notion', TOKEN)).toEqual({ ok: true })
    expect(store.has('notion')).toBe(true)
    expect(store.read('notion')).toBe(TOKEN)
  })

  it('token は settings.json ではない専用のファイルへ、平文でない形で入る', async () => {
    storeWith().write('notion', TOKEN)

    expect(await readdir(directory)).toEqual([MCP_SECRETS_FILE_NAME])

    const text = await readSecretsFile()

    /* ファイルのどこにも token の文字が現れない。 */
    expect(text).not.toContain(TOKEN)
    expect(JSON.parse(text)).toEqual({
      version: 1,
      secrets: { notion: expect.any(String) }
    })
  })

  it('前後の空白は落として保存する', () => {
    const store = storeWith()

    store.write('notion', `  ${TOKEN}\n`)

    expect(store.read('notion')).toBe(TOKEN)
  })

  it('入れ直すと置き換わる', () => {
    const store = storeWith()
    const next = 'ntn_fictitiousSecondToken9876543210'

    store.write('notion', TOKEN)
    store.write('notion', next)

    expect(store.read('notion')).toBe(next)
  })
})

describe('断る場合', () => {
  /* ここが一番大事 ── 断ったときに平文が残ってはいけない。 */
  it('暗号化できない PC では保存せず、ファイルも作らない', async () => {
    const store = storeWith({ available: false })

    expect(store.write('notion', TOKEN)).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
    expect(await readdir(directory)).toEqual([])
    expect(store.canStore()).toBe(false)
  })

  it('暗号化の呼び出しが投げても、保存せずに断る', async () => {
    const store = storeWith({ encryptThrows: true })

    expect(store.write('notion', TOKEN)).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
    expect(await readdir(directory)).toEqual([])
  })

  it('形の通らない token は保存しない', async () => {
    const store = storeWith()

    for (const broken of ['', '   ', 'ntn_ has space', 'ntn_\u0016pasted', 'ntn_全角']) {
      expect(store.write('notion', broken)).toEqual({ ok: false, failure: 'token-invalid' })
    }

    expect(await readdir(directory)).toEqual([])
  })

  it('資格情報に届かない（投げる）ときは、使えないものとして扱う', () => {
    const store = storeWith({ availableThrows: true })

    expect(store.canStore()).toBe(false)
    expect(store.write('notion', TOKEN)).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
  })
})

describe('読めないファイル', () => {
  it('復号できなければ null（落ちない）', () => {
    storeWith().write('notion', TOKEN)

    /* 他の PC・他のアカウントからファイルを持ってきた状態。 */
    const store = storeWith({ decryptThrows: true })

    expect(store.read('notion')).toBeNull()
    /* 「入っていること」自体は分かる（入れ直せばよい、と画面が言えるように）。 */
    expect(store.has('notion')).toBe(true)
  })

  it('復号できても形が通らなければ渡さない', async () => {
    await writeFile(
      join(directory, MCP_SECRETS_FILE_NAME),
      JSON.stringify({
        version: 1,
        secrets: { notion: Buffer.from(`${CIPHER_PREFIX}has space`, 'utf8').toString('base64') }
      })
    )

    expect(storeWith().read('notion')).toBeNull()
  })

  it('壊れた JSON・知らない版は「無い」として扱う', async () => {
    for (const content of [
      '{',
      '[]',
      'null',
      JSON.stringify({ version: 99, secrets: { notion: 'x' } })
    ]) {
      await writeFile(join(directory, MCP_SECRETS_FILE_NAME), content)

      expect(storeWith().read('notion')).toBeNull()
      expect(storeWith().has('notion')).toBe(false)
    }
  })

  it('暗号化が使えない状態では、保存済みでも読み出さない', () => {
    storeWith().write('notion', TOKEN)

    expect(storeWith({ available: false }).read('notion')).toBeNull()
  })
})

describe('消す', () => {
  it('消すと、最後の1つならファイルごと無くなる', async () => {
    const store = storeWith()

    store.write('notion', TOKEN)
    expect(store.clear('notion')).toBe(true)

    expect(store.read('notion')).toBeNull()
    expect(store.has('notion')).toBe(false)
    expect(await readdir(directory)).toEqual([])
  })

  it('無いものを消しても成功（押した結果は同じ「無い」）', () => {
    expect(storeWith().clear('notion')).toBe(true)
  })
})

describe('利用者が足したサーバーの、秘密の環境変数（§21.10）', () => {
  const SERVER = 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'
  const OTHER = 'custom-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'
  const VALUE = 'fictitious secret with spaces {"a": 1}'

  it('保存して読み戻せる。名前は大文字小文字を区別しない', async () => {
    const store = storeWith()

    expect(store.replaceVariables(SERVER, new Map([['Example_Key', VALUE]]))).toEqual({ ok: true })
    expect(store.readVariable(SERVER, 'EXAMPLE_KEY')).toBe(VALUE)
    expect(store.hasVariable(SERVER, 'example_key')).toBe(true)
    expect(await readSecretsFile()).not.toContain(VALUE)
  })

  it('組み込みの token と同じファイルに入り、互いに消し合わない', () => {
    const store = storeWith()

    store.write('notion', TOKEN)
    store.replaceVariables(SERVER, new Map([['KEY', VALUE]]))
    store.replaceVariables(OTHER, new Map([['KEY', 'other']]))

    expect(store.read('notion')).toBe(TOKEN)
    expect(store.read(SERVER)).toBeNull()
    expect(store.readVariable(OTHER, 'KEY')).toBe('other')

    expect(store.clearVariables(SERVER)).toBe(true)
    expect(store.readVariable(SERVER, 'KEY')).toBeNull()
    expect(store.read('notion')).toBe(TOKEN)
    expect(store.readVariable(OTHER, 'KEY')).toBe('other')
  })

  it('null は今の暗号文を残し、並びに無い名前は消す', () => {
    const store = storeWith()

    store.replaceVariables(
      SERVER,
      new Map([
        ['KEEP', VALUE],
        ['DROP', 'dropped']
      ])
    )
    expect(store.replaceVariables(SERVER, new Map([['KEEP', null]]))).toEqual({ ok: true })

    expect(store.readVariable(SERVER, 'KEEP')).toBe(VALUE)
    expect(store.hasVariable(SERVER, 'DROP')).toBe(false)
  })

  it('暗号化できない PC では、新しい値を書かない（平文へ落ちない）', async () => {
    const store = storeWith({ available: false })

    expect(store.replaceVariables(SERVER, new Map([['KEY', VALUE]]))).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
    expect(await readdir(directory)).toEqual([])
  })

  it('秘密の変数が1つも無ければ、ファイルを作らない', async () => {
    expect(storeWith().replaceVariables(SERVER, new Map())).toEqual({ ok: true })
    expect(await readdir(directory)).toEqual([])
  })

  it('改行を含む値は断る', () => {
    expect(storeWith().replaceVariables(SERVER, new Map([['KEY', 'a\nb']]))).toEqual({
      ok: false,
      failure: 'token-invalid'
    })
  })

  it('他の PC から持ってきた暗号文は、無いものとして読む', () => {
    storeWith().replaceVariables(SERVER, new Map([['KEY', VALUE]]))

    expect(storeWith({ decryptThrows: true }).readVariable(SERVER, 'KEY')).toBeNull()
  })

  it('最後の1つを消すと、ファイルごと無くなる', async () => {
    const store = storeWith()

    store.replaceVariables(SERVER, new Map([['KEY', VALUE]]))
    store.clearVariables(SERVER)

    expect(await readdir(directory)).toEqual([])
  })
})

/*
  「保存 → 環境変数」の順序はこの module の持ち物ではない
  （mcpConnections.ts の `resolveSecret`）。順序そのものを確かめるのは
  mcpConnections.test.ts の「token の在り処」にあたる ── 2箇所で同じ順序を
  試すと、片方だけ直したときに両方が緑のまま食い違う。
*/
