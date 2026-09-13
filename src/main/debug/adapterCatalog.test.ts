import { describe, expect, it } from 'vitest'
import {
  DEBUG_ADAPTER_LANGUAGE_IDS,
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

  it('Session 6-12 では python（debugpy）の行だけが統合されている', () => {
    expect(listDebugAdapterCatalogEntries()).toEqual([
      { language: 'node', name: 'Node.js Debug Adapter', integrationStatus: 'not-integrated' },
      {
        language: 'python',
        name: 'debugpy',
        integrationStatus: 'integrated',
        adapter: { executable: 'python', args: ['-m', 'debugpy.adapter'] }
      },
      { language: 'csharp', name: 'netcoredbg', integrationStatus: 'not-integrated' }
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

  it('1行でも統合されていれば、起動できる adapter がある（出荷状態は python）', () => {
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

  it('does not resolve the shipped rows that are not integrated (node / csharp)', () => {
    for (const language of ['node', 'csharp'] as const) {
      expect(
        resolveDebugAdapterExecutable(
          getDebugAdapterCatalogEntry(language),
          'win32',
          windowsEnv,
          () => true
        )
      ).toBeNull()
    }
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
