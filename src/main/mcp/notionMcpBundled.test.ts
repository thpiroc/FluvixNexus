import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { connectMcpClient } from './mcpClient'
import {
  createMcpServerEnvironment,
  MCP_SERVER_DEFINITIONS,
  resolveMcpServerCommand
} from './mcpServerCatalog'
import { createMcpStdioTransport } from './mcpStdioTransport'

/**
 * 同梱する Notion MCP サーバー（node_modules の実物・2.5.1）を、表の定義どおりに起動する。
 *
 * Notion へは接続しない ── initialize と tools/list は API を呼ばないので、
 * 架空の token のままで通る。確かめたいのは2つ。
 *
 *   - 表の起動のしかた（入口・引数・許可リストの環境）で、実物が立って話せること
 *   - 操作表（notionMcpOperations.ts）が使うツールが、実物にすべてあること
 *     ── 版を上げたときに名前が消えていれば、ここで落ちる
 */

const TOKEN = 'ntn_fictitiousTestToken0123456789'

describe('bundled Notion MCP server', () => {
  it('表のとおりに起動し、操作表が使うツールをすべて公開している', async () => {
    const resolved = resolveMcpServerCommand('notion', {
      platform: process.platform === 'win32' ? 'win32' : 'linux',
      env: process.env,
      exists: existsSync,
      // 開発時の置き場所（mcpService.ts と同じ）。
      bundledPackageDirectory: (launch) =>
        join(resolve('node_modules'), ...launch.packageName.split('/')),
      // テストは素の Node で動いているので、それをそのまま使う。
      nodeRuntime: { file: process.execPath, environment: {} }
    })

    if (!resolved.ok) {
      throw new Error(`the bundled server was not found: ${resolved.problem}`)
    }

    const transport = createMcpStdioTransport({
      command: resolved.command,
      env: createMcpServerEnvironment('notion', process.env, TOKEN, resolved.command.environment),
      cwd: resolve('.')
    })
    const connected = await connectMcpClient(transport, {
      clientInfo: { name: 'Fluvix Nexus', version: '0.0.0-test' }
    })

    if (!connected.ok) {
      throw new Error(`could not connect: ${connected.failure} ${connected.detail}`)
    }

    try {
      const listed = await connected.client.listTools()

      if (!listed.ok) {
        throw new Error(`could not list tools: ${listed.failure}`)
      }

      const names = listed.tools.map((tool) => tool.name)

      for (const operation of Object.values(MCP_SERVER_DEFINITIONS.notion.operations)) {
        expect(names).toContain(operation.tool)
      }
    } finally {
      await connected.client.close()
    }
  })
})
