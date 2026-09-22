import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import * as secretApi from './index'
import * as factsModule from './secretFileFacts'
import * as maskingModule from './secretMasking'
import * as pathsModule from './secretPaths'
import * as patternsModule from './secretPatterns'
import * as scanModule from './secretScan'

/**
 * Secret Detection を緩める・飛ばす・元へ戻す API が無いこと（Security Core v1 の STEP3）。
 *
 * securityPolicySurface.test.ts（STEP1）・boundarySurface.test.ts（STEP2）と同じく、
 * 公開する名前を**一覧で固定**する。名前を足すときはこのテストも書き換えることになり、
 * そこで見直す機会が必ず生まれる。
 */

/** 検出を止める・伏せ字を戻す口に見える名前。 */
const FORBIDDEN_NAME =
  /disable|bypass|override|skip|unsafe|allowAll|trust|force|assume|markVerified|setVerified|unchecked|insecure|grant|unlock|unmask|unredact|reveal|plainText|rawSecret|secretValue/i

const SECRET_DIRECTORY = join(__dirname)

describe('公開する名前', () => {
  it('Secret API の入口', () => {
    expect(Object.keys(secretApi).sort()).toEqual([
      'SECRET_CATEGORIES',
      'SECRET_MASK',
      'SECRET_SCAN_MAX_CHARS',
      'agentFileReadFacts',
      'agentFileWriteFacts',
      'classifySecretPath',
      'describeErrorWithoutSecrets',
      'isSecretWorkspaceTarget',
      'maskSecretText',
      'redactSecretText',
      'scanTargetFromBytes'
    ])
  })

  it('内部の module も、決めた名前しか公開しない', () => {
    expect(Object.keys(maskingModule).sort()).toEqual([
      'SECRET_MASK',
      'SECRET_SCAN_MAX_CHARS',
      'describeErrorWithoutSecrets',
      'maskSecretText',
      'redactSecretText'
    ])
    expect(Object.keys(patternsModule).sort()).toEqual(['SECRET_CATEGORIES', 'findSecretMatches'])
    expect(Object.keys(pathsModule).sort()).toEqual(['classifySecretPath'])
    expect(Object.keys(factsModule).sort()).toEqual([
      'agentFileReadFacts',
      'agentFileWriteFacts',
      'isSecretWorkspaceTarget'
    ])
    expect(Object.keys(scanModule).sort()).toEqual(['scanTargetFromBytes'])
  })

  it('secret フォルダのどのファイルも、検出を緩める名前を export していない', () => {
    const sources = readdirSync(SECRET_DIRECTORY).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
    )

    expect(sources.sort()).toEqual([
      'index.ts',
      'secretFileFacts.ts',
      'secretMasking.ts',
      'secretPaths.ts',
      'secretPatterns.ts',
      'secretScan.ts'
    ])

    for (const name of sources) {
      const exported = readFileSync(join(SECRET_DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(exported.filter((line) => FORBIDDEN_NAME.test(line))).toEqual([])
    }
  })

  it('検出そのものは、値ではなく位置しか返さない', () => {
    const matches = patternsModule.findSecretMatches('API_KEY=A1b2C3d4E5f6G7h8')

    expect(matches.length).toBe(1)
    expect(Object.keys(matches[0]).sort()).toEqual(['category', 'end', 'start'])
    expect(JSON.stringify(matches)).not.toContain('A1b2C3d4')
  })

  it('知っている種別', () => {
    expect([...secretApi.SECRET_CATEGORIES]).toEqual([
      'authorization-value',
      'github-token',
      'jwt',
      'key-value',
      'private-key',
      'provider-api-key',
      'unscanned',
      'url-credential'
    ])
  })
})

describe('既存の Secret の保存には手を入れない', () => {
  it('MCP の秘密の保存とその伏せ字は、この層から触らない', () => {
    const sources = readdirSync(SECRET_DIRECTORY).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
    )

    for (const name of sources) {
      const source = readFileSync(join(SECRET_DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('import'))
        .join('\n')

      expect(source).not.toContain('mcp')
      expect(source).not.toContain('safeStorage')
    }
  })
})
