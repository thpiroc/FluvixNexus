import { describe, expect, it, vi } from 'vitest'
import type { DebugProfilesDocument } from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import type { DebugAdapterCatalogEntry } from './adapterCatalog'
import { createDebugProfileService, type DebugProfileServiceDependencies } from './debugProfiles'
import type { DebugSessionStartOptions } from './debugSessionManager'

/**
 * Debug Profile の正本と `debug:start`（Session 6-10）。
 *
 * 保存・fs・catalog・Debug Session はすべて偽物にする（Electron を持ち込まない）。
 * 見ることは:
 *
 * - id を Main が発番し、要求に載った id / 余計な欄を使わないこと
 * - 返るのは今の Workspace の分だけで、key（絶対パス）が一覧に載らないこと
 * - 保存時の検証（欄・相対位置の2段・環境変数）と、起動時の再検証
 * - start に渡るのは解決済みの形で、応答は分類だけであること
 */

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  BrowserWindow: { getAllWindows: () => [] }
}))

const workspaceA: WorkspaceFolder = {
  id: 'ws-a',
  rootPath: 'D:\\proj',
  displayName: 'proj',
  openedAt: 1,
  exists: true
}

const workspaceB: WorkspaceFolder = { ...workspaceA, id: 'ws-b', rootPath: 'D:\\other' }

const draft = {
  name: 'Run app',
  language: 'node',
  programRelativePath: 'src/app.js',
  programArgs: ['--port', '3000'],
  env: { APP_MODE: 'debug' },
  stopOnEntry: false
}

const integratedNode: DebugAdapterCatalogEntry = {
  language: 'node',
  name: 'Mock Adapter',
  integrationStatus: 'integrated',
  adapter: { executable: 'node', args: ['C:\\tools\\mock-adapter.js'] }
}

function harness(overrides: Partial<DebugProfileServiceDependencies> = {}) {
  let workspace: WorkspaceFolder | null = workspaceA
  let counter = 0
  const saved: DebugProfilesDocument[] = []
  const started: DebugSessionStartOptions[] = []
  const logs: string[] = []

  const dependencies: DebugProfileServiceDependencies = {
    getWorkspace: () => workspace,
    readDocument: () => null,
    saveDocument: (document) => {
      saved.push(document)
    },
    createProfileId: () => {
      counter += 1
      return `dp-00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
    },
    now: () => 1000,
    fileSystem: {
      realpath: (path) => {
        const lower = path.toLowerCase()

        if (lower === 'd:\\proj' || lower === 'd:\\other') {
          return path.replace(/^d:/i, 'D:')
        }

        if (lower === 'd:\\proj\\src\\app.js' || lower === 'd:\\other\\src\\app.js') {
          return path
        }

        if (lower === 'd:\\proj\\link\\evil.js') {
          return 'C:\\outside\\evil.js'
        }

        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      isFile: (path) => path.toLowerCase().endsWith('app.js')
    },
    platform: 'win32',
    getParentEnv: () => ({ PATH: 'C:\\nodejs', SystemRoot: 'C:\\Windows' }),
    exists: (path) => path === 'C:\\nodejs\\node.exe',
    getCatalogEntry: () => integratedNode,
    getSessionState: () => 'idle',
    startSession: (options) => {
      started.push(options)
      return { status: 'started', sessionId: 'debug-session-1', generation: 1 }
    },
    log: (_level, message) => {
      logs.push(message)
    },
    ...overrides
  }

  return {
    service: createDebugProfileService(dependencies),
    saved,
    started,
    logs,
    setWorkspace: (next: WorkspaceFolder | null) => {
      workspace = next
    }
  }
}

describe('debug profiles — create / list', () => {
  it('issues the id in Main and returns the saved list', () => {
    const { service, saved } = harness()

    const outcome = service.create(draft)

    expect(outcome).toEqual({
      status: 'saved',
      profile: { profileId: 'dp-00000000-0000-4000-8000-000000000001', ...draft },
      profiles: [{ profileId: 'dp-00000000-0000-4000-8000-000000000001', ...draft }]
    })
    expect(service.list()).toEqual(outcome.status === 'saved' ? outcome.profiles : [])
    expect(saved).toHaveLength(1)
    expect(saved[0].workspaces['D:\\proj'].profiles).toHaveLength(1)
  })

  it('ignores a profileId and extra fields carried by the draft', () => {
    const { service } = harness()

    const outcome = service.create({
      ...draft,
      profileId: 'dp-ffffffff-ffff-4fff-8fff-ffffffffffff',
      cwd: 'C:\\Windows',
      runtimeExecutable: 'C:\\evil.exe',
      adapter: 'C:\\evil.exe'
    })

    expect(outcome.status).toBe('saved')

    if (outcome.status === 'saved') {
      expect(outcome.profile.profileId).toBe('dp-00000000-0000-4000-8000-000000000001')
      expect(Object.keys(outcome.profile).sort()).toEqual(
        [
          'env',
          'language',
          'name',
          'profileId',
          'programArgs',
          'programRelativePath',
          'stopOnEntry'
        ].sort()
      )
    }
  })

  it('returns only the current workspace and never the storage key', () => {
    const { service, setWorkspace } = harness()

    service.create(draft)
    setWorkspace(workspaceB)

    expect(service.list()).toEqual([])

    service.create({ ...draft, name: 'Other' })

    expect(service.list().map((profile) => profile.name)).toEqual(['Other'])
    expect(JSON.stringify(service.list())).not.toContain('D:\\')

    setWorkspace(workspaceA)

    expect(service.list().map((profile) => profile.name)).toEqual(['Run app'])
  })

  it('keeps writes in memory so a list right after a save sees it (debounced store)', () => {
    const { service } = harness({ readDocument: () => null })

    service.create(draft)
    service.create({ ...draft, name: 'Second' })

    expect(service.list().map((profile) => profile.name)).toEqual(['Run app', 'Second'])
  })

  it('reads the stored document once, keyed by the workspace real path', () => {
    const readDocument = vi.fn((): DebugProfilesDocument => ({
      schemaVersion: 1,
      workspaces: {
        'D:\\proj': {
          updatedAt: 1,
          profiles: [{ profileId: 'dp-00000000-0000-4000-8000-00000000000a', ...draft } as never]
        }
      }
    }))
    const { service, setWorkspace } = harness({ readDocument })

    // 開いたときの綴り（小文字）が違っても、realpath で同じ key を引く。
    setWorkspace({ ...workspaceA, rootPath: 'd:\\proj' })

    expect(service.list()).toHaveLength(1)
    service.list()
    expect(readDocument).toHaveBeenCalledTimes(1)
  })

  it('rejects without a workspace', () => {
    const { service, setWorkspace, saved } = harness()

    setWorkspace(null)

    expect(service.list()).toEqual([])
    expect(service.create(draft)).toEqual({ status: 'rejected', reason: 'no-workspace' })
    expect(saved).toEqual([])
  })

  it.each([
    ['a denied env name', { ...draft, env: { PATH: 'C:\\evil' } }, 'env', 'denied-name'],
    [
      'an absolute program',
      { ...draft, programRelativePath: 'C:\\x.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'a program that climbs out',
      { ...draft, programRelativePath: '../x.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'an existing link that points outside',
      { ...draft, programRelativePath: 'link/evil.js' },
      'programRelativePath',
      'outside-workspace'
    ],
    ['an unknown language', { ...draft, language: 'ruby' }, 'language', 'unsupported']
  ])('returns invalid for %s and saves nothing', (_name, raw, field, reason) => {
    const { service, saved } = harness()

    expect(service.create(raw)).toEqual({ status: 'invalid', field, reason })
    expect(saved).toEqual([])
  })

  it('accepts a program that does not exist yet', () => {
    const { service } = harness()

    expect(service.create({ ...draft, programRelativePath: 'src/later.py' }).status).toBe('saved')
  })

  it('stops at the per-workspace limit', () => {
    const { service } = harness()

    for (let i = 0; i < 50; i += 1) {
      expect(service.create({ ...draft, name: `p${i}` }).status).toBe('saved')
    }

    expect(service.create(draft)).toEqual({ status: 'rejected', reason: 'limit-reached' })
  })

  it('refuses to use a malformed or duplicate id from the generator', () => {
    let calls = 0
    const { service } = harness({
      createProfileId: () => {
        calls += 1
        return calls === 1 ? 'not-an-id' : 'dp-00000000-0000-4000-8000-000000000009'
      }
    })

    expect(service.create(draft).status).toBe('saved')
    expect(() => service.create(draft)).toThrow()
  })
})

describe('debug profiles — update / delete', () => {
  it('updates in place and keeps the id', () => {
    const { service } = harness()
    const created = service.create(draft)
    const profileId = created.status === 'saved' ? created.profile.profileId : ''

    const outcome = service.update(profileId, {
      ...draft,
      name: 'Renamed',
      profileId: 'dp-ffffffff-ffff-4fff-8fff-ffffffffffff'
    })

    expect(outcome.status).toBe('saved')
    expect(service.list()).toEqual([{ ...draft, profileId, name: 'Renamed' }])
  })

  it('does not update an id from another workspace', () => {
    const { service, setWorkspace } = harness()
    const created = service.create(draft)
    const profileId = created.status === 'saved' ? created.profile.profileId : ''

    setWorkspace(workspaceB)

    expect(service.update(profileId, draft)).toEqual({
      status: 'rejected',
      reason: 'profile-not-found'
    })
    expect(service.remove(profileId)).toEqual({ status: 'rejected', reason: 'profile-not-found' })
    expect(service.start(profileId)).toEqual({ status: 'rejected', reason: 'profile-not-found' })
  })

  it('validates the update like a create', () => {
    const { service } = harness()
    const created = service.create(draft)
    const profileId = created.status === 'saved' ? created.profile.profileId : ''

    expect(service.update(profileId, { ...draft, env: { NODE_OPTIONS: '--require x' } })).toEqual({
      status: 'invalid',
      field: 'env',
      reason: 'denied-name'
    })
    expect(service.list()[0].env).toEqual({ APP_MODE: 'debug' })
  })

  it('deletes', () => {
    const { service } = harness()
    const created = service.create(draft)
    const profileId = created.status === 'saved' ? created.profile.profileId : ''

    expect(service.remove(profileId)).toEqual({ status: 'deleted', profiles: [] })
    expect(service.list()).toEqual([])
  })
})

describe('debug profiles — start', () => {
  function withProfile(overrides: Partial<DebugProfileServiceDependencies> = {}) {
    const h = harness(overrides)
    const created = h.service.create(draft)
    const profileId = created.status === 'saved' ? created.profile.profileId : ''

    return { ...h, profileId }
  }

  it('starts the session with the resolved configuration and answers only "started"', () => {
    const { service, started, profileId } = withProfile()

    expect(service.start(profileId)).toEqual({ status: 'started' })
    expect(started).toEqual([
      {
        adapterId: 'pwa-node',
        adapterCommand: {
          name: 'Mock Adapter',
          file: 'C:\\nodejs\\node.exe',
          args: ['C:\\tools\\mock-adapter.js'],
          cwd: 'D:\\proj',
          env: { PATH: 'C:\\nodejs', SystemRoot: 'C:\\Windows' }
        },
        launchArguments: {
          name: 'Run app',
          type: 'pwa-node',
          request: 'launch',
          program: 'D:\\proj\\src\\app.js',
          args: ['--port', '3000'],
          cwd: 'D:\\proj',
          env: { APP_MODE: 'debug' },
          stopOnEntry: false,
          console: 'internalConsole'
        }
      }
    ])
  })

  it('is adapter-unavailable with the shipped catalog (no integrated row)', () => {
    const { service, started, profileId } = withProfile({
      getCatalogEntry: () => ({
        language: 'node',
        name: 'Node.js Debug Adapter',
        integrationStatus: 'not-integrated'
      })
    })

    expect(service.start(profileId)).toEqual({ status: 'failed', reason: 'adapter-unavailable' })
    expect(started).toEqual([])
  })

  it('rejects while a session is running, before resolving anything', () => {
    const exists = vi.fn(() => true)
    const { service, started, profileId } = withProfile({
      getSessionState: () => 'running',
      exists
    })

    expect(service.start(profileId)).toEqual({ status: 'rejected', reason: 'already-running' })
    expect(started).toEqual([])
    expect(exists).not.toHaveBeenCalled()
  })

  it('rejects an unknown id and a missing workspace', () => {
    const { service, setWorkspace } = withProfile()

    expect(service.start('dp-00000000-0000-4000-8000-0000000000ff')).toEqual({
      status: 'rejected',
      reason: 'profile-not-found'
    })

    setWorkspace(null)

    expect(service.start('dp-00000000-0000-4000-8000-000000000001')).toEqual({
      status: 'rejected',
      reason: 'no-workspace'
    })
  })

  it('fails with program-not-found when the program is missing at start', () => {
    const h = harness()
    const created = h.service.create({ ...draft, programRelativePath: 'src/later.js' })
    const profileId = created.status === 'saved' ? created.profile.profileId : ''

    expect(h.service.start(profileId)).toEqual({ status: 'failed', reason: 'program-not-found' })
    expect(h.started).toEqual([])
  })

  it('re-checks the environment policy at start (stored data may have been edited)', () => {
    const { service, started } = harness({
      readDocument: () => ({
        schemaVersion: 1,
        workspaces: {
          'D:\\proj': {
            updatedAt: 1,
            profiles: [
              {
                profileId: 'dp-00000000-0000-4000-8000-00000000000a',
                ...draft,
                env: { PYTHONSTARTUP: 'C:\\evil.py' }
              } as never
            ]
          }
        }
      })
    })

    expect(service.start('dp-00000000-0000-4000-8000-00000000000a')).toEqual({
      status: 'failed',
      reason: 'invalid-profile'
    })
    expect(started).toEqual([])
  })

  it('maps spawn failure and already-running from the manager, without the detail', () => {
    const spawnFailed = withProfile({
      startSession: () => ({
        status: 'spawn-failed',
        detail: 'Error: spawn C:\\nodejs\\node.exe ENOENT'
      })
    })

    const outcome = spawnFailed.service.start(spawnFailed.profileId)

    expect(outcome).toEqual({ status: 'failed', reason: 'spawn-failed' })
    expect(JSON.stringify(outcome)).not.toContain('node.exe')
    expect(spawnFailed.logs.join('\n')).toContain('ENOENT')

    const raced = withProfile({
      startSession: () => ({ status: 'already-running', state: 'starting' })
    })

    expect(raced.service.start(raced.profileId)).toEqual({
      status: 'rejected',
      reason: 'already-running'
    })
  })
})
