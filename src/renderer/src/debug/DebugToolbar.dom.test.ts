/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DebugProfile, DebugSessionStatus } from '@shared/debug'
import { CommandProvider } from '../commands/CommandProvider'
import { useCommands, type CommandRegistryController } from '../commands/context'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { DebugProvider } from './DebugProvider'
import { DebugToolbar } from './DebugToolbar'

const debugApi = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  start: vi.fn(),
  continue: vi.fn(),
  pause: vi.fn(),
  stepOver: vi.fn(),
  stepInto: vi.fn(),
  stepOut: vi.fn(),
  stop: vi.fn(),
  getStatus: vi.fn(),
  onStatusChanged: vi.fn()
}))

vi.mock('../api/fluvix', () => ({ fluvix: { debug: debugApi } }))

const PROFILE_A: DebugProfile = {
  profileId: 'dp-11111111-1111-1111-1111-111111111111',
  name: 'Launch app',
  language: 'node',
  programRelativePath: 'src/app.ts',
  programArgs: ['--port', '3000'],
  env: { APP_ENV: 'dev' },
  stopOnEntry: false
}

const PROFILE_B: DebugProfile = {
  profileId: 'dp-22222222-2222-2222-2222-222222222222',
  name: 'Worker',
  language: 'python',
  programRelativePath: 'tools/worker.py',
  programArgs: [],
  env: {},
  stopOnEntry: true
}

let container: HTMLDivElement
let root: Root
let listeners: ((event: { status: unknown }) => void)[] = []
let commands: CommandRegistryController | null = null

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  vi.clearAllMocks()
  listeners = []
  commands = null
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  debugApi.listProfiles.mockResolvedValue({ ok: true, data: { profiles: [PROFILE_A, PROFILE_B] } })
  debugApi.getStatus.mockResolvedValue({ ok: true, data: { status: 'idle' } })
  debugApi.onStatusChanged.mockImplementation((listener: (event: { status: unknown }) => void) => {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((entry) => entry !== listener)
    }
  })
  debugApi.createProfile.mockResolvedValue({
    ok: true,
    data: { status: 'saved', profile: PROFILE_A, profiles: [PROFILE_A] }
  })
  debugApi.updateProfile.mockResolvedValue({
    ok: true,
    data: {
      status: 'saved',
      profile: { ...PROFILE_A, name: 'Updated' },
      profiles: [{ ...PROFILE_A, name: 'Updated' }]
    }
  })
  debugApi.deleteProfile.mockResolvedValue({
    ok: true,
    data: { status: 'deleted', profiles: [PROFILE_B] }
  })
  debugApi.start.mockResolvedValue({ ok: true, data: { status: 'started' } })
  debugApi.continue.mockResolvedValue({ ok: true, data: { status: 'accepted', state: 'running' } })
  debugApi.pause.mockResolvedValue({ ok: true, data: { status: 'accepted', state: 'stopped' } })
  debugApi.stepOver.mockResolvedValue({ ok: true, data: { status: 'accepted', state: 'running' } })
  debugApi.stepInto.mockResolvedValue({ ok: true, data: { status: 'accepted', state: 'running' } })
  debugApi.stepOut.mockResolvedValue({ ok: true, data: { status: 'accepted', state: 'running' } })
  debugApi.stop.mockResolvedValue({ ok: true, data: { status: 'accepted', state: 'idle' } })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

function workspace(id = 'w1'): WorkspaceFolderController {
  return {
    status: 'ready',
    workspace: {
      id,
      rootPath: 'D:\\project',
      displayName: 'project',
      exists: true,
      openedAt: 0
    },
    unavailableRootPath: null,
    error: null,
    busy: false,
    openFolder: vi.fn(),
    closeWorkspace: vi.fn()
  }
}

function Probe(): null {
  commands = useCommands()
  return null
}

function registry(): CommandRegistryController {
  if (commands === null) {
    throw new Error('CommandProvider probe is not mounted.')
  }

  return commands
}

async function renderToolbar(
  status: DebugSessionStatus = 'idle',
  options: { readonly showToolbar?: boolean; readonly workspace?: WorkspaceFolderController } = {}
): Promise<void> {
  debugApi.getStatus.mockResolvedValue({ ok: true, data: { status } })
  const showToolbar = options.showToolbar ?? true

  const tree: ReactElement = createElement(
    I18nContext.Provider,
    { value: { language: 'en', setLanguage: () => {}, t: createTranslator('en') } },
    createElement(
      CommandProvider,
      null,
      createElement(Probe),
      createElement(
        WorkspaceFolderContext.Provider,
        { value: options.workspace ?? workspace() },
        createElement(DebugProvider, null, showToolbar ? createElement(DebugToolbar) : null)
      )
    )
  )

  await act(async () => {
    root.render(tree)
  })
}

async function publish(status: DebugSessionStatus): Promise<void> {
  await act(async () => {
    for (const listener of [...listeners]) {
      listener({ status })
    }
  })
}

function byTestId<T extends HTMLElement = HTMLElement>(testId: string): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`)
  expect(element, testId).not.toBeNull()
  return element as T
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    byTestId<HTMLButtonElement>(testId).click()
  })
}

async function input(testId: string, value: string): Promise<void> {
  await act(async () => {
    const element = byTestId<HTMLInputElement | HTMLTextAreaElement>(testId)
    const descriptor = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    )

    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function select(testId: string, value: string): Promise<void> {
  await act(async () => {
    const element = byTestId<HTMLSelectElement>(testId)
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')

    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function executeCommand(
  id: Parameters<CommandRegistryController['execute']>[0]
): Promise<void> {
  await act(async () => {
    expect(registry().execute(id)).toBe(true)
  })
}

describe('DebugToolbar', () => {
  it('Profile selector は名前と言語だけを表示し、raw path / adapter 情報を描画しない', async () => {
    await renderToolbar()

    const selector = byTestId<HTMLSelectElement>('debug-profile-selector')

    expect(selector.textContent).toContain('Launch app (Node.js)')
    expect(selector.textContent).toContain('Worker (Python)')
    expect(container.textContent).not.toContain('src/app.ts')
    expect(container.textContent).not.toContain('D:\\project')
    expect(container.textContent).not.toContain('node.exe')
    expect(container.textContent).not.toContain('adapter')
  })

  it('状態ごとにボタンと command 登録が同じ enabled になる', async () => {
    await renderToolbar('idle')

    expect(byTestId<HTMLButtonElement>('debug-action-start').disabled).toBe(false)
    expect(registry().isRegistered('debug.start')).toBe(true)
    expect(registry().isRegistered('debug.startOrContinue')).toBe(true)

    await publish('running')
    expect(byTestId<HTMLButtonElement>('debug-action-start').disabled).toBe(true)
    expect(byTestId<HTMLButtonElement>('debug-action-pause').disabled).toBe(false)
    expect(byTestId<HTMLButtonElement>('debug-action-stop').disabled).toBe(false)
    expect(registry().isRegistered('debug.pause')).toBe(true)
    expect(registry().isRegistered('debug.stepOver')).toBe(false)

    await publish('stopped')
    expect(byTestId<HTMLButtonElement>('debug-action-continue').disabled).toBe(false)
    expect(byTestId<HTMLButtonElement>('debug-action-stepOver').disabled).toBe(false)
    expect(byTestId<HTMLButtonElement>('debug-action-stepInto').disabled).toBe(false)
    expect(byTestId<HTMLButtonElement>('debug-action-stepOut').disabled).toBe(false)
    expect(byTestId<HTMLButtonElement>('debug-action-stop').disabled).toBe(false)
    expect(registry().isRegistered('debug.continue')).toBe(true)
    expect(registry().isRegistered('debug.startOrContinue')).toBe(true)

    await publish('terminating')
    for (const id of ['start', 'continue', 'pause', 'stepOver', 'stepInto', 'stepOut', 'stop']) {
      expect(byTestId<HTMLButtonElement>(`debug-action-${id}`).disabled, id).toBe(true)
    }
    expect(registry().isRegistered('debug.startOrContinue')).toBe(false)
  })

  it('Start は profileId だけを debug:start へ渡す', async () => {
    await renderToolbar('idle')

    await click('debug-action-start')

    expect(debugApi.start).toHaveBeenCalledWith({
      profileId: 'dp-11111111-1111-1111-1111-111111111111'
    })
  })

  it('F5 用 command は idle では Start、stopped では Continue を既存操作として呼ぶ', async () => {
    await renderToolbar('idle')

    await executeCommand('debug.startOrContinue')
    expect(debugApi.start).toHaveBeenCalledWith({
      profileId: 'dp-11111111-1111-1111-1111-111111111111'
    })

    await publish('stopped')

    await executeCommand('debug.startOrContinue')
    expect(debugApi.continue).toHaveBeenCalledTimes(1)
  })

  it('Profile 選択は Debug Panel の unmount/remount を越えて維持され、F5 はその Profile を使う', async () => {
    await renderToolbar('idle')
    await select('debug-profile-selector', PROFILE_B.profileId)

    await renderToolbar('idle', { showToolbar: false })

    expect(registry().isRegistered('debug.startOrContinue')).toBe(true)
    await executeCommand('debug.startOrContinue')
    expect(debugApi.start).toHaveBeenCalledWith({
      profileId: PROFILE_B.profileId
    })

    await renderToolbar('idle')
    expect(byTestId<HTMLSelectElement>('debug-profile-selector').value).toBe(PROFILE_B.profileId)
  })

  it('Debug Panel が unmount されても実行制御 command は登録されたまま残る', async () => {
    await renderToolbar('stopped', { showToolbar: false })

    for (const id of [
      'debug.startOrContinue',
      'debug.continue',
      'debug.stepOver',
      'debug.stepInto',
      'debug.stepOut',
      'debug.stop'
    ] as const) {
      expect(registry().isRegistered(id), id).toBe(true)
    }

    await executeCommand('debug.startOrContinue')
    await executeCommand('debug.stepOver')
    await executeCommand('debug.stepInto')
    await executeCommand('debug.stepOut')
    await executeCommand('debug.stop')

    expect(debugApi.continue).toHaveBeenCalledTimes(1)
    expect(debugApi.stepOver).toHaveBeenCalledTimes(1)
    expect(debugApi.stepInto).toHaveBeenCalledTimes(1)
    expect(debugApi.stepOut).toHaveBeenCalledTimes(1)
    expect(debugApi.stop).toHaveBeenCalledTimes(1)
  })

  it('Workspace が切り替わると別 Workspace の Profile 選択を引き継がない', async () => {
    const profileC: DebugProfile = {
      ...PROFILE_A,
      profileId: 'dp-33333333-3333-3333-3333-333333333333',
      name: 'Workspace 2'
    }

    debugApi.listProfiles
      .mockResolvedValueOnce({ ok: true, data: { profiles: [PROFILE_A, PROFILE_B] } })
      .mockResolvedValueOnce({ ok: true, data: { profiles: [profileC] } })

    await renderToolbar('idle')
    await select('debug-profile-selector', PROFILE_B.profileId)

    await renderToolbar('idle', { workspace: workspace('w2') })

    expect(byTestId<HTMLSelectElement>('debug-profile-selector').value).toBe(profileC.profileId)

    await click('debug-action-start')
    expect(debugApi.start).toHaveBeenCalledWith({
      profileId: profileC.profileId
    })
  })

  it('Profile を作成できる', async () => {
    await renderToolbar()
    await click('debug-add-profile')

    await input('debug-profile-name', 'New profile')
    await select('debug-profile-language', 'python')
    await input('debug-profile-program', 'tools/run.py')
    await input('debug-profile-args', '--one\n--literal && no-shell')
    await input('debug-profile-env', 'APP_ENV=test')
    await click('debug-profile-save')

    expect(debugApi.createProfile).toHaveBeenCalledWith({
      profile: {
        name: 'New profile',
        language: 'python',
        programRelativePath: 'tools/run.py',
        programArgs: ['--one', '--literal && no-shell'],
        env: { APP_ENV: 'test' },
        stopOnEntry: false
      }
    })
    expect(container.textContent).toContain('Profile saved.')
  })

  it('Profile を更新できる', async () => {
    await renderToolbar()
    await click('debug-edit-profile')
    await input('debug-profile-name', 'Updated')
    await click('debug-profile-save')

    expect(debugApi.updateProfile).toHaveBeenCalledWith({
      profileId: 'dp-11111111-1111-1111-1111-111111111111',
      profile: expect.objectContaining({ name: 'Updated' })
    })
  })

  it('Profile を削除できる', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderToolbar()
    await click('debug-edit-profile')
    await click('debug-profile-delete')

    expect(debugApi.deleteProfile).toHaveBeenCalledWith({
      profileId: 'dp-11111111-1111-1111-1111-111111111111'
    })
    expect(byTestId<HTMLSelectElement>('debug-profile-selector').value).toBe(PROFILE_B.profileId)
    expect(container.textContent).toContain('Profile deleted.')
  })

  it('validation failure を Debug Panel 内に表示する', async () => {
    debugApi.createProfile.mockResolvedValue({
      ok: true,
      data: { status: 'invalid', field: 'programRelativePath', reason: 'invalid-path' }
    })

    await renderToolbar()
    await click('debug-add-profile')
    await input('debug-profile-name', 'Broken')
    await input('debug-profile-program', '..\\outside.js')
    await click('debug-profile-save')

    expect(container.textContent).toContain('Enter a Workspace-relative program path.')
  })

  it('unavailable では Start できず、adapter 未利用を自然に示す', async () => {
    await renderToolbar('unavailable')

    expect(byTestId<HTMLButtonElement>('debug-action-start').disabled).toBe(true)
    expect(container.textContent).toContain('No debug adapter is available on this machine.')
    expect(registry().isRegistered('debug.start')).toBe(false)
    expect(registry().isRegistered('debug.startOrContinue')).toBe(false)
  })

  it('toolbar は accessible な toolbar と labeled controls を持つ', async () => {
    await renderToolbar()

    expect(container.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe(
      'Debug toolbar'
    )
    expect(byTestId('debug-action-stepInto').getAttribute('aria-label')).toBe('Step Into')
    expect(byTestId('debug-profile-selector').closest('label')?.textContent).toContain(
      'Debug Profile'
    )
  })
})
