import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { McpStoredCustomServer } from '@shared/mcp/customServers'
import {
  createMcpCustomServerStore,
  MCP_SERVERS_FILE_NAME,
  parseMcpStoredCustomServer
} from './mcpCustomServerStore'

/**
 * MCP Server Manager の登録簿（mcpCustomServerStore.ts。§21.3）。
 *
 * mcpSecretStore.test.ts と同じく実際のディスクを触る。確かめたいのは、
 *
 *   - `settings.json` ではない専用のファイルに入ること
 *   - 手で書き換えられた行を、保存するときと同じ規則で1件ずつ落とすこと
 *   - 読めないファイル・知らない版を、空で上書きしないこと
 */

const ID_A = 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'
const ID_B = 'custom-1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'

const SERVER_A: McpStoredCustomServer = {
  id: ID_A,
  name: 'Example A',
  enabled: true,
  transport: { kind: 'stdio', command: 'npx', args: ['-y', '@example/mcp-server'] },
  env: [
    { name: 'EXAMPLE_REGION', secret: false, value: 'ap-northeast-1' },
    { name: 'EXAMPLE_API_KEY', secret: true }
  ]
}

const SERVER_B: McpStoredCustomServer = {
  id: ID_B,
  name: 'Example B',
  enabled: false,
  transport: { kind: 'stdio', command: 'C:\\tools\\server.exe', args: [] },
  env: []
}

let directory: string
let issues: string[]

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'fx-mcp-servers-')))
  issues = []
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function store(): ReturnType<typeof createMcpCustomServerStore> {
  return createMcpCustomServerStore(directory, { onIssue: (message) => issues.push(message) })
}

async function writeRaw(value: unknown): Promise<void> {
  await writeFile(join(directory, MCP_SERVERS_FILE_NAME), JSON.stringify(value), 'utf8')
}

describe('保存と読み出し', () => {
  it('何も無ければ空で、ファイルも作らない', async () => {
    expect(store().list()).toEqual([])
    expect(await readdir(directory)).toEqual([])
  })

  it('足した順に読み戻せる。専用のファイルに入り、秘密の値の欄は無い', async () => {
    const servers = store()

    expect(servers.put(SERVER_A)).toBe(true)
    expect(servers.put(SERVER_B)).toBe(true)
    expect(servers.list()).toEqual([SERVER_A, SERVER_B])
    expect(servers.get(ID_B)).toEqual(SERVER_B)

    expect(await readdir(directory)).toEqual([MCP_SERVERS_FILE_NAME])

    const saved = JSON.parse(await readFile(join(directory, MCP_SERVERS_FILE_NAME), 'utf8'))
    expect(saved.version).toBe(1)
    expect(saved.servers[0].env[1]).toEqual({ name: 'EXAMPLE_API_KEY', secret: true })
  })

  it('同じ id は、その位置で置き換える', () => {
    const servers = store()
    servers.put(SERVER_A)
    servers.put(SERVER_B)
    servers.put({ ...SERVER_A, name: 'Renamed' })

    expect(servers.list().map((server) => server.name)).toEqual(['Renamed', 'Example B'])
  })

  it('消す。無い id を消すのは成功として扱う', () => {
    const servers = store()
    servers.put(SERVER_A)
    servers.put(SERVER_B)

    expect(servers.remove(ID_A)).toBe(true)
    expect(servers.list()).toEqual([SERVER_B])
    expect(servers.remove(ID_A)).toBe(true)
  })
})

describe('手で書き換えられたファイル', () => {
  it('読めない行だけを落とし、ほかの行は残す', async () => {
    await writeRaw({
      version: 1,
      servers: [
        SERVER_A,
        { ...SERVER_B, transport: { kind: 'stdio', command: 'npx -y pkg', args: [] } },
        { ...SERVER_B, id: 'custom-not-a-uuid' },
        { ...SERVER_B, env: [{ name: 'PATH', secret: false, value: 'C:\\evil' }] }
      ]
    })

    expect(store().list()).toEqual([SERVER_A])
    expect(issues).toEqual([`${MCP_SERVERS_FILE_NAME}: ignored 3 unreadable server(s).`])
  })

  it('id が重なったら先の行だけを残す', async () => {
    await writeRaw({ version: 1, servers: [SERVER_A, { ...SERVER_A, name: 'Copy' }] })

    expect(store().list()).toEqual([SERVER_A])
  })

  it('有効 / 無効が真偽値でなければ無効として読む', () => {
    expect(parseMcpStoredCustomServer({ ...SERVER_A, enabled: 'true' })).toMatchObject({
      enabled: false
    })
  })

  it('秘密の変数に値が書き込まれていても、読むのは「秘密である」ことだけ', () => {
    expect(
      parseMcpStoredCustomServer({
        ...SERVER_A,
        env: [{ name: 'EXAMPLE_API_KEY', secret: true, value: 'plain-text-in-file' }]
      })
    ).toMatchObject({ env: [{ name: 'EXAMPLE_API_KEY', secret: true }] })
    expect(
      JSON.stringify(
        parseMcpStoredCustomServer({
          ...SERVER_A,
          env: [{ name: 'EXAMPLE_API_KEY', secret: true, value: 'plain-text-in-file' }]
        })
      )
    ).not.toContain('plain-text-in-file')
  })

  it('JSON として読めなければ空として扱い、上書きもしない', async () => {
    await writeFile(join(directory, MCP_SERVERS_FILE_NAME), '{ broken', 'utf8')
    const servers = store()

    expect(servers.list()).toEqual([])
    expect(servers.put(SERVER_A)).toBe(false)
    expect(await readFile(join(directory, MCP_SERVERS_FILE_NAME), 'utf8')).toBe('{ broken')
  })

  it('知らない版は空として扱い、上書きもしない（新しい版が書いたファイルを塗りつぶさない）', async () => {
    await writeRaw({ version: 2, servers: [SERVER_A] })
    const servers = store()

    expect(servers.list()).toEqual([])
    expect(servers.put(SERVER_B)).toBe(false)
    expect(JSON.parse(await readFile(join(directory, MCP_SERVERS_FILE_NAME), 'utf8')).version).toBe(
      2
    )
  })
})
