import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_NOTION_SECRET_KEY, removeLegacyNotionSecret } from './mcpLegacyNotionCleanup'
import { createMcpSecretStore, MCP_SECRETS_FILE_NAME, type McpSecretCipher } from './mcpSecretStore'

/**
 * 旧 Notion MCP の token の掃除（mcpLegacyNotionCleanup.ts）。
 *
 * 実際のディスクで確かめる。一番大事なのは、**登録したサーバーの秘密の値
 * （GitHub の `GITHUB_PERSONAL_ACCESS_TOKEN` など）を1つも壊さないこと**。
 * 暗号文はどれも架空の文字列で、この処理は復号しない。
 */

const GITHUB_KEY = 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e:env:GITHUB_PERSONAL_ACCESS_TOKEN'
const OTHER_KEY = 'custom-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d:env:EXAMPLE_API_KEY'

let directory: string

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'fx-mcp-legacy-')))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function writeSecrets(content: unknown): Promise<void> {
  await writeFile(
    join(directory, MCP_SECRETS_FILE_NAME),
    typeof content === 'string' ? content : JSON.stringify(content)
  )
}

async function readSecrets(): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, MCP_SECRETS_FILE_NAME), 'utf8')) as unknown
}

describe('removeLegacyNotionSecret', () => {
  it('notion の token だけを消し、登録したサーバーの秘密の値はそのまま残す', async () => {
    await writeSecrets({
      version: 1,
      secrets: {
        [LEGACY_NOTION_SECRET_KEY]: 'bm90aW9uLWNpcGhlcg==',
        [GITHUB_KEY]: 'Z2l0aHViLWNpcGhlcg==',
        [OTHER_KEY]: 'b3RoZXItY2lwaGVy'
      }
    })

    expect(removeLegacyNotionSecret(directory)).toBe('removed')
    expect(await readSecrets()).toEqual({
      version: 1,
      secrets: { [GITHUB_KEY]: 'Z2l0aHViLWNpcGhlcg==', [OTHER_KEY]: 'b3RoZXItY2lwaGVy' }
    })
  })

  it('何度呼んでも同じ（2回目からは何も書かない）', async () => {
    await writeSecrets({
      version: 1,
      secrets: { [LEGACY_NOTION_SECRET_KEY]: 'bm90aW9u', [GITHUB_KEY]: 'Z2l0aHVi' }
    })

    expect(removeLegacyNotionSecret(directory)).toBe('removed')
    const afterFirst = await readFile(join(directory, MCP_SECRETS_FILE_NAME), 'utf8')

    expect(removeLegacyNotionSecret(directory)).toBe('none')
    expect(removeLegacyNotionSecret(directory)).toBe('none')
    expect(await readFile(join(directory, MCP_SECRETS_FILE_NAME), 'utf8')).toBe(afterFirst)
  })

  it('notion の token しか無ければ、ファイルごと消す', async () => {
    await writeSecrets({ version: 1, secrets: { [LEGACY_NOTION_SECRET_KEY]: 'bm90aW9u' } })

    expect(removeLegacyNotionSecret(directory)).toBe('removed')
    expect(await readdir(directory)).toEqual([])
  })

  it('notion の token が無ければ、ファイルに触れない', async () => {
    const content = JSON.stringify({ version: 1, secrets: { [GITHUB_KEY]: 'Z2l0aHVi' } })
    await writeSecrets(content)

    expect(removeLegacyNotionSecret(directory)).toBe('none')
    expect(await readFile(join(directory, MCP_SECRETS_FILE_NAME), 'utf8')).toBe(content)
  })

  it('ファイルが無ければ何もしない（作らない）', async () => {
    expect(removeLegacyNotionSecret(directory)).toBe('none')
    expect(await readdir(directory)).toEqual([])
  })

  it('壊れた JSON・知らない版には触れない（壊さない）', async () => {
    for (const content of [
      '{',
      '[]',
      'null',
      JSON.stringify({
        version: 99,
        secrets: { [LEGACY_NOTION_SECRET_KEY]: 'x', [GITHUB_KEY]: 'y' }
      }),
      JSON.stringify({ version: 1, secrets: null })
    ]) {
      await writeSecrets(content)

      expect(removeLegacyNotionSecret(directory)).toBe('none')
      expect(await readFile(join(directory, MCP_SECRETS_FILE_NAME), 'utf8')).toBe(content)
    }
  })

  it('掃除した後も、登録したサーバーの秘密の値を保存先から読み戻せる', async () => {
    const cipher: McpSecretCipher = {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(`sealed:${plain}`, 'utf8'),
      decryptString: (encrypted) => encrypted.toString('utf8').slice('sealed:'.length)
    }
    const store = createMcpSecretStore(directory, cipher)
    const server = 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'

    store.replaceVariables(
      server,
      new Map([['GITHUB_PERSONAL_ACCESS_TOKEN', 'ghp_fictitiousTestSecret0123456789']])
    )

    // 旧版が同じファイルへ書いていた token を足した状態を作る。
    const current = (await readSecrets()) as { version: number; secrets: Record<string, string> }
    await writeSecrets({
      ...current,
      secrets: { ...current.secrets, [LEGACY_NOTION_SECRET_KEY]: 'bm90aW9u' }
    })

    expect(removeLegacyNotionSecret(directory)).toBe('removed')
    expect(store.readVariable(server, 'GITHUB_PERSONAL_ACCESS_TOKEN')).toBe(
      'ghp_fictitiousTestSecret0123456789'
    )
  })
})
