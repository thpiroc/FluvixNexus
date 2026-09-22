import { describe, expect, it } from 'vitest'
import {
  MCP_CUSTOM_SERVER_ARGS_MAX,
  MCP_CUSTOM_SERVER_ENV_MAX,
  MCP_CUSTOM_SERVER_NAME_MAX_LENGTH,
  isReservedMcpEnvName,
  validateMcpCustomServerDraft
} from './customServers'
import { isMcpConnectionId, isMcpCustomServerId } from './index'

/**
 * 利用者が足す MCP サーバーの下書きの検証（shared/mcp/customServers.ts。§21.10）。
 *
 * 秘密の値はすべて架空のもの。
 */

const SECRET = 'fictitious-secret-value-0123456789'

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Example MCP',
    enabled: true,
    transport: { kind: 'stdio', command: 'npx', args: ['-y', '@example/mcp-server'] },
    env: [],
    ...overrides
  }
}

function stdio(command: unknown, args: unknown = []): Record<string, unknown> {
  return { transport: { kind: 'stdio', command, args } }
}

describe('id の形', () => {
  it('custom- ＋ UUID だけを利用者が足したサーバーの id と見なす', () => {
    expect(isMcpCustomServerId('custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e')).toBe(true)
    expect(isMcpCustomServerId('custom-notion')).toBe(false)
    expect(isMcpCustomServerId('custom-0F1E2D3C-4B5A-4968-8778-695A4B3C2D1E')).toBe(false)
    expect(isMcpCustomServerId('notion')).toBe(false)
    expect(isMcpCustomServerId(42)).toBe(false)
  })

  it('接続の id は組み込みか、利用者が足したものの形', () => {
    expect(isMcpConnectionId('notion')).toBe(true)
    expect(isMcpConnectionId('custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e')).toBe(true)
    expect(isMcpConnectionId('github')).toBe(false)
  })
})

describe('validateMcpCustomServerDraft', () => {
  it('Command と引数を分けたまま受け付ける', () => {
    expect(validateMcpCustomServerDraft(draft())).toEqual({
      ok: true,
      draft: {
        name: 'Example MCP',
        enabled: true,
        transport: { kind: 'stdio', command: 'npx', args: ['-y', '@example/mcp-server'] },
        env: []
      }
    })
  })

  it('名前と Command の前後の空白、Command を囲む " を落とす', () => {
    const checked = validateMcpCustomServerDraft(
      draft({
        name: '  Example  ',
        ...stdio('  "C:\\Program Files\\Example\\server.exe"  ')
      })
    )

    expect(checked).toMatchObject({
      ok: true,
      draft: {
        name: 'Example',
        transport: { command: 'C:\\Program Files\\Example\\server.exe' }
      }
    })
  })

  it('引数は空白を含んでもそのまま（1つの文字列へ繋いで読み直さない）', () => {
    const args = ['--root', 'C:\\Users\\dev\\My Projects', '', 'a&b|c']

    expect(validateMcpCustomServerDraft(draft(stdio('server', args)))).toMatchObject({
      ok: true,
      draft: { transport: { args } }
    })
  })

  it('名前が空・長すぎる・改行を含むなら断る', () => {
    expect(validateMcpCustomServerDraft(draft({ name: '   ' }))).toMatchObject({
      ok: false,
      field: 'name',
      reason: 'required'
    })
    expect(
      validateMcpCustomServerDraft(
        draft({ name: 'x'.repeat(MCP_CUSTOM_SERVER_NAME_MAX_LENGTH + 1) })
      )
    ).toMatchObject({ ok: false, field: 'name', reason: 'too-long' })
    expect(validateMcpCustomServerDraft(draft({ name: 'a\nb' }))).toMatchObject({
      ok: false,
      field: 'name',
      reason: 'control-character'
    })
  })

  it('PATH で探す名前に空白があれば、引数を1欄に書いた形として断る', () => {
    expect(validateMcpCustomServerDraft(draft(stdio('npx -y @example/mcp-server')))).toMatchObject({
      ok: false,
      field: 'command',
      reason: 'command-has-arguments'
    })
  })

  it('相対パス・途中の " は断る', () => {
    expect(validateMcpCustomServerDraft(draft(stdio('.\\server.exe')))).toMatchObject({
      ok: false,
      field: 'command',
      reason: 'invalid-command'
    })
    expect(validateMcpCustomServerDraft(draft(stdio('bin/server')))).toMatchObject({
      ok: false,
      field: 'command',
      reason: 'invalid-command'
    })
    expect(validateMcpCustomServerDraft(draft(stdio('C:\\a"b.exe')))).toMatchObject({
      ok: false,
      field: 'command',
      reason: 'invalid-command'
    })
  })

  it('Command が空なら断る', () => {
    expect(validateMcpCustomServerDraft(draft(stdio('  ')))).toMatchObject({
      ok: false,
      field: 'command',
      reason: 'required'
    })
  })

  it('引数の型・数・制御文字を確かめ、何番目かを返す', () => {
    expect(validateMcpCustomServerDraft(draft(stdio('server', 'a b')))).toMatchObject({
      ok: false,
      field: 'args',
      reason: 'invalid-shape'
    })
    expect(validateMcpCustomServerDraft(draft(stdio('server', ['ok', 3])))).toMatchObject({
      ok: false,
      field: 'args',
      reason: 'invalid-shape',
      index: 1
    })
    expect(validateMcpCustomServerDraft(draft(stdio('server', ['ok', 'a\u0000b'])))).toMatchObject({
      ok: false,
      field: 'args',
      reason: 'control-character',
      index: 1
    })
    expect(
      validateMcpCustomServerDraft(
        draft(
          stdio(
            'server',
            Array.from({ length: MCP_CUSTOM_SERVER_ARGS_MAX + 1 }, () => 'x')
          )
        )
      )
    ).toMatchObject({ ok: false, field: 'args', reason: 'too-many' })
  })

  it('知らない接続方式は断る（HTTP はまだ無い）', () => {
    expect(
      validateMcpCustomServerDraft(
        draft({ transport: { kind: 'http', url: 'https://example.com' } })
      )
    ).toMatchObject({ ok: false, field: 'transport', reason: 'unsupported-transport' })
  })

  it('有効 / 無効は真偽値だけ', () => {
    expect(validateMcpCustomServerDraft(draft({ enabled: 'yes' }))).toMatchObject({
      ok: false,
      field: 'enabled',
      reason: 'invalid-shape'
    })
  })

  it('下書きそのものが object でなければ断る', () => {
    expect(validateMcpCustomServerDraft(null)).toMatchObject({ ok: false, field: 'server' })
  })
})

describe('環境変数', () => {
  it('秘密でない値・秘密の値・秘密の「今のまま」（null）を受け付ける', () => {
    const checked = validateMcpCustomServerDraft(
      draft({
        env: [
          { name: 'EXAMPLE_REGION', secret: false, value: '' },
          { name: 'EXAMPLE_API_KEY', secret: true, value: `  ${SECRET}\n` },
          { name: 'EXAMPLE_OTHER_KEY', secret: true, value: null }
        ]
      })
    )

    expect(checked).toMatchObject({
      ok: true,
      draft: {
        env: [
          { name: 'EXAMPLE_REGION', secret: false, value: '' },
          // 貼り付けで付いてくる前後の空白・改行は落とす。
          { name: 'EXAMPLE_API_KEY', secret: true, value: SECRET },
          { name: 'EXAMPLE_OTHER_KEY', secret: true, value: null }
        ]
      }
    })
  })

  it('名前の形・重なり（大文字小文字を区別しない）を確かめる', () => {
    expect(
      validateMcpCustomServerDraft(draft({ env: [{ name: '1ABC', secret: false, value: 'x' }] }))
    ).toMatchObject({ ok: false, field: 'env', reason: 'invalid-name', index: 0 })
    expect(
      validateMcpCustomServerDraft(
        draft({
          env: [
            { name: 'Api_Key', secret: false, value: 'x' },
            { name: 'API_KEY', secret: true, value: SECRET }
          ]
        })
      )
    ).toMatchObject({ ok: false, field: 'env', reason: 'duplicate-name', index: 1 })
  })

  it('このアプリが決める変数は、大文字小文字に依らず断る', () => {
    for (const name of ['PATH', 'Path', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ComSpec']) {
      expect(
        validateMcpCustomServerDraft(draft({ env: [{ name, secret: false, value: 'x' }] }))
      ).toMatchObject({ ok: false, field: 'env', reason: 'reserved-name', index: 0 })
    }

    expect(isReservedMcpEnvName('fluvix_notion_mcp_token')).toBe(true)
    expect(isReservedMcpEnvName('GITHUB_TOKEN')).toBe(false)
  })

  it('秘密の値が空白だけなら secret-required、改行を含めば control-character', () => {
    expect(
      validateMcpCustomServerDraft(draft({ env: [{ name: 'KEY', secret: true, value: '   ' }] }))
    ).toMatchObject({ ok: false, field: 'env', reason: 'secret-required', index: 0 })
    expect(
      validateMcpCustomServerDraft(draft({ env: [{ name: 'KEY', secret: true, value: 'a\nb' }] }))
    ).toMatchObject({ ok: false, field: 'env', reason: 'control-character', index: 0 })
  })

  it('秘密でない値は null を許さない（「今のまま」は秘密の値だけ）', () => {
    expect(
      validateMcpCustomServerDraft(draft({ env: [{ name: 'KEY', secret: false, value: null }] }))
    ).toMatchObject({ ok: false, field: 'env', reason: 'invalid-shape', index: 0 })
  })

  it('数の上限を超えたら断る', () => {
    const env = Array.from({ length: MCP_CUSTOM_SERVER_ENV_MAX + 1 }, (_, index) => ({
      name: `KEY_${index}`,
      secret: false,
      value: 'x'
    }))

    expect(validateMcpCustomServerDraft(draft({ env }))).toMatchObject({
      ok: false,
      field: 'env',
      reason: 'too-many'
    })
  })

  it('失敗の結果に秘密の値は含まれない', () => {
    const checked = validateMcpCustomServerDraft(
      draft({
        env: [
          { name: 'KEY', secret: true, value: SECRET },
          { name: 'key', secret: true, value: SECRET }
        ]
      })
    )

    expect(checked.ok).toBe(false)
    expect(JSON.stringify(checked)).not.toContain(SECRET)
  })
})
