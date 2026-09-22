import { describe, expect, it } from 'vitest'
import type { McpCustomServerSummary } from '@shared/mcp/customServers'
import {
  describeInvalid,
  draftFromFormState,
  formatCommandLine,
  formStateFromServer,
  keepsStoredSecret,
  parseArgsText
} from './mcpCustomServerDraft'

/**
 * 「+ New MCP Server」の入力欄と、保存の要求の形との行き来（mcpCustomServerDraft.ts。§21.6）。
 */

const SERVER: McpCustomServerSummary = {
  id: 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e',
  name: 'Example',
  enabled: true,
  transport: { kind: 'stdio', command: 'npx', args: ['-y', 'C:\\My Files'] },
  env: [
    { name: 'EXAMPLE_REGION', secret: false, value: 'ap-northeast-1' },
    { name: 'EXAMPLE_API_KEY', secret: true, stored: true }
  ]
}

describe('parseArgsText', () => {
  it('1行を1つの引数にし、行の中の空白では区切らない', () => {
    expect(parseArgsText('-y\r\n@example/server\n  C:\\My Files  \n\n')).toEqual([
      '-y',
      '@example/server',
      'C:\\My Files'
    ])
  })
})

describe('formStateFromServer', () => {
  it('新規は「使う」を切った空の欄（MCP 全体の元栓と同じく既定は無効）', () => {
    expect(formStateFromServer(null)).toEqual({
      name: '',
      transportKind: 'stdio',
      command: '',
      argsText: '',
      enabled: false,
      env: []
    })
  })

  it('編集では秘密の値の欄を空にし、保存済みだった名前を覚える', () => {
    const state = formStateFromServer(SERVER)

    expect(state.argsText).toBe('-y\nC:\\My Files')
    expect(
      state.env.map(({ name, value, secret, storedSecretName }) => ({
        name,
        value,
        secret,
        storedSecretName
      }))
    ).toEqual([
      { name: 'EXAMPLE_REGION', value: 'ap-northeast-1', secret: false, storedSecretName: null },
      { name: 'EXAMPLE_API_KEY', value: '', secret: true, storedSecretName: 'EXAMPLE_API_KEY' }
    ])
  })
})

describe('draftFromFormState', () => {
  it('秘密の欄を空のまま保存すると「今のまま」（null）を送る', () => {
    expect(draftFromFormState(formStateFromServer(SERVER))).toEqual({
      name: 'Example',
      enabled: true,
      transport: { kind: 'stdio', command: 'npx', args: ['-y', 'C:\\My Files'] },
      env: [
        { name: 'EXAMPLE_REGION', secret: false, value: 'ap-northeast-1' },
        { name: 'EXAMPLE_API_KEY', secret: true, value: null }
      ]
    })
  })

  it('入れ直した値・名前を変えた行・新しい行は、欄の値をそのまま送る', () => {
    const state = formStateFromServer(SERVER)
    const [region, key] = state.env

    const draft = draftFromFormState({
      ...state,
      env: [
        { ...region!, name: 'RENAMED' },
        { ...key!, name: 'OTHER_KEY' }
      ]
    }) as { env: unknown[] }

    // 名前を変えた秘密の行は、前の名前の値を流用しない（空のまま送って Main が断る）。
    expect(draft.env).toEqual([
      { name: 'RENAMED', secret: false, value: 'ap-northeast-1' },
      { name: 'OTHER_KEY', secret: true, value: '' }
    ])
  })
})

describe('keepsStoredSecret', () => {
  const row = {
    key: 'k',
    name: 'KEY',
    value: '',
    secret: true,
    storedSecretName: 'KEY'
  }

  it('秘密のまま・同じ名前（大文字小文字は問わない）・空の欄のときだけ', () => {
    expect(keepsStoredSecret(row)).toBe(true)
    expect(keepsStoredSecret({ ...row, name: 'key' })).toBe(true)
    expect(keepsStoredSecret({ ...row, value: 'new' })).toBe(false)
    expect(keepsStoredSecret({ ...row, secret: false })).toBe(false)
    expect(keepsStoredSecret({ ...row, storedSecretName: null })).toBe(false)
  })
})

describe('formatCommandLine', () => {
  it('空白を含む引数だけを " で囲んで見せる', () => {
    expect(formatCommandLine(SERVER.transport)).toBe('npx -y "C:\\My Files"')
  })
})

describe('describeInvalid', () => {
  it('欄と理由の言葉の key、何番目か（1 始まり）を返す', () => {
    expect(describeInvalid({ field: 'env', reason: 'reserved-name', index: 0 })).toEqual({
      fieldKey: 'settings.mcp.custom.fields.env',
      reasonKey: 'settings.mcp.custom.invalid.reservedName',
      position: 1
    })
    expect(describeInvalid({ field: 'command', reason: 'required', index: null })).toMatchObject({
      position: null
    })
  })
})
