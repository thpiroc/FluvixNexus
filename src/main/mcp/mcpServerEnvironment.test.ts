import { describe, expect, it } from 'vitest'
import { createMcpServerEnvironment, MCP_SERVER_BASE_VARIABLES } from './mcpServerEnvironment'

/**
 * MCP サーバーへ渡す環境変数の共通の規則（mcpServerEnvironment.ts）。
 *
 * どのサーバーでも同じに効くことを、架空のサーバーの宣言で確かめる
 * （登録したサーバーの宣言は mcpServerDefinition.test.ts）。
 */

const SECRET = 'fictitious-secret-value'

const PROFILE = {
  reservedVariables: ['EXAMPLE_TOKEN', 'EXAMPLE_ENDPOINT'],
  providedVariables: { EXAMPLE_TOKEN: SECRET }
}

/** 利用者の PC にありそうな環境（秘密情報を含む。値はすべて架空）。 */
const USER_ENV = {
  Path: 'C:\\Windows\\System32;C:\\Program Files\\nodejs',
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\dev',
  APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
  TEMP: 'C:\\Users\\dev\\AppData\\Local\\Temp',
  HTTPS_PROXY: 'http://proxy.example:8080',
  no_proxy: 'localhost',
  NODE_EXTRA_CA_CERTS: 'C:\\certs\\corp.pem',
  // 渡してはいけないもの
  GITHUB_TOKEN: 'ghp_fictitious',
  OPENAI_API_KEY: 'sk-fictitious',
  ANTHROPIC_API_KEY: 'sk-ant-fictitious',
  AWS_SECRET_ACCESS_KEY: 'fictitious',
  NPM_TOKEN: 'fictitious',
  FLUVIX_NOTION_MCP_TOKEN: 'ntn_fictitious',
  FLUVIX_NOTION_TOKEN: 'ntn_fictitious_feedback',
  ELECTRON_RUN_AS_NODE: '1',
  NODE_OPTIONS: '--require C:\\evil.js',
  BASE_URL: 'https://example.invalid/',
  EXAMPLE_TOKEN: 'someone-elses-value',
  example_endpoint: 'https://attacker.invalid'
}

describe('createMcpServerEnvironment', () => {
  it('許可リストにある変数と、表が渡す値だけになる', () => {
    expect(createMcpServerEnvironment(USER_ENV, PROFILE)).toEqual({
      Path: USER_ENV.Path,
      SystemRoot: USER_ENV.SystemRoot,
      USERPROFILE: USER_ENV.USERPROFILE,
      APPDATA: USER_ENV.APPDATA,
      TEMP: USER_ENV.TEMP,
      HTTPS_PROXY: USER_ENV.HTTPS_PROXY,
      no_proxy: USER_ENV.no_proxy,
      NODE_EXTRA_CA_CERTS: USER_ENV.NODE_EXTRA_CA_CERTS,
      EXAMPLE_TOKEN: SECRET
    })
  })

  it('ほかの秘密情報（GitHub・AI サービス・クラウド・npm・このアプリ）は渡さない', () => {
    const env = createMcpServerEnvironment(USER_ENV, PROFILE)
    const values = Object.values(env).join('\n')

    for (const name of [
      'GITHUB_TOKEN',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'NPM_TOKEN',
      'FLUVIX_NOTION_MCP_TOKEN',
      'FLUVIX_NOTION_TOKEN'
    ]) {
      expect(env).not.toHaveProperty(name)
    }

    expect(values).not.toContain('fictitious_feedback')
    expect(values).not.toContain('ghp_')
  })

  it('Electron の都合で立っている変数と、許可していない BASE_URL は渡さない', () => {
    const env = createMcpServerEnvironment(USER_ENV, PROFILE)

    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(env).not.toHaveProperty('NODE_OPTIONS')
    expect(env).not.toHaveProperty('BASE_URL')
  })

  it('サーバーが読む設定の変数は、親の値を通さず表の値だけにする（綴り違いも）', () => {
    const env = createMcpServerEnvironment(USER_ENV, {
      ...PROFILE,
      // 共通の許可にあっても、設定として読む名前なら親の値は通さない。
      reservedVariables: [...PROFILE.reservedVariables, 'HTTPS_PROXY']
    })

    expect(env['EXAMPLE_TOKEN']).toBe(SECRET)
    expect(env).not.toHaveProperty('example_endpoint')
    expect(env).not.toHaveProperty('HTTPS_PROXY')
  })

  it('サーバーごとの許可で、共通の許可に無い変数を1つずつ足せる', () => {
    const env = createMcpServerEnvironment(
      { ...USER_ENV, JAVA_HOME: 'C:\\java' },
      { ...PROFILE, inheritedVariables: ['JAVA_HOME'] }
    )

    expect(env['JAVA_HOME']).toBe('C:\\java')
    expect(env).not.toHaveProperty('GITHUB_TOKEN')
  })

  it('サーバーごとの許可に FLUVIX_ の変数や設定の変数は書けない（表の書き間違い）', () => {
    expect(() =>
      createMcpServerEnvironment(USER_ENV, {
        ...PROFILE,
        inheritedVariables: ['FLUVIX_NOTION_TOKEN']
      })
    ).toThrow('cannot be inherited')
    expect(() =>
      createMcpServerEnvironment(USER_ENV, { ...PROFILE, inheritedVariables: ['example_token'] })
    ).toThrow('cannot be inherited')
  })

  it('起動のしかたの変数（ELECTRON_RUN_AS_NODE）は最後に足す', () => {
    const env = createMcpServerEnvironment(USER_ENV, PROFILE, { ELECTRON_RUN_AS_NODE: '1' })

    expect(env['ELECTRON_RUN_AS_NODE']).toBe('1')
    expect(env).not.toHaveProperty('NODE_OPTIONS')
  })

  it('起動のしかたの変数が設定の変数とぶつかったら断る', () => {
    expect(() => createMcpServerEnvironment(USER_ENV, PROFILE, { EXAMPLE_TOKEN: 'x' })).toThrow(
      'collides'
    )
  })

  it('宣言していない変数に値を渡そうとしたら断り、文に値を含めない', () => {
    let message = ''

    try {
      createMcpServerEnvironment(
        {},
        { reservedVariables: [], providedVariables: { EXAMPLE_TOKEN: SECRET } }
      )
    } catch (cause) {
      message = String(cause)
    }

    expect(message).toContain('provided without being reserved')
    expect(message).not.toContain(SECRET)
  })

  it('共通の許可リストに秘密情報らしい名前・このアプリの名前が無い', () => {
    for (const name of MCP_SERVER_BASE_VARIABLES) {
      expect(name).not.toMatch(/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|^FLUVIX_|^NODE_OPTIONS$/)
    }
  })

  it('親の環境を書き換えない', () => {
    const copy = { ...USER_ENV }

    createMcpServerEnvironment(USER_ENV, PROFILE, { ELECTRON_RUN_AS_NODE: '1' })

    expect(USER_ENV).toEqual(copy)
  })
})
