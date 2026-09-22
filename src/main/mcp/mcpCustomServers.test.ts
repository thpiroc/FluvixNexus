import { mkdtemp, readFile, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { McpCustomServerId } from '@shared/mcp'
import { MCP_CUSTOM_SERVERS_MAX } from '@shared/mcp/customServers'
import { createMcpCustomServerStore, MCP_SERVERS_FILE_NAME } from './mcpCustomServerStore'
import { createMcpCustomServers, type McpCustomServers } from './mcpCustomServers'
import { createMcpSecretStore, MCP_SECRETS_FILE_NAME, type McpSecretCipher } from './mcpSecretStore'

/**
 * 利用者が足したサーバーの一覧・保存・削除・切り替え（mcpCustomServers.ts。§21.3）。
 *
 * 登録簿と秘密の保存先は本物（一時フォルダ）を使う ── 確かめたいのは
 * 「秘密の値が mcp-servers.json に入らない」「一覧に秘密の値が載らない」
 * のような、2つのファイルにまたがる性質だから。秘密の値はすべて架空。
 */

const SECRET = 'fictitious-secret-value-0123456789'
const CIPHER_PREFIX = 'sealed:'

let directory: string
let ids: McpCustomServerId[]
let changed: McpCustomServerId[]

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'fx-mcp-custom-')))
  ids = []
  changed = []
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function cipher(available = true): McpSecretCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`${CIPHER_PREFIX}${plain}`, 'utf8'),
    decryptString: (encrypted) => encrypted.toString('utf8').slice(CIPHER_PREFIX.length)
  }
}

function manager(options: { readonly encryption?: boolean } = {}): McpCustomServers {
  let counter = 0

  return createMcpCustomServers({
    store: createMcpCustomServerStore(directory),
    secrets: createMcpSecretStore(directory, cipher(options.encryption ?? true)),
    newId: () => {
      counter += 1
      const id = `custom-0f1e2d3c-4b5a-4968-8778-${String(counter).padStart(12, '0')}` as const
      ids.push(id)
      return id
    },
    onChanged: (id) => changed.push(id)
  })
}

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Example',
    enabled: true,
    transport: { kind: 'stdio', command: 'npx', args: ['-y', '@example/mcp-server'] },
    env: [
      { name: 'EXAMPLE_REGION', secret: false, value: 'ap-northeast-1' },
      { name: 'EXAMPLE_API_KEY', secret: true, value: SECRET }
    ],
    ...overrides
  }
}

async function readText(name: string): Promise<string> {
  return readFile(join(directory, name), 'utf8')
}

describe('保存', () => {
  it('新規は Main が id を作り、秘密の値は保存されているかだけを返す', () => {
    const servers = manager()
    const saved = servers.save(null, draft())

    expect(saved).toEqual({
      ok: true,
      server: {
        id: ids[0],
        name: 'Example',
        enabled: true,
        transport: { kind: 'stdio', command: 'npx', args: ['-y', '@example/mcp-server'] },
        env: [
          { name: 'EXAMPLE_REGION', secret: false, value: 'ap-northeast-1' },
          { name: 'EXAMPLE_API_KEY', secret: true, stored: true }
        ]
      }
    })
    expect(changed).toEqual([ids[0]])
  })

  it('秘密の値は mcp-servers.json にも一覧にも現れず、mcp-secrets.json に平文でない形で入る', async () => {
    const servers = manager()
    servers.save(null, draft())

    expect(await readText(MCP_SERVERS_FILE_NAME)).not.toContain(SECRET)
    expect(await readText(MCP_SECRETS_FILE_NAME)).not.toContain(SECRET)
    expect(JSON.stringify(servers.list())).not.toContain(SECRET)
  })

  it('秘密の値を入れ直さない編集（null）は、保存されている値を残す', () => {
    const servers = manager()
    const first = servers.save(null, draft())
    const id = first.ok ? first.server.id : null

    const edited = servers.save(
      id,
      draft({
        name: 'Renamed',
        env: [{ name: 'EXAMPLE_API_KEY', secret: true, value: null }]
      })
    )

    expect(edited).toMatchObject({
      ok: true,
      server: { name: 'Renamed', env: [{ name: 'EXAMPLE_API_KEY', secret: true, stored: true }] }
    })
    expect(servers.definitionOf(id as McpCustomServerId)?.environment()).toEqual({
      reservedVariables: ['EXAMPLE_API_KEY'],
      providedVariables: { EXAMPLE_API_KEY: SECRET }
    })
  })

  it('新しい秘密の変数に値が無ければ、どの欄かを返して断る', () => {
    expect(
      manager().save(
        null,
        draft({
          env: [
            { name: 'A', secret: false, value: '' },
            { name: 'B', secret: true, value: null }
          ]
        })
      )
    ).toEqual({ ok: false, failure: 'invalid', field: 'env', reason: 'secret-required', index: 1 })
  })

  it('秘密の変数の名前を変えたら、値を入れ直すまで保存しない（前の名前の値は流用しない）', () => {
    const servers = manager()
    const first = servers.save(null, draft())
    const id = first.ok ? first.server.id : null

    expect(
      servers.save(id, draft({ env: [{ name: 'RENAMED_KEY', secret: true, value: null }] }))
    ).toMatchObject({ ok: false, reason: 'secret-required' })
  })

  it('秘密をやめた変数の暗号文は消える', () => {
    const servers = manager()
    const first = servers.save(null, draft())
    const id = first.ok ? first.server.id : null

    servers.save(id, draft({ env: [{ name: 'EXAMPLE_API_KEY', secret: false, value: 'public' }] }))

    expect(servers.list().servers[0]?.env).toEqual([
      { name: 'EXAMPLE_API_KEY', secret: false, value: 'public' }
    ])
  })

  it('形の通らない下書きは、書かずに理由を返す', () => {
    const servers = manager()

    expect(
      servers.save(null, draft({ transport: { kind: 'stdio', command: 'npx -y x', args: [] } }))
    ).toEqual({
      ok: false,
      failure: 'invalid',
      field: 'command',
      reason: 'command-has-arguments',
      index: null
    })
    expect(servers.list().servers).toEqual([])
  })

  it('名前は大文字小文字を区別せずに重ならない', () => {
    const servers = manager()
    servers.save(null, draft())

    expect(servers.save(null, draft({ name: 'EXAMPLE' }))).toMatchObject({
      ok: false,
      field: 'name',
      reason: 'duplicate-name'
    })
  })

  it('消されたサーバーの編集は not-found', () => {
    expect(manager().save('custom-0f1e2d3c-4b5a-4968-8778-999999999999', draft())).toEqual({
      ok: false,
      failure: 'not-found'
    })
  })

  it('数の上限に達したら新規は断る', () => {
    const servers = manager()

    for (let index = 0; index < MCP_CUSTOM_SERVERS_MAX; index += 1) {
      servers.save(null, draft({ name: `Server ${index}`, env: [] }))
    }

    expect(servers.save(null, draft({ name: 'One more', env: [] }))).toEqual({
      ok: false,
      failure: 'limit-reached'
    })
  })

  it('暗号化できない PC では、秘密の値のあるサーバーを保存しない', () => {
    const servers = manager({ encryption: false })

    expect(servers.save(null, draft())).toEqual({ ok: false, failure: 'encryption-unavailable' })
    expect(servers.list()).toEqual({ servers: [], canStoreSecrets: false })
  })

  it('暗号化できない PC でも、秘密の値の無いサーバーは保存できる', () => {
    const servers = manager({ encryption: false })

    expect(
      servers.save(null, draft({ env: [{ name: 'A', secret: false, value: 'x' }] }))
    ).toMatchObject({ ok: true })
  })
})

describe('削除と切り替え', () => {
  it('消すと、秘密の値も一緒に消える', async () => {
    const servers = manager()
    const first = servers.save(null, draft())
    const id = first.ok ? first.server.id : ('' as McpCustomServerId)

    expect(servers.remove(id)).toEqual({ servers: [], canStoreSecrets: true })
    expect(servers.has(id)).toBe(false)
    expect(servers.definitionOf(id)).toBeNull()
    await expect(readText(MCP_SECRETS_FILE_NAME)).rejects.toThrow()
    expect(changed).toEqual([id, id])
  })

  it('無い id の削除・切り替えは null（Renderer の不具合）', () => {
    const servers = manager()
    const missing = 'custom-0f1e2d3c-4b5a-4968-8778-999999999999'

    expect(servers.remove(missing)).toBeNull()
    expect(servers.setEnabled(missing, true)).toBeNull()
  })

  it('有効 / 無効を切り替える（秘密の値には触れない）', () => {
    const servers = manager()
    const first = servers.save(null, draft({ enabled: false }))
    const id = first.ok ? first.server.id : ('' as McpCustomServerId)

    expect(servers.isEnabled(id)).toBe(false)
    expect(servers.setEnabled(id, true)?.servers[0]).toMatchObject({
      enabled: true,
      env: [{}, { stored: true }]
    })
    expect(servers.isEnabled(id)).toBe(true)
  })
})

describe('表の行', () => {
  it('Command と引数を配列のまま、利用者が決めた変数だけを渡す行になる', () => {
    const servers = manager()
    const first = servers.save(null, draft())
    const definition = servers.definitionOf(first.ok ? first.server.id : ids[0]!)

    expect(definition).toMatchObject({
      launch: {
        kind: 'user-command',
        name: 'Example',
        command: 'npx',
        args: ['-y', '@example/mcp-server']
      },
      operations: {},
      configProblems: [],
      redactions: [SECRET]
    })
    expect(definition?.environment()).toEqual({
      reservedVariables: ['EXAMPLE_REGION', 'EXAMPLE_API_KEY'],
      providedVariables: { EXAMPLE_REGION: 'ap-northeast-1', EXAMPLE_API_KEY: SECRET }
    })
  })

  it('秘密の値が読めない（他の PC から持ってきた等）なら secret-missing', () => {
    const first = manager().save(null, draft())
    const id = first.ok ? first.server.id : ids[0]!
    // 暗号化が使えない状態で読むと、保存済みの暗号文も読み出さない。
    const elsewhere = manager({ encryption: false })

    expect(elsewhere.definitionOf(id)).toMatchObject({ configProblems: ['secret-missing'] })
  })
})
