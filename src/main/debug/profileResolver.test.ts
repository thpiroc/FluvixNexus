import { describe, expect, it } from 'vitest'
import type { DebugProfile } from '@shared/debug'
import type { DebugAdapterCatalogEntry } from './adapterCatalog'
import type { DebugProgramFileSystem } from './programPath'
import {
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

    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  },
  isFile: (path) => path.toLowerCase().endsWith('.js')
}

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
          cwd: REAL_ROOT,
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
          console: 'internalConsole'
        }
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
      expect(resolution.configuration.launchArguments).not.toHaveProperty('runtimeExecutable')
    }
  })

  it('has a launch type for every language', () => {
    expect(Object.keys(DEBUG_LAUNCH_TYPES).sort()).toEqual(['csharp', 'node', 'python'])
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
    it('is unavailable while the catalog row is not integrated (the shipped state)', () => {
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
})
