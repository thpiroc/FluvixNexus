import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectMcpClient, type McpTransportClose } from './mcpClient'
import type { McpServerCommand } from './mcpServerLaunch'
import { createMcpStdioTransport } from './mcpStdioTransport'

/**
 * 子プロセスとしての経路（mcpStdioTransport.ts）。
 *
 * 本物の node で小さな MCP サーバーを立てて確かめる ── 起動・行の受け渡し・
 * stdin を閉じたときの終わり方・終わらないサーバーの kill は、偽の経路では
 * 確かめようがない。
 */

let directory = ''

/** stdin の各行に答え、stdin が閉じたら終わる、行儀のよいサーバー。 */
const POLITE_SERVER = `
const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin })
process.stderr.write('polite server started\\n')
rl.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '0.0.1' } } }) + '\\n')
  } else if (message.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
      tools: [{ name: 'echo', description: '日本語の説明' }] } }) + '\\n')
  }
})
rl.on('close', () => process.exit(0))
`

/** stdin が閉じても終わらないサーバー（kill が要る）。 */
const STUBBORN_SERVER = `
process.stdin.resume()
process.stdin.on('end', () => {})
setInterval(() => {}, 1000)
`

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'fluvix-mcp-transport-'))
  writeFileSync(join(directory, 'polite.cjs'), POLITE_SERVER)
  writeFileSync(join(directory, 'stubborn.cjs'), STUBBORN_SERVER)
})

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

function nodeCommand(script: string): McpServerCommand {
  return {
    name: 'fixture',
    file: process.execPath,
    args: [join(directory, script)]
  }
}

describe('createMcpStdioTransport', () => {
  it('本物の子プロセスと接続・一覧・切断ができ、stdin を閉じると終わる', async () => {
    const stderr: string[] = []
    const closes: McpTransportClose[] = []
    const transport = createMcpStdioTransport({
      command: nodeCommand('polite.cjs'),
      env: { ...process.env },
      cwd: directory,
      onStderrLine: (line) => stderr.push(line)
    })

    transport.onClose((close) => closes.push(close))

    const connected = await connectMcpClient(transport, {
      clientInfo: { name: 'Fluvix Nexus', version: '1.0.0' }
    })

    if (!connected.ok) {
      throw new Error(`should connect: ${connected.failure} ${connected.detail}`)
    }

    expect(connected.client.serverInfo).toEqual({ name: 'fixture', version: '0.0.1' })
    expect(await connected.client.listTools()).toEqual({
      ok: true,
      tools: [{ name: 'echo', description: '日本語の説明' }]
    })

    await connected.client.close()

    expect(closes).toEqual([{ kind: 'exited', detail: 'exited with code 0.' }])
    expect(stderr).toContain('polite server started')
  })

  it('stdin を閉じても終わらないサーバーは kill する', async () => {
    const closes: McpTransportClose[] = []
    const transport = createMcpStdioTransport({
      command: nodeCommand('stubborn.cjs'),
      env: { ...process.env },
      cwd: directory,
      closeGraceMs: 200
    })

    transport.onClose((close) => closes.push(close))

    // 起動し終わるのを少し待ってから閉じる（起動前の kill は別の経路になる）。
    await new Promise((resolve) => setTimeout(resolve, 300))
    await transport.close()

    expect(closes).toHaveLength(1)
    expect(closes[0]?.kind).toBe('exited')
  })

  it('terminate は待たずに終わらせる', async () => {
    const closes: McpTransportClose[] = []
    const transport = createMcpStdioTransport({
      command: nodeCommand('stubborn.cjs'),
      env: { ...process.env },
      cwd: directory
    })

    transport.onClose((close) => closes.push(close))
    await new Promise((resolve) => setTimeout(resolve, 300))

    transport.terminate()
    await transport.close()

    expect(closes[0]?.kind).toBe('exited')
  })

  it('実行ファイルが無ければ spawn-failed', async () => {
    const transport = createMcpStdioTransport({
      command: {
        name: 'missing',
        file: join(directory, 'no-such-node.exe'),
        args: []
      },
      env: { ...process.env },
      cwd: directory
    })

    const connected = await connectMcpClient(transport, {
      clientInfo: { name: 'Fluvix Nexus', version: '1.0.0' },
      connectTimeoutMs: 5_000
    })

    expect(connected).toMatchObject({ ok: false, failure: 'spawn-failed' })
  })
})
