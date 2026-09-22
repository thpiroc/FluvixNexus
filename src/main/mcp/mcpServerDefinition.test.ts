import { describe, expect, it } from 'vitest'
import { createMcpCustomServerDefinition } from './mcpCustomServerDefinition'
import { createMcpServerEnvironment, resolveMcpServerCommand } from './mcpServerDefinition'

/**
 * MCP サーバーの定義（mcpServerDefinition.ts）と、登録簿の行から定義を作る側
 * （mcpCustomServerDefinition.ts）。
 *
 * 確かめたいのは「登録したサーバーへ何が渡るか」── 親（このアプリ）の環境から
 * 通るのは共通の許可だけで、このアプリ自身の設定（`FLUVIX_*`）も、利用者が
 * 別の用途で置いた秘密情報も渡らないこと。値はすべて架空のもの。
 */

const SECRET = 'ghp_fictitiousTestSecret0123456789'
const SERVER_EXE = 'C:\\tools\\example-server.exe'

function definitionWith(
  secret: string | null = SECRET
): ReturnType<typeof createMcpCustomServerDefinition> {
  return createMcpCustomServerDefinition(
    {
      id: 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e',
      name: 'GitHub',
      enabled: true,
      transport: { kind: 'stdio', command: SERVER_EXE, args: ['stdio'] },
      env: [
        { name: 'GITHUB_TOOLSETS', secret: false, value: 'repos,issues' },
        { name: 'GITHUB_PERSONAL_ACCESS_TOKEN', secret: true }
      ]
    },
    () => secret
  )
}

describe('createMcpServerEnvironment（登録したサーバー）', () => {
  const parent = {
    Path: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\dev',
    ELECTRON_RUN_AS_NODE: '1',
    node_options: '--inspect',
    BASE_URL: 'https://example.invalid/',
    // 旧 Notion MCP・フィードバックの設定。どちらもこのアプリのもので、どのサーバーにも渡さない。
    FLUVIX_NOTION_MCP_TOKEN: 'ntn_fictitiousLegacyValue',
    FLUVIX_NOTION_TOKEN: 'ntn_feedbackValue',
    FLUVIX_NOTION_DATABASE_ID: '0123456789abcdef0123456789abcdef',
    GITHUB_TOKEN: 'ghp_parentValue',
    GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_parentPersonalValue',
    OPENAI_API_KEY: 'sk-fictitious'
  }

  it('許可した OS の変数と、登録した変数だけを渡す', () => {
    expect(createMcpServerEnvironment(definitionWith(), parent)).toEqual({
      Path: parent.Path,
      SystemRoot: parent.SystemRoot,
      USERPROFILE: parent.USERPROFILE,
      GITHUB_TOOLSETS: 'repos,issues',
      GITHUB_PERSONAL_ACCESS_TOKEN: SECRET
    })
  })

  it('登録した名前は、親の値ではなく登録した値になる', () => {
    expect(createMcpServerEnvironment(definitionWith(), parent)).toMatchObject({
      GITHUB_PERSONAL_ACCESS_TOKEN: SECRET
    })
  })

  it('FLUVIX_ の変数・親の秘密情報・BASE_URL は渡さない', () => {
    const env = createMcpServerEnvironment(definitionWith(), parent)

    for (const name of [
      'FLUVIX_NOTION_MCP_TOKEN',
      'FLUVIX_NOTION_TOKEN',
      'FLUVIX_NOTION_DATABASE_ID',
      'GITHUB_TOKEN',
      'OPENAI_API_KEY',
      'BASE_URL',
      'ELECTRON_RUN_AS_NODE',
      'node_options'
    ]) {
      expect(env).not.toHaveProperty(name)
    }
  })

  it('秘密の値が読めなければ、その変数は渡さず secret-missing を持つ', () => {
    const definition = definitionWith(null)

    expect(definition.configProblems).toEqual(['secret-missing'])
    expect(createMcpServerEnvironment(definition, parent)).not.toHaveProperty(
      'GITHUB_PERSONAL_ACCESS_TOKEN'
    )
  })

  it('秘密の値はログで伏せる値として持つ（秘密でない値は持たない）', () => {
    expect(definitionWith().redactions).toEqual([SECRET])
  })

  it('操作表を持たない（ツールを呼ぶ許可は、登録しただけでは与えない）', () => {
    expect(definitionWith().operations).toEqual({})
  })

  it('親の環境を書き換えない', () => {
    const copy = { ...parent }

    createMcpServerEnvironment(definitionWith(), parent)

    expect(parent).toEqual(copy)
  })
})

describe('resolveMcpServerCommand', () => {
  it('登録した Command と引数を、配列のまま起動のしかたへ', () => {
    expect(
      resolveMcpServerCommand(definitionWith(), {
        platform: 'win32',
        env: { SystemRoot: 'C:\\Windows' },
        exists: (path) => path === SERVER_EXE
      })
    ).toEqual({
      ok: true,
      command: {
        name: 'GitHub',
        file: SERVER_EXE,
        args: ['stdio'],
        environment: {},
        killTreeWith: 'C:\\Windows\\System32\\taskkill.exe'
      }
    })
  })

  it('Command が無ければ command-not-found', () => {
    expect(
      resolveMcpServerCommand(definitionWith(), {
        platform: 'win32',
        env: {},
        exists: () => false
      })
    ).toEqual({ ok: false, problem: 'command-not-found' })
  })
})
