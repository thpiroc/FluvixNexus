import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageServerFeature } from './serverCapabilities'

const mocks = vi.hoisted(() => ({
  workspace: { rootPath: 'D:\\proj' } as { rootPath: string } | null,
  allowed: true,
  /** どの機能を出すサーバか。Pyright を模すときは formatting を外す。 */
  features: new Set<LanguageServerFeature>([
    'completion',
    'hover',
    'definition',
    'references',
    'formatting',
    'rename',
    'prepare-rename'
  ]),
  document: null as unknown
}))

vi.mock('./languageServerSettings', () => ({
  isLanguageServerAllowed: () => mocks.allowed
}))

vi.mock('./documentSync', () => ({
  getOpenLspDocument: () => mocks.document
}))

vi.mock('./languageServers', () => ({
  supportsLanguageServerFeature: (_id: string, feature: LanguageServerFeature) =>
    mocks.features.has(feature)
}))

import { checkLspDocumentFreshness, prepareLspDocumentRequest } from './documentRequest'

/**
 * 5つの機能が共有する事前の確認（Session 5-10）。
 *
 * Session 5-9 まではこの7段が5つのファイルに写されていて、
 * 3段目が「TypeScript か」を直に見ていた。ここが1つになったことで、
 * **Python が通るかどうかの確認も1箇所で済む。**
 */

function openDocument(overrides: Record<string, unknown> = {}): unknown {
  return {
    relativePath: 'src/app.py',
    serverId: 'python',
    languageId: 'python',
    uri: 'file:///D%3A/proj/src/app.py',
    version: 4,
    synced: true,
    ...overrides
  }
}

function getWorkspace(): { readonly rootPath: string } | null {
  return mocks.workspace
}

function prepare(
  relativePath: string,
  feature: LanguageServerFeature = 'completion',
  version = 4
): ReturnType<typeof prepareLspDocumentRequest> {
  return prepareLspDocumentRequest({ relativePath, version }, feature, getWorkspace)
}

describe('prepareLspDocumentRequest', () => {
  beforeEach(() => {
    mocks.workspace = { rootPath: 'D:\\proj' }
    mocks.allowed = true
    mocks.features = new Set<LanguageServerFeature>([
      'completion',
      'hover',
      'definition',
      'references',
      'formatting',
      'rename',
      'prepare-rename'
    ])
    mocks.document = openDocument()
  })

  /* ------------------------------------------------------------------ Python */

  it('.py は python サーバへ向く（Renderer はサーバを名指ししない）', () => {
    const prepared = prepare('src/app.py')

    expect(prepared.status).toBe('ready')
    expect(prepared).toMatchObject({
      serverId: 'python',
      rootPath: 'D:\\proj',
      uri: 'file:///D%3A/proj/src/app.py'
    })
  })

  it('.pyi / .pyw も python サーバへ向く', () => {
    for (const path of ['stubs/app.pyi', 'scripts/tool.pyw']) {
      mocks.document = openDocument({ relativePath: path })

      expect(prepare(path).status).toBe('ready')
    }
  })

  it('.ts は typescript サーバへ向く（Session 5-9 までと同じ）', () => {
    mocks.document = openDocument({
      relativePath: 'src/app.ts',
      serverId: 'typescript',
      languageId: 'typescript',
      uri: 'file:///D%3A/proj/src/app.ts'
    })

    expect(prepare('src/app.ts')).toMatchObject({ status: 'ready', serverId: 'typescript' })
  })

  /* --------------------------------------------------------- 名乗りを見る段 */

  it('サーバが出さない機能は unavailable（Pyright の formatting）', () => {
    mocks.features.delete('formatting')

    expect(prepare('src/app.py', 'formatting')).toEqual({ status: 'unavailable' })
  })

  it('formatting を出さないサーバでも、他の6つは通る', () => {
    mocks.features.delete('formatting')

    for (const feature of [
      'completion',
      'hover',
      'definition',
      'references',
      'rename',
      'prepare-rename'
    ] as const) {
      expect(prepare('src/app.py', feature).status).toBe('ready')
    }
  })

  it('prepare-rename だけを出さないサーバでは rename は通る', () => {
    mocks.features.delete('prepare-rename')

    expect(prepare('src/app.py', 'rename').status).toBe('ready')
    expect(prepare('src/app.py', 'prepare-rename')).toEqual({ status: 'unavailable' })
  })

  /* ------------------------------------------------------------- 断る場合 */

  it('Workspace が開いていなければ unavailable', () => {
    mocks.workspace = null

    expect(prepare('src/app.py')).toEqual({ status: 'unavailable' })
  })

  it('Workspace の外は outside-workspace', () => {
    expect(prepare('../outside/app.py')).toEqual({ status: 'outside-workspace' })
  })

  it('担当サーバの無い拡張子は unavailable', () => {
    for (const path of ['README.md', 'notes.txt', 'data.json', 'Makefile']) {
      mocks.document = openDocument({ relativePath: path })

      expect(prepare(path)).toEqual({ status: 'unavailable' })
    }
  })

  it('設定で OFF なら unavailable', () => {
    mocks.allowed = false

    expect(prepare('src/app.py')).toEqual({ status: 'unavailable' })
  })

  it('伝え終えていない文書は unavailable', () => {
    mocks.document = openDocument({ synced: false })

    expect(prepare('src/app.py')).toEqual({ status: 'unavailable' })
  })

  it('開いていない文書は unavailable', () => {
    mocks.document = null

    expect(prepare('src/app.py')).toEqual({ status: 'unavailable' })
  })

  it('控えの行き先が食い違えば unavailable', () => {
    mocks.document = openDocument({ serverId: 'typescript' })

    expect(prepare('src/app.py')).toEqual({ status: 'unavailable' })
  })

  it('版が違えば stale', () => {
    expect(prepare('src/app.py', 'completion', 3)).toEqual({ status: 'stale' })
  })

  it('名乗りを見るのは版より先（立っていないサーバへ stale とは答えない）', () => {
    mocks.features.clear()

    expect(prepare('src/app.py', 'completion', 3)).toEqual({ status: 'unavailable' })
  })
})

describe('checkLspDocumentFreshness', () => {
  beforeEach(() => {
    mocks.document = openDocument()
  })

  it('版が動いていなければ null', () => {
    expect(checkLspDocumentFreshness({ relativePath: 'src/app.py', version: 4 })).toBeNull()
  })

  it('版が動いていれば stale', () => {
    expect(checkLspDocumentFreshness({ relativePath: 'src/app.py', version: 3 })).toEqual({
      status: 'stale'
    })
  })

  it('待っている間に閉じられていれば stale', () => {
    mocks.document = null

    expect(checkLspDocumentFreshness({ relativePath: 'src/app.py', version: 4 })).toEqual({
      status: 'stale'
    })
  })
})
