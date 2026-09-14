import { describe, expect, it } from 'vitest'
import type { DebugProfile } from '@shared/debug'
import {
  JS_DEBUG_READY_PATTERN,
  getDebugAdapterCatalogEntry,
  type DebugAdapterCatalogEntry
} from './adapterCatalog'
import type { DebugProgramFileSystem } from './programPath'
import {
  DEBUG_LAUNCH_LANGUAGE_OPTIONS,
  DEBUG_LAUNCH_TYPES,
  resolveDebugProfile,
  type DebugProfileResolverContext
} from './profileResolver'

/**
 * Debug Profile → ResolvedLaunchConfiguration（Session 6-10）。
 *
 * 外の世界（PATH の実体・realpath・環境・catalog）はすべて偽物にする。
 * 見ることは3つ:
 *
 * - program args と adapter args が混ざらないこと（§20.4）
 * - cwd が Workspace root で、program が検証済みの絶対パスであること
 * - 保存時に通っていても、解決時にもう一度断ること（環境変数・相対位置）
 */

const ROOT = 'D:\\proj'
const REAL_ROOT = 'D:\\Proj'
/** adapter のプロセスの cwd（Main が持つ Workspace の外のフォルダ。Session 6-12）。 */
const ADAPTER_CWD = 'C:\\Users\\me\\AppData\\Roaming\\Fluvix Nexus'

const profile: DebugProfile = {
  profileId: 'dp-00000000-0000-4000-8000-000000000001',
  name: 'Run app',
  language: 'node',
  programRelativePath: 'src/app.js',
  programArgs: ['--port', '3000', '&&', 'calc.exe'],
  env: { APP_MODE: 'debug' },
  stopOnEntry: true
}

const integratedNode: DebugAdapterCatalogEntry = {
  language: 'node',
  name: 'Mock Adapter',
  integrationStatus: 'integrated',
  adapter: { executable: 'node', args: ['C:\\tools\\mock-adapter.js', '--stdio'] }
}

/** D:\proj の中の実体（realpath は D:\Proj へ揃える）。 */
const fileSystem: DebugProgramFileSystem = {
  realpath: (path) => {
    const lower = path.toLowerCase()

    if (lower === 'd:\\proj') {
      return REAL_ROOT
    }

    if (lower === 'd:\\proj\\src\\app.js') {
      return `${REAL_ROOT}\\src\\app.js`
    }

    if (lower === 'd:\\proj\\link\\evil.js') {
      return 'C:\\outside\\evil.js'
    }

    // node の runtime（Session 6-15B。resolver が実体も Workspace の外かを見る）。
    if (lower === 'c:\\program files\\nodejs\\node.exe') {
      return path
    }

    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  },
  isFile: (path) => path.toLowerCase().endsWith('.js')
}

/** 確かめ終えた配布物の入り口（userData の下。Session 6-15B）。 */
const ARTIFACT_ENTRY = `${ADAPTER_CWD}\\debug-adapters\\js-debug-dap-v1.117.0\\js-debug\\src\\dapDebugServer.js`

function context(
  overrides: Partial<DebugProfileResolverContext> = {}
): DebugProfileResolverContext {
  return {
    workspaceRootPath: ROOT,
    platform: 'win32',
    parentEnv: {
      PATH: 'C:\\Program Files\\nodejs;.;relative\\bin',
      SystemRoot: 'C:\\Windows',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--inspect'
    },
    exists: (path) => path === 'C:\\Program Files\\nodejs\\node.exe',
    fileSystem,
    getCatalogEntry: () => integratedNode,
    adapterWorkingDirectory: ADAPTER_CWD,
    resolveAdapterArtifact: () => ({
      status: 'verified',
      rootPath: `${ADAPTER_CWD}\\debug-adapters\\js-debug-dap-v1.117.0\\js-debug`,
      entryPath: ARTIFACT_ENTRY
    }),
    ...overrides
  }
}

describe('resolveDebugProfile', () => {
  it('resolves an integrated adapter, the program and the launch arguments', () => {
    const resolution = resolveDebugProfile(profile, context())

    expect(resolution).toEqual({
      status: 'resolved',
      configuration: {
        profileId: profile.profileId,
        language: 'node',
        adapterId: 'pwa-node',
        adapterCommand: {
          name: 'Mock Adapter',
          file: 'C:\\Program Files\\nodejs\\node.exe',
          args: ['C:\\tools\\mock-adapter.js', '--stdio'],
          cwd: ADAPTER_CWD,
          env: { PATH: 'C:\\Program Files\\nodejs;.;relative\\bin', SystemRoot: 'C:\\Windows' }
        },
        launchArguments: {
          name: 'Run app',
          type: 'pwa-node',
          request: 'launch',
          program: `${REAL_ROOT}\\src\\app.js`,
          args: ['--port', '3000', '&&', 'calc.exe'],
          cwd: REAL_ROOT,
          env: { APP_MODE: 'debug' },
          stopOnEntry: true,
          console: 'internalConsole',
          // node の固定欄と runtime（Session 6-15B。adapter と同じ node.exe）。
          runtimeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
          sourceMaps: false,
          outFiles: [],
          autoAttachChildProcesses: false,
          outputCapture: 'std'
        },
        waitForLaunchResponseBeforeConfiguration: false,
        exceptionBreakpointFilters: ['uncaught']
      }
    })
  })

  /** §20.4 ── programArgs は adapter のコマンドラインに一語も現れない。 */
  it('never puts program arguments on the adapter command line', () => {
    const resolution = resolveDebugProfile(profile, context())

    expect(resolution.status).toBe('resolved')

    if (resolution.status === 'resolved') {
      const { adapterCommand, launchArguments } = resolution.configuration

      for (const arg of profile.programArgs) {
        expect(adapterCommand.args).not.toContain(arg)
      }

      expect(launchArguments.args).toEqual(profile.programArgs)
      expect(adapterCommand.args).toEqual(integratedNode.adapter?.args)
    }
  })

  /** profile の env は adapter のプロセスへ入らない（launch の env にだけ入る）。 */
  it('keeps the profile environment out of the adapter process environment', () => {
    const resolution = resolveDebugProfile(profile, context())

    expect(
      resolution.status === 'resolved' && resolution.configuration.adapterCommand.env
    ).not.toHaveProperty('APP_MODE')
  })

  it('ignores extra fields carried on the profile object', () => {
    const polluted = {
      ...profile,
      cwd: 'C:\\Windows',
      runtimeExecutable: 'C:\\evil.exe',
      adapter: 'C:\\evil.exe',
      console: 'integratedTerminal'
    } as DebugProfile

    const resolution = resolveDebugProfile(polluted, context())

    expect(resolution.status).toBe('resolved')

    if (resolution.status === 'resolved') {
      expect(resolution.configuration.adapterCommand.file).toBe(
        'C:\\Program Files\\nodejs\\node.exe'
      )
      expect(resolution.configuration.launchArguments.cwd).toBe(REAL_ROOT)
      expect(resolution.configuration.launchArguments.console).toBe('internalConsole')
      // runtime は Main が PATH から解いた node.exe だけ（profile の値は届かない。Session 6-15B）。
      expect(resolution.configuration.launchArguments.runtimeExecutable).toBe(
        'C:\\Program Files\\nodejs\\node.exe'
      )
    }
  })

  it('has a launch type for every language', () => {
    expect(Object.keys(DEBUG_LAUNCH_TYPES).sort()).toEqual(['csharp', 'node', 'python'])
    expect(Object.keys(DEBUG_LAUNCH_LANGUAGE_OPTIONS).sort()).toEqual(['csharp', 'node', 'python'])
  })

  /**
   * Session 6-12 ── adapter のプロセスの cwd は Workspace の外。
   * `python -m` は cwd を sys.path の先頭に置くため、Workspace の `debugpy/` が adapter になりうる。
   */
  describe('adapter working directory', () => {
    it('starts the adapter outside the workspace while the program runs in the workspace root', () => {
      const resolution = resolveDebugProfile(profile, context())

      expect(resolution.status === 'resolved' && resolution.configuration.adapterCommand.cwd).toBe(
        ADAPTER_CWD
      )
      expect(resolution.status === 'resolved' && resolution.configuration.launchArguments.cwd).toBe(
        REAL_ROOT
      )
    })

    it.each([
      ['the workspace root', 'D:\\proj'],
      ['the real workspace root in another case', 'd:\\PROJ'],
      ['a folder inside the workspace', 'D:\\Proj\\.venv\\Scripts'],
      ['a relative path', 'user-data'],
      ['an empty string', '']
    ])('is adapter-unavailable when it is %s', (_label, adapterWorkingDirectory) => {
      expect(resolveDebugProfile(profile, context({ adapterWorkingDirectory }))).toEqual({
        status: 'failed',
        reason: 'adapter-unavailable'
      })
    })
  })

  /** Session 6-12 ── 最初の実 adapter。値は実 debugpy（1.8.21）で確かめたもの。 */
  describe('python (debugpy)', () => {
    const pythonProfile: DebugProfile = { ...profile, language: 'python' }
    const pythonContext = context({
      parentEnv: { PATH: 'C:\\Python312;.;relative\\bin', SystemRoot: 'C:\\Windows' },
      exists: (path) => path === 'C:\\Python312\\python.exe',
      getCatalogEntry: getDebugAdapterCatalogEntry
    })

    it('resolves the shipped python row to python -m debugpy.adapter outside the workspace', () => {
      const resolution = resolveDebugProfile(pythonProfile, pythonContext)

      expect(resolution).toEqual({
        status: 'resolved',
        configuration: {
          profileId: profile.profileId,
          language: 'python',
          adapterId: 'debugpy',
          adapterCommand: {
            name: 'debugpy',
            file: 'C:\\Python312\\python.exe',
            args: ['-m', 'debugpy.adapter'],
            cwd: ADAPTER_CWD,
            env: { PATH: 'C:\\Python312;.;relative\\bin', SystemRoot: 'C:\\Windows' }
          },
          launchArguments: {
            subProcess: false,
            name: 'Run app',
            type: 'debugpy',
            request: 'launch',
            program: `${REAL_ROOT}\\src\\app.js`,
            args: ['--port', '3000', '&&', 'calc.exe'],
            cwd: REAL_ROOT,
            env: { APP_MODE: 'debug' },
            stopOnEntry: true,
            console: 'internalConsole'
          },
          waitForLaunchResponseBeforeConfiguration: false,
          exceptionBreakpointFilters: ['uncaught']
        }
      })
    })

    it('takes exception filters from the closed table, never from the profile (Session 6-13)', () => {
      const polluted = {
        ...pythonProfile,
        exceptionBreakpointFilters: ['raised', 'userUnhandled'],
        filters: ['raised'],
        exceptionOptions: [{ breakMode: 'always' }]
      } as DebugProfile

      const resolution = resolveDebugProfile(polluted, pythonContext)

      expect(
        resolution.status === 'resolved' && resolution.configuration.exceptionBreakpointFilters
      ).toEqual(['uncaught'])
      expect(
        resolution.status === 'resolved' && resolution.configuration.launchArguments
      ).not.toHaveProperty('exceptionBreakpointFilters')
    })

    it('never carries an interpreter or adapter choice from the profile', () => {
      const polluted = {
        ...pythonProfile,
        python: 'C:\\evil\\python.exe',
        pythonPath: 'C:\\evil\\python.exe',
        subProcess: true,
        justMyCode: false,
        debugAdapterPath: 'C:\\evil\\adapter'
      } as DebugProfile

      const resolution = resolveDebugProfile(polluted, pythonContext)

      expect(resolution.status).toBe('resolved')

      if (resolution.status === 'resolved') {
        const { adapterCommand, launchArguments } = resolution.configuration

        expect(adapterCommand.file).toBe('C:\\Python312\\python.exe')
        expect(adapterCommand.args).toEqual(['-m', 'debugpy.adapter'])
        expect(launchArguments.subProcess).toBe(false)
        expect(launchArguments).not.toHaveProperty('python')
        expect(launchArguments).not.toHaveProperty('pythonPath')
        expect(launchArguments).not.toHaveProperty('justMyCode')
        expect(launchArguments).not.toHaveProperty('debugAdapterPath')
      }
    })

    it('is adapter-unavailable when python is not on PATH', () => {
      expect(resolveDebugProfile(pythonProfile, { ...pythonContext, exists: () => false })).toEqual(
        { status: 'failed', reason: 'adapter-unavailable' }
      )
    })

    it('does not add python-only fields to other languages', () => {
      const resolution = resolveDebugProfile(profile, context())

      expect(
        resolution.status === 'resolved' && resolution.configuration.launchArguments
      ).not.toHaveProperty('subProcess')
    })
  })

  /** Session 6-14 ── C# の実 adapter。値は実 netcoredbg（3.2.0-1）で確かめたもの。 */
  describe('csharp (netcoredbg)', () => {
    const csharpProfile: DebugProfile = {
      ...profile,
      language: 'csharp',
      programRelativePath: 'bin/Debug/net8.0/App.dll'
    }
    const csharpFileSystem: DebugProgramFileSystem = {
      realpath: (path) => {
        const lower = path.toLowerCase()

        if (lower === 'd:\\proj') {
          return REAL_ROOT
        }

        if (lower === 'd:\\proj\\bin\\debug\\net8.0\\app.dll') {
          return `${REAL_ROOT}\\bin\\Debug\\net8.0\\App.dll`
        }

        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      isFile: (path) => path.toLowerCase().endsWith('.dll')
    }
    const csharpContext = context({
      parentEnv: { PATH: 'C:\\tools\\netcoredbg;.;relative\\bin', SystemRoot: 'C:\\Windows' },
      exists: (path) =>
        path === 'C:\\tools\\netcoredbg\\netcoredbg.exe' ||
        path === 'C:\\Program Files\\dotnet\\dotnet.exe',
      fileSystem: csharpFileSystem,
      getCatalogEntry: getDebugAdapterCatalogEntry
    })

    it('resolves the shipped C# row to netcoredbg --interpreter=vscode outside the workspace', () => {
      const resolution = resolveDebugProfile(csharpProfile, csharpContext)

      expect(resolution).toEqual({
        status: 'resolved',
        configuration: {
          profileId: profile.profileId,
          language: 'csharp',
          adapterId: 'coreclr',
          adapterCommand: {
            name: 'netcoredbg',
            file: 'C:\\tools\\netcoredbg\\netcoredbg.exe',
            args: ['--interpreter=vscode'],
            cwd: 'C:\\tools\\netcoredbg',
            env: { PATH: 'C:\\tools\\netcoredbg;.;relative\\bin', SystemRoot: 'C:\\Windows' }
          },
          launchArguments: {
            stopAtEntry: true,
            name: 'Run app',
            type: 'coreclr',
            request: 'launch',
            program: 'C:\\Program Files\\dotnet\\dotnet.exe',
            args: [`${REAL_ROOT}\\bin\\Debug\\net8.0\\App.dll`, '--port', '3000', '&&', 'calc.exe'],
            cwd: REAL_ROOT,
            env: { APP_MODE: 'debug' },
            console: 'internalConsole'
          },
          waitForLaunchResponseBeforeConfiguration: true,
          exceptionBreakpointFilters: ['user-unhandled']
        }
      })
    })

    it('never carries adapter-specific C# settings from the profile', () => {
      const polluted = {
        ...csharpProfile,
        pipeTransport: { debuggerPath: 'C:\\evil\\netcoredbg.exe' },
        debuggerPath: 'C:\\evil\\netcoredbg.exe',
        justMyCode: false,
        stopAtEntry: false,
        exceptionBreakpointFilters: ['all']
      } as DebugProfile

      const resolution = resolveDebugProfile(polluted, csharpContext)

      expect(resolution.status).toBe('resolved')

      if (resolution.status === 'resolved') {
        const { adapterCommand, launchArguments } = resolution.configuration

        expect(adapterCommand.file).toBe('C:\\tools\\netcoredbg\\netcoredbg.exe')
        expect(adapterCommand.args).toEqual(['--interpreter=vscode'])
        expect(launchArguments.stopAtEntry).toBe(true)
        expect(launchArguments.program).toBe('C:\\Program Files\\dotnet\\dotnet.exe')
        expect(launchArguments.args[0]).toBe(`${REAL_ROOT}\\bin\\Debug\\net8.0\\App.dll`)
        expect(launchArguments).not.toHaveProperty('pipeTransport')
        expect(launchArguments).not.toHaveProperty('debuggerPath')
        expect(launchArguments).not.toHaveProperty('justMyCode')
      }
    })

    it('is adapter-unavailable when netcoredbg is not on PATH', () => {
      expect(resolveDebugProfile(csharpProfile, { ...csharpContext, exists: () => false })).toEqual(
        { status: 'failed', reason: 'adapter-unavailable' }
      )
    })

    it('is invalid-profile when the C# target is not a built DLL', () => {
      const exeFileSystem: DebugProgramFileSystem = {
        realpath: (path) => {
          const lower = path.toLowerCase()

          if (lower === 'd:\\proj') {
            return REAL_ROOT
          }

          if (lower === 'd:\\proj\\bin\\debug\\net8.0\\app.exe') {
            return `${REAL_ROOT}\\bin\\Debug\\net8.0\\App.exe`
          }

          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        },
        isFile: (path) => path.toLowerCase().endsWith('.exe')
      }

      expect(
        resolveDebugProfile(
          { ...csharpProfile, programRelativePath: 'bin/Debug/net8.0/App.exe' },
          { ...csharpContext, fileSystem: exeFileSystem }
        )
      ).toEqual({ status: 'failed', reason: 'invalid-profile' })
    })

    it('is adapter-unavailable when a netcoredbg-visible C# path is not ASCII-only', () => {
      const unicodeRoot = 'D:\\開発\\Proj'
      const unicodeFileSystem: DebugProgramFileSystem = {
        realpath: (path) => {
          const lower = path.toLowerCase()

          if (lower === 'd:\\proj') {
            return unicodeRoot
          }

          if (lower === 'd:\\proj\\bin\\debug\\net8.0\\app.dll') {
            return `${unicodeRoot}\\bin\\Debug\\net8.0\\App.dll`
          }

          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        },
        isFile: (path) => path.toLowerCase().endsWith('.dll')
      }

      expect(
        resolveDebugProfile(csharpProfile, {
          ...csharpContext,
          fileSystem: unicodeFileSystem
        })
      ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
    })
  })

  describe('rejects again at resolve time', () => {
    it('a denied environment name that slipped into storage', () => {
      expect(resolveDebugProfile({ ...profile, env: { Path: 'C:\\evil' } }, context())).toEqual({
        status: 'failed',
        reason: 'invalid-profile'
      })
    })

    it('an absolute program path that slipped into storage', () => {
      expect(
        resolveDebugProfile(
          { ...profile, programRelativePath: 'C:\\Windows\\notepad.exe' },
          context()
        )
      ).toEqual({ status: 'failed', reason: 'invalid-profile' })
    })

    it('a program whose real path is outside the workspace', () => {
      expect(
        resolveDebugProfile({ ...profile, programRelativePath: 'link/evil.js' }, context())
      ).toEqual({ status: 'failed', reason: 'program-outside-workspace' })
    })

    it('a program that does not exist', () => {
      expect(
        resolveDebugProfile({ ...profile, programRelativePath: 'src/missing.js' }, context())
      ).toEqual({ status: 'failed', reason: 'program-not-found' })
    })
  })

  describe('adapter availability', () => {
    it('is unavailable while the catalog row is not integrated', () => {
      expect(
        resolveDebugProfile(
          profile,
          context({
            getCatalogEntry: () => ({
              language: 'node',
              name: 'Node.js Debug Adapter',
              integrationStatus: 'not-integrated'
            })
          })
        )
      ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
    })

    it('is unavailable when the executable is not on PATH', () => {
      expect(resolveDebugProfile(profile, context({ exists: () => false }))).toEqual({
        status: 'failed',
        reason: 'adapter-unavailable'
      })
    })

    it('does not search relative PATH entries (the workspace)', () => {
      expect(
        resolveDebugProfile(
          profile,
          context({
            parentEnv: { PATH: '.;relative\\bin' },
            exists: (path) => path.endsWith('node.exe')
          })
        )
      ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
    })

    it('is unavailable when the catalog row belongs to another language', () => {
      expect(resolveDebugProfile({ ...profile, language: 'python' }, context())).toEqual({
        status: 'failed',
        reason: 'adapter-unavailable'
      })
    })
  })

  describe('transport and child session metadata (Session 6-15A)', () => {
    it('adds no transport or child session fields for a row without them', () => {
      const result = resolveDebugProfile(profile, context())

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect('transport' in result.configuration.adapterCommand).toBe(false)
        expect('childSessions' in result.configuration).toBe(false)
      }
    })

    it('passes the row transport through and derives the child policy from the language type', () => {
      const transport = {
        kind: 'socket',
        readiness: { kind: 'stdout-pattern', pattern: /listening at 127\.0\.0\.1:(?<port>\d+)/ }
      } as const
      const result = resolveDebugProfile(
        profile,
        context({
          getCatalogEntry: () => ({
            ...integratedNode,
            adapter: {
              executable: 'node',
              args: ['C:\\tools\\mock-adapter.js'],
              transport,
              childSessions: { targetIdKey: '__pendingTargetId' }
            }
          })
        })
      )

      expect(result).toMatchObject({
        status: 'resolved',
        configuration: {
          adapterCommand: { transport },
          childSessions: { launchType: DEBUG_LAUNCH_TYPES.node, targetIdKey: '__pendingTargetId' }
        }
      })
    })

    it('does not let profile fields choose the transport or child sessions', () => {
      const result = resolveDebugProfile(
        {
          ...profile,
          transport: { kind: 'socket' },
          childSessions: { launchType: 'anything', targetIdKey: 'cwd' }
        } as DebugProfile,
        context()
      )

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect('transport' in result.configuration.adapterCommand).toBe(false)
        expect('childSessions' in result.configuration).toBe(false)
      }
    })

    it('keeps python / csharp on stdio and gives only the shipped node row a socket (Session 6-15B)', () => {
      for (const language of ['python', 'csharp'] as const) {
        const entry = getDebugAdapterCatalogEntry(language)

        expect(entry.adapter?.transport).toBeUndefined()
        expect(entry.adapter?.childSessions).toBeUndefined()
        expect(entry.adapter?.artifact).toBeUndefined()
      }

      expect(getDebugAdapterCatalogEntry('node').adapter).toMatchObject({
        artifact: 'vscode-js-debug',
        transport: { kind: 'socket' },
        childSessions: { targetIdKey: '__pendingTargetId' }
      })
    })
  })

  /** Session 6-15B ── 値は実 vscode-js-debug（1.117.0）で確かめたもの。§20.24。 */
  describe('node (vscode-js-debug)', () => {
    const NODE = 'C:\\Program Files\\nodejs\\node.exe'
    const programs = [
      'app.js',
      'app.mjs',
      'app.cjs',
      'upper.MJS',
      'app.ts',
      'app.mts',
      'app.cts',
      'app.json',
      'app'
    ]

    /** src の下に拡張子違いのプログラムを置いた Workspace と、Workspace の中 / 外の node.exe。 */
    const nodeFileSystem: DebugProgramFileSystem = {
      realpath: (path) => {
        const lower = path.toLowerCase()

        if (lower === 'd:\\proj') {
          return REAL_ROOT
        }

        for (const name of programs) {
          if (lower === `d:\\proj\\src\\${name.toLowerCase()}`) {
            return `${REAL_ROOT}\\src\\${name}`
          }
        }

        if (lower === NODE.toLowerCase() || lower === 'd:\\proj\\tools\\node.exe') {
          return path
        }

        if (lower === 'c:\\links\\node.exe') {
          return `${REAL_ROOT}\\bin\\node.exe`
        }

        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      isFile: (path) =>
        programs.some((name) => path.toLowerCase().endsWith(`\\src\\${name.toLowerCase()}`))
    }

    function nodeContext(
      overrides: Partial<DebugProfileResolverContext> = {}
    ): DebugProfileResolverContext {
      return context({
        fileSystem: nodeFileSystem,
        getCatalogEntry: getDebugAdapterCatalogEntry,
        ...overrides
      })
    }

    it('resolves the shipped node row to the verified js-debug server on node.exe', () => {
      const requested: string[] = []
      const resolution = resolveDebugProfile(
        profile,
        nodeContext({
          resolveAdapterArtifact: (artifact) => {
            requested.push(artifact)
            return { status: 'verified', rootPath: 'unused', entryPath: ARTIFACT_ENTRY }
          }
        })
      )

      expect(requested).toEqual(['vscode-js-debug'])
      expect(resolution).toEqual({
        status: 'resolved',
        configuration: {
          profileId: profile.profileId,
          language: 'node',
          adapterId: 'pwa-node',
          adapterCommand: {
            name: 'vscode-js-debug',
            file: NODE,
            args: [ARTIFACT_ENTRY, '0', '127.0.0.1'],
            cwd: ADAPTER_CWD,
            env: { PATH: 'C:\\Program Files\\nodejs;.;relative\\bin', SystemRoot: 'C:\\Windows' },
            transport: {
              kind: 'socket',
              readiness: { kind: 'stdout-pattern', pattern: JS_DEBUG_READY_PATTERN }
            }
          },
          launchArguments: {
            name: 'Run app',
            type: 'pwa-node',
            request: 'launch',
            program: `${REAL_ROOT}\\src\\app.js`,
            args: ['--port', '3000', '&&', 'calc.exe'],
            cwd: REAL_ROOT,
            env: { APP_MODE: 'debug' },
            stopOnEntry: true,
            runtimeExecutable: NODE,
            sourceMaps: false,
            outFiles: [],
            autoAttachChildProcesses: false,
            outputCapture: 'std',
            console: 'internalConsole'
          },
          waitForLaunchResponseBeforeConfiguration: false,
          exceptionBreakpointFilters: ['uncaught'],
          childSessions: {
            launchType: 'pwa-node',
            targetIdKey: '__pendingTargetId',
            rootOutputCategories: ['stdout', 'stderr']
          }
        }
      })
    })

    it.each(['app.js', 'app.mjs', 'app.cjs', 'upper.MJS'])('accepts %s', (name) => {
      const resolution = resolveDebugProfile(
        { ...profile, programRelativePath: `src/${name}` },
        nodeContext()
      )

      expect(
        resolution.status === 'resolved' && resolution.configuration.launchArguments.program
      ).toBe(`${REAL_ROOT}\\src\\${name}`)
    })

    it.each(['app.ts', 'app.mts', 'app.cts', 'app.json', 'app'])(
      'is invalid-profile for %s and never verifies the artifact',
      (name) => {
        const requested: string[] = []

        expect(
          resolveDebugProfile(
            { ...profile, programRelativePath: `src/${name}` },
            nodeContext({
              resolveAdapterArtifact: (artifact) => {
                requested.push(artifact)
                return { status: 'verified', rootPath: 'unused', entryPath: ARTIFACT_ENTRY }
              }
            })
          )
        ).toEqual({ status: 'failed', reason: 'invalid-profile' })
        expect(requested).toEqual([])
      }
    )

    it.each(['missing', 'invalid', 'hash-mismatch'] as const)(
      'is adapter-unavailable when the pinned artifact is %s',
      (status) => {
        expect(
          resolveDebugProfile(profile, nodeContext({ resolveAdapterArtifact: () => ({ status }) }))
        ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
      }
    )

    it('is adapter-unavailable when the verified entry is inside the workspace', () => {
      expect(
        resolveDebugProfile(
          profile,
          nodeContext({
            resolveAdapterArtifact: () => ({
              status: 'verified',
              rootPath: 'D:\\proj\\js-debug',
              entryPath: 'd:\\PROJ\\js-debug\\src\\dapDebugServer.js'
            })
          })
        )
      ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
    })

    it('does not trust a node.exe inside the workspace, even from an absolute PATH entry', () => {
      expect(
        resolveDebugProfile(
          profile,
          nodeContext({
            parentEnv: {
              PATH: 'D:\\proj\\tools;C:\\Program Files\\nodejs',
              SystemRoot: 'C:\\Windows'
            },
            exists: (path) => path === 'D:\\proj\\tools\\node.exe' || path === NODE
          })
        )
      ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
    })

    it('does not trust a node.exe whose real path is inside the workspace', () => {
      expect(
        resolveDebugProfile(
          profile,
          nodeContext({
            parentEnv: { PATH: 'C:\\links', SystemRoot: 'C:\\Windows' },
            exists: (path) => path === 'C:\\links\\node.exe'
          })
        )
      ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
    })

    it('is adapter-unavailable when node is only a .cmd shim or not on PATH', () => {
      expect(
        resolveDebugProfile(
          profile,
          nodeContext({
            parentEnv: { PATH: 'C:\\shims', SystemRoot: 'C:\\Windows' },
            exists: (path) => path === 'C:\\shims\\node.cmd'
          })
        )
      ).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
      expect(resolveDebugProfile(profile, nodeContext({ exists: () => false }))).toEqual({
        status: 'failed',
        reason: 'adapter-unavailable'
      })
    })

    it('never lets the profile choose the runtime, source maps, child processes or attach', () => {
      const resolution = resolveDebugProfile(
        {
          ...profile,
          runtimeExecutable: 'C:\\evil\\node.exe',
          runtimeArgs: ['--require', 'C:\\evil.js'],
          runtimeVersion: '14',
          sourceMaps: true,
          outFiles: ['C:\\**\\*.js'],
          autoAttachChildProcesses: true,
          outputCapture: 'console',
          request: 'attach',
          port: 9229,
          __workspaceFolder: 'C:\\'
        } as DebugProfile,
        nodeContext()
      )

      expect(resolution.status).toBe('resolved')

      if (resolution.status === 'resolved') {
        const launch = resolution.configuration.launchArguments

        expect(launch).toMatchObject({
          request: 'launch',
          runtimeExecutable: NODE,
          sourceMaps: false,
          outFiles: [],
          autoAttachChildProcesses: false,
          outputCapture: 'std'
        })
        expect(launch).not.toHaveProperty('runtimeArgs')
        expect(launch).not.toHaveProperty('runtimeVersion')
        expect(launch).not.toHaveProperty('port')
        expect(launch).not.toHaveProperty('__workspaceFolder')
      }
    })

    it('adds no node fields to python / csharp', () => {
      const python = resolveDebugProfile(
        { ...profile, language: 'python', programRelativePath: 'src/app.js' },
        context({
          parentEnv: { PATH: 'C:\\Python312', SystemRoot: 'C:\\Windows' },
          exists: (path) => path === 'C:\\Python312\\python.exe',
          getCatalogEntry: getDebugAdapterCatalogEntry
        })
      )

      expect(python.status).toBe('resolved')

      if (python.status === 'resolved') {
        for (const key of [
          'runtimeExecutable',
          'sourceMaps',
          'outFiles',
          'autoAttachChildProcesses',
          'outputCapture'
        ]) {
          expect(python.configuration.launchArguments).not.toHaveProperty(key)
        }

        expect(python.configuration.adapterCommand.args).toEqual(['-m', 'debugpy.adapter'])
      }
    })
  })
})
