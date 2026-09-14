import { describe, expect, it } from 'vitest'
import { createDebugAdapterReadinessScanner } from './adapterTransport'
import {
  DEBUG_ADAPTER_LANGUAGE_IDS,
  JS_DEBUG_READY_PATTERN,
  getDebugAdapterCatalogEntry,
  hasIntegratedDebugAdapter,
  isDebugAdapterLanguageId,
  listDebugAdapterCatalogEntries,
  resolveDebugAdapterExecutable,
  type DebugAdapterCatalogEntry
} from './adapterCatalog'

describe('Debug Adapter catalog foundation', () => {
  it('言語は閉じた集合だけを受け付ける', () => {
    expect([...DEBUG_ADAPTER_LANGUAGE_IDS]).toEqual(['node', 'python', 'csharp'])
    expect(isDebugAdapterLanguageId('node')).toBe(true)
    expect(isDebugAdapterLanguageId('ruby')).toBe(false)
  })

  it('Session 6-15B では node（vscode-js-debug）・python（debugpy）・C#（netcoredbg）の行が統合されている', () => {
    expect(listDebugAdapterCatalogEntries()).toEqual([
      {
        language: 'node',
        name: 'vscode-js-debug',
        integrationStatus: 'integrated',
        adapter: {
          executable: 'node',
          artifact: 'vscode-js-debug',
          args: ['0', '127.0.0.1'],
          transport: {
            kind: 'socket',
            readiness: { kind: 'stdout-pattern', pattern: JS_DEBUG_READY_PATTERN }
          },
          childSessions: {
            targetIdKey: '__pendingTargetId',
            rootOutputCategories: ['stdout', 'stderr']
          }
        }
      },
      {
        language: 'python',
        name: 'debugpy',
        integrationStatus: 'integrated',
        adapter: { executable: 'python', args: ['-m', 'debugpy.adapter'] }
      },
      {
        language: 'csharp',
        name: 'netcoredbg',
        integrationStatus: 'integrated',
        adapter: { executable: 'netcoredbg', args: ['--interpreter=vscode'] }
      }
    ])
  })

  it('Renderer が任意 adapter を指定する入口ではなく、Main 内の language だけで引く', () => {
    expect(getDebugAdapterCatalogEntry('python')).toEqual({
      language: 'python',
      name: 'debugpy',
      integrationStatus: 'integrated',
      adapter: { executable: 'python', args: ['-m', 'debugpy.adapter'] }
    })
  })

  /** Debug の状態の `unavailable` の根拠（Session 6-9）。 */
  it('統合された行が1つも無ければ、起動できる adapter が無い', () => {
    const entries = listDebugAdapterCatalogEntries().map((entry): DebugAdapterCatalogEntry => ({
      language: entry.language,
      name: entry.name,
      integrationStatus: 'not-integrated'
    }))

    expect(hasIntegratedDebugAdapter(entries)).toBe(false)
  })

  it('1行でも統合されていれば、起動できる adapter がある（出荷状態は python / C#）', () => {
    expect(hasIntegratedDebugAdapter()).toBe(true)
  })
})

/** 行の adapter を絶対パスへ解く（Session 6-10。§20.7 は languageServerCatalog と同一の規則）。 */
describe('resolveDebugAdapterExecutable', () => {
  const integrated: DebugAdapterCatalogEntry = {
    language: 'python',
    name: 'debugpy',
    integrationStatus: 'integrated',
    adapter: { executable: 'python', args: ['-m', 'debugpy.adapter'] }
  }

  const windowsEnv = { PATH: 'C:\\Python312;.;tools', SystemRoot: 'C:\\Windows' }

  it('resolves the shipped node row to node.exe with the server arguments (Session 6-15B)', () => {
    // 入り口の script は表に無い。配布物を確かめた resolver が args の前に置く（profileResolver.ts）。
    expect(
      resolveDebugAdapterExecutable(
        getDebugAdapterCatalogEntry('node'),
        'win32',
        { PATH: 'C:\\Program Files\\nodejs', SystemRoot: 'C:\\Windows' },
        (path) => path === 'C:\\Program Files\\nodejs\\node.exe'
      )
    ).toEqual({ file: 'C:\\Program Files\\nodejs\\node.exe', args: ['0', '127.0.0.1'] })
  })

  it('never wraps a node.cmd for a row that runs an artifact script (Session 6-15B)', () => {
    expect(
      resolveDebugAdapterExecutable(
        getDebugAdapterCatalogEntry('node'),
        'win32',
        { PATH: 'C:\\shims', SystemRoot: 'C:\\Windows' },
        (path) => path === 'C:\\shims\\node.cmd'
      )
    ).toBeNull()
  })

  it('reads the port from the real js-debug ready line and refuses a non-loopback host (Session 6-15B)', () => {
    const readiness = { kind: 'stdout-pattern', pattern: JS_DEBUG_READY_PATTERN } as const

    expect(
      createDebugAdapterReadinessScanner(readiness).push(
        'Debug server listening at 127.0.0.1:59377\n'
      )
    ).toEqual({ status: 'ready', port: 59377 })
    expect(
      createDebugAdapterReadinessScanner(readiness).push(
        'Debug server listening at 0.0.0.0:8123\r\n'
      )
    ).toMatchObject({ status: 'invalid' })
    expect(
      createDebugAdapterReadinessScanner(readiness).push('Debug server listening soon\n')
    ).toEqual({ status: 'waiting' })
  })

  it('resolves the shipped python row through PATH (Session 6-12)', () => {
    expect(
      resolveDebugAdapterExecutable(
        getDebugAdapterCatalogEntry('python'),
        'win32',
        windowsEnv,
        (path) => path === 'C:\\Python312\\python.exe'
      )
    ).toEqual({ file: 'C:\\Python312\\python.exe', args: ['-m', 'debugpy.adapter'] })
  })

  it('resolves the shipped C# row through PATH (Session 6-14)', () => {
    expect(
      resolveDebugAdapterExecutable(
        getDebugAdapterCatalogEntry('csharp'),
        'win32',
        { PATH: 'C:\\tools\\netcoredbg', SystemRoot: 'C:\\Windows' },
        (path) => path === 'C:\\tools\\netcoredbg\\netcoredbg.exe'
      )
    ).toEqual({ file: 'C:\\tools\\netcoredbg\\netcoredbg.exe', args: ['--interpreter=vscode'] })
  })

  it('does not resolve an integrated row that has nothing to start', () => {
    expect(
      resolveDebugAdapterExecutable(
        { language: 'python', name: 'debugpy', integrationStatus: 'integrated' },
        'win32',
        windowsEnv,
        () => true
      )
    ).toBeNull()
  })

  it('resolves a native executable on PATH to its absolute path with the table arguments', () => {
    expect(
      resolveDebugAdapterExecutable(
        integrated,
        'win32',
        windowsEnv,
        (path) => path === 'C:\\Python312\\python.exe'
      )
    ).toEqual({ file: 'C:\\Python312\\python.exe', args: ['-m', 'debugpy.adapter'] })
  })

  it('wraps a .cmd with cmd.exe built from %SystemRoot%', () => {
    expect(
      resolveDebugAdapterExecutable(
        integrated,
        'win32',
        windowsEnv,
        (path) => path === 'C:\\Python312\\python.cmd'
      )
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/c', 'C:\\Python312\\python.cmd', '-m', 'debugpy.adapter']
    })
  })

  it('does not fall back to a bare cmd.exe when %SystemRoot% is missing', () => {
    expect(
      resolveDebugAdapterExecutable(integrated, 'win32', { PATH: 'C:\\Python312' }, (path) =>
        path.endsWith('.cmd')
      )
    ).toBeNull()
  })

  /** 相対の PATH 項目（cwd ＝ Workspace を起点に解決される）は辿らない。 */
  it('never finds an executable through a relative PATH entry', () => {
    expect(
      resolveDebugAdapterExecutable(integrated, 'win32', { PATH: '.;tools' }, () => true)
    ).toBeNull()
  })

  it.each(['..\\python', 'C:\\evil\\python', 'bin/python', ''])(
    'refuses a table executable that is not a bare name (%j)',
    (executable) => {
      expect(
        resolveDebugAdapterExecutable(
          { ...integrated, adapter: { executable, args: [] } },
          'win32',
          windowsEnv,
          () => true
        )
      ).toBeNull()
    }
  )

  it('resolves on POSIX without extensions', () => {
    expect(
      resolveDebugAdapterExecutable(
        integrated,
        'linux',
        { PATH: '/usr/bin:bin' },
        (path) => path === '/usr/bin/python'
      )
    ).toEqual({ file: '/usr/bin/python', args: ['-m', 'debugpy.adapter'] })
  })
})
