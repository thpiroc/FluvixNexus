import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpSecretStore, MCP_SECRETS_FILE_NAME, type McpSecretCipher } from './mcpSecretStore'

/**
 * 登録したサーバーの秘密の環境変数の保存（mcpSecretStore.ts）。
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
 * 値はすべて架空のもの。暗号化そのもの（DPAPI）はここでは試さない
 * ── 試せるのは「渡された道具を使うか・使えないときにどうするか」になる。
 */

/* 見た目で平文と区別が付く、可逆な置き換え。本物の safeStorage の代わり。 */
const CIPHER_PREFIX = 'sealed:'

const SERVER = 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'
const OTHER = 'custom-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'
const NAME = 'GITHUB_PERSONAL_ACCESS_TOKEN'
const VALUE = 'ghp_fictitiousTestSecret0123456789'

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

    expect(store.readVariable(SERVER, NAME)).toBeNull()
    expect(store.hasVariable(SERVER, NAME)).toBe(false)
    expect(await readdir(directory)).toEqual([])
  })

  it('保存して読み戻せる。名前は大文字小文字を区別しない', () => {
    const store = storeWith()

    expect(
      store.replaceVariables(SERVER, new Map([['Github_Personal_Access_Token', VALUE]]))
    ).toEqual({ ok: true })
    expect(store.readVariable(SERVER, NAME)).toBe(VALUE)
    expect(store.hasVariable(SERVER, NAME.toLowerCase())).toBe(true)
  })

  it('settings.json ではない専用のファイルへ、平文でない形で入る', async () => {
    storeWith().replaceVariables(SERVER, new Map([[NAME, VALUE]]))

    expect(await readdir(directory)).toEqual([MCP_SECRETS_FILE_NAME])

    const text = await readSecretsFile()

    /* ファイルのどこにも値の文字が現れない。 */
    expect(text).not.toContain(VALUE)
    expect(JSON.parse(text)).toEqual({
      version: 1,
      secrets: { [`${SERVER}:env:${NAME}`]: expect.any(String) }
    })
  })

  it('空白や記号を含む値もそのまま読み戻せる（前後の空白だけは落とす）', () => {
    const store = storeWith()
    const value = 'fictitious secret with spaces {"a": 1}'

    store.replaceVariables(SERVER, new Map([['KEY', `  ${value}\n`]]))

    expect(store.readVariable(SERVER, 'KEY')).toBe(value)
  })

  it('入れ直すと置き換わる', () => {
    const store = storeWith()
    const next = 'ghp_fictitiousSecondSecret9876543210'

    store.replaceVariables(SERVER, new Map([[NAME, VALUE]]))
    store.replaceVariables(SERVER, new Map([[NAME, next]]))

    expect(store.readVariable(SERVER, NAME)).toBe(next)
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

  it('サーバーごとに分かれていて、互いに消し合わない', () => {
    const store = storeWith()

    store.replaceVariables(SERVER, new Map([['KEY', VALUE]]))
    store.replaceVariables(OTHER, new Map([['KEY', 'other']]))

    expect(store.readVariable(SERVER, 'KEY')).toBe(VALUE)
    expect(store.readVariable(OTHER, 'KEY')).toBe('other')

    expect(store.clearVariables(SERVER)).toBe(true)
    expect(store.readVariable(SERVER, 'KEY')).toBeNull()
    expect(store.readVariable(OTHER, 'KEY')).toBe('other')
  })

  it('秘密の変数が1つも無ければ、ファイルを作らない', async () => {
    expect(storeWith().replaceVariables(SERVER, new Map())).toEqual({ ok: true })
    expect(await readdir(directory)).toEqual([])
  })
})

describe('断る場合', () => {
  /* ここが一番大事 ── 断ったときに平文が残ってはいけない。 */
  it('暗号化できない PC では保存せず、ファイルも作らない', async () => {
    const store = storeWith({ available: false })

    expect(store.replaceVariables(SERVER, new Map([[NAME, VALUE]]))).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
    expect(await readdir(directory)).toEqual([])
    expect(store.canStore()).toBe(false)
  })

  it('暗号化の呼び出しが投げても、保存せずに断る', async () => {
    const store = storeWith({ encryptThrows: true })

    expect(store.replaceVariables(SERVER, new Map([[NAME, VALUE]]))).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
    expect(await readdir(directory)).toEqual([])
  })

  it('改行などを含む値は保存しない', async () => {
    const store = storeWith()

    for (const broken of ['', '   ', 'a\nb', 'a\u0016pasted']) {
      expect(store.replaceVariables(SERVER, new Map([['KEY', broken]]))).toEqual({
        ok: false,
        failure: 'value-invalid'
      })
    }

    expect(await readdir(directory)).toEqual([])
  })

  it('資格情報に届かない（投げる）ときは、使えないものとして扱う', () => {
    const store = storeWith({ availableThrows: true })

    expect(store.canStore()).toBe(false)
    expect(store.replaceVariables(SERVER, new Map([[NAME, VALUE]]))).toEqual({
      ok: false,
      failure: 'encryption-unavailable'
    })
  })
})

describe('読めないファイル', () => {
  it('復号できなければ null（落ちない）', () => {
    storeWith().replaceVariables(SERVER, new Map([[NAME, VALUE]]))

    /* 他の PC・他のアカウントからファイルを持ってきた状態。 */
    const store = storeWith({ decryptThrows: true })

    expect(store.readVariable(SERVER, NAME)).toBeNull()
    /* 「入っていること」自体は分かる（入れ直せばよい、と画面が言えるように）。 */
    expect(store.hasVariable(SERVER, NAME)).toBe(true)
  })

  it('復号できても形が通らなければ渡さない', async () => {
    await writeFile(
      join(directory, MCP_SECRETS_FILE_NAME),
      JSON.stringify({
        version: 1,
        secrets: {
          [`${SERVER}:env:KEY`]: Buffer.from(`${CIPHER_PREFIX}a\nb`, 'utf8').toString('base64')
        }
      })
    )

    expect(storeWith().readVariable(SERVER, 'KEY')).toBeNull()
  })

  it('壊れた JSON・知らない版は「無い」として扱う', async () => {
    for (const content of [
      '{',
      '[]',
      'null',
      JSON.stringify({ version: 99, secrets: { [`${SERVER}:env:KEY`]: 'x' } })
    ]) {
      await writeFile(join(directory, MCP_SECRETS_FILE_NAME), content)

      expect(storeWith().readVariable(SERVER, 'KEY')).toBeNull()
      expect(storeWith().hasVariable(SERVER, 'KEY')).toBe(false)
    }
  })

  it('暗号化が使えない状態では、保存済みでも読み出さない', () => {
    storeWith().replaceVariables(SERVER, new Map([[NAME, VALUE]]))

    expect(storeWith({ available: false }).readVariable(SERVER, NAME)).toBeNull()
  })
})

describe('消す', () => {
  it('最後の1つを消すと、ファイルごと無くなる', async () => {
    const store = storeWith()

    store.replaceVariables(SERVER, new Map([[NAME, VALUE]]))
    expect(store.clearVariables(SERVER)).toBe(true)

    expect(store.readVariable(SERVER, NAME)).toBeNull()
    expect(await readdir(directory)).toEqual([])
  })

  it('無いものを消しても成功（押した結果は同じ「無い」）', () => {
    expect(storeWith().clearVariables(SERVER)).toBe(true)
  })

  it('並びから外した名前だけが消え、ほかの値は残る', () => {
    const store = storeWith()

    store.replaceVariables(
      SERVER,
      new Map([
        ['A', 'a-value'],
        ['B', 'b-value']
      ])
    )
    store.replaceVariables(SERVER, new Map([['A', null]]))

    expect(store.readVariable(SERVER, 'A')).toBe('a-value')
    expect(store.readVariable(SERVER, 'B')).toBeNull()
  })
})
