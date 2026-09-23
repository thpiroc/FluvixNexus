import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import * as gateModule from './readToolsGate'

/**
 * Read Tool Gate を迂回できないこと（Security Core v1 の STEP9）。
 *
 * 公開する名前を一覧で固定し、IPC・Preload・Renderer から届かないこと、fs を読むのが
 * readToolsIo.ts の1か所だけであることを見る。
 */

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.0.0', getPath: () => '' },
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const readToolsApi = await import('./index')

const DIRECTORY = join(__dirname)
const SRC = join(__dirname, '..', '..', '..')

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('公開する名前', () => {
  it('4つの読み取りと上限だけ', () => {
    expect(Object.keys(readToolsApi).sort()).toEqual([
      'READ_TOOL_MAX_CHANGED_PATHS',
      'READ_TOOL_MAX_EXCERPT_CHARS',
      'READ_TOOL_MAX_LINES',
      'READ_TOOL_MAX_LIST_ENTRIES',
      'READ_TOOL_MAX_QUERY_LENGTH',
      'READ_TOOL_MAX_SEARCH_MATCHES',
      'describeAgentWorkspaceStatus',
      'listAgentWorkspaceDirectory',
      'readAgentWorkspaceFile',
      'searchAgentWorkspace'
    ])
    expect(readFileSync(join(DIRECTORY, 'index.ts'), 'utf8')).not.toContain('createReadToolsGate')
    expect(Object.keys(gateModule)).toContain('createReadToolsGate')
  })

  it('迂回・Secret を読む名前を export していない', () => {
    for (const name of readdirSync(DIRECTORY).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts')
    )) {
      const exported = readFileSync(join(DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(
        exported.filter((line) =>
          /bypass|skip|force|trust|unsafe|unmask|reveal|raw(?!Bytes)|includeSecret/i.test(line)
        )
      ).toEqual([])
    }
  })

  it('fs を読むのは readToolsIo.ts だけ', () => {
    for (const name of readdirSync(DIRECTORY).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'readToolsIo.ts'
    )) {
      expect(codeOf(readFileSync(join(DIRECTORY, name), 'utf8'))).not.toMatch(/from 'fs/)
    }
  })

  it('本物の入口は Main の Policy・Boundary・Audit から作る（引数で差し替えられない）', () => {
    const current = readFileSync(join(DIRECTORY, 'currentReadTools.ts'), 'utf8')

    expect(current).toContain('getCurrentSecurityPolicy')
    expect(current).toContain('resolveAgentWorkspaceTarget')
    expect(current).toContain('recordAuditEvent')
    expect(current).toContain("'read'")
  })
})

describe('Renderer / Preload から届かない', () => {
  it('読み取りを名乗るチャンネルは増えていない', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    expect(
      channels.filter((channel) => /read-tool|agent-file-read|agent-search/i.test(channel))
    ).toEqual([])
  })

  it('Preload・Renderer・IPC handler に、Read Tool Gate の名前は無い', () => {
    for (const directory of [
      join(SRC, 'preload'),
      join(SRC, 'renderer', 'src'),
      join(SRC, 'main', 'ipc')
    ]) {
      for (const name of readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter(
        (file) => /\.tsx?$/.test(file)
      )) {
        expect(readFileSync(join(directory, name), 'utf8')).not.toMatch(
          /readAgentWorkspaceFile|listAgentWorkspaceDirectory|searchAgentWorkspace|describeAgentWorkspaceStatus|createReadToolsGate|readVerifiedFileBytes/
        )
      }
    }
  })
})
