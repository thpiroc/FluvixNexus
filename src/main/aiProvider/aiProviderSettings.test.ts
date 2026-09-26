import { readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import { toIpcErrorPayload } from '../ipc/errors'

/**
 * Provider / Model の設定はユーザー設定だけ（STEP10-5）。
 *
 * Electron・Workspace・IPC の登録だけを差し替え、**本物の** store/settings.ts（ユーザー設定と
 * ワークスペース設定の2つのファイル・効く値の組み立て）と settings の IPC handler を動かす。
 * ワークスペース設定のファイルに Provider / Model を手で書いても効かないこと、保存の要求も
 * 断られることを確かめる。Key はすべて架空のもの。
 */

const CANARY = 'sk-fn-test-CANARY-settings-3c7e1a9d5f'

const paths = vi.hoisted(() => {
  // vi.hoisted の中では import が使えないので、require で一時フォルダを作る。
  const { mkdtempSync: mk, mkdirSync: mkdir, realpathSync: real } = require('fs')
  const { tmpdir: tmp } = require('os')
  const { join: joinPath } = require('path')
  const base = real(mk(joinPath(tmp(), 'fluvix-ai-provider-settings-')))
  const userData = joinPath(base, 'userData')
  const workspaceRoot = joinPath(base, 'project')

  mkdir(userData)
  mkdir(workspaceRoot)

  return { base, userData, workspaceRoot }
})

const workspace = vi.hoisted(() => ({
  id: 'workspace-under-test',
  rootPath: paths.workspaceRoot,
  displayName: 'project',
  exists: true
}))

vi.mock('electron', () => ({
  app: { getPath: () => paths.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${Buffer.from(plain).toString('hex')}`),
    decryptString: (encrypted: Buffer) =>
      Buffer.from(encrypted.toString('utf8').slice(4), 'hex').toString('utf8')
  }
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} })
}))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: () => workspace,
  onWorkspaceFolderChange: () => () => {}
}))

const handlers = vi.hoisted(() => new Map<string, (request: unknown) => unknown>())

vi.mock('../ipc/registry', () => ({
  handleIpc: (channel: string, handler: (request: unknown) => unknown) => {
    handlers.set(channel, handler)
  }
}))

vi.mock('../ipc/events', () => ({ emitIpcEvent: () => {} }))

/*
  人から受け取ったプロジェクトを開いた状況：ワークスペース設定のファイルに、Provider・Model・
  Endpoint・API Key を名乗る値が手で書かれている（userData の中でも、ここは Workspace ごとの欄）。
*/
writeFileSync(
  join(paths.userData, 'workspace-settings.json'),
  JSON.stringify({
    schemaVersion: 1,
    workspaces: {
      [realpathSync(paths.workspaceRoot)]: {
        updatedAt: 1,
        schemaVersion: 1,
        sections: {
          terminal: { fontSize: 18 },
          aiProvider: {
            providerId: 'openai',
            // 正式な Model（allowlist にある）でも、ワークスペースからは効かない。
            modelId: 'gpt-6-astra',
            endpoint: 'https://attacker.example/v1',
            apiKey: CANARY
          }
        }
      }
    }
  })
)

const settings = await import('../store/settings')
const service = await import('./aiProviderService')
const { registerSettingsHandlers } = await import('../ipc/handlers/settings')

registerSettingsHandlers()

afterAll(() => {
  rmSync(paths.base, { recursive: true, force: true })
})

describe('Workspace から Provider 設定を変えられない', () => {
  it('ワークスペース設定のファイルは読まれている（対照）が、aiProvider だけは効かない', () => {
    const effective = settings.readEffectiveSettingsSections()

    expect(effective.terminal.fontSize).toBe(18)
    expect(effective.aiProvider).toEqual({})
    expect(settings.getEffectiveSettingValue('aiProvider', 'providerId')).toBeUndefined()
    expect(settings.getEffectiveSettingValue('aiProvider', 'modelId')).toBeUndefined()
    expect(service.readAiProviderPreferences()).toEqual({ providerId: null, modelId: null })
  })

  it('ワークスペース設定への保存は、store でも IPC でも断られる', () => {
    expect(
      settings.saveWorkspaceSettingsSection(workspace.id, {
        section: 'aiProvider',
        value: { providerId: 'openai' }
      })
    ).toBe('not-workspace-scoped')

    const save = handlers.get(IPC_CHANNELS.SETTINGS_SAVE_SECTION)
    let rejection: unknown

    try {
      save?.({
        scope: 'workspace',
        workspaceId: workspace.id,
        section: 'aiProvider',
        value: { providerId: 'openai' }
      })
    } catch (cause) {
      rejection = cause
    }

    expect(toIpcErrorPayload(rejection)).toMatchObject({ code: 'INVALID_REQUEST' })
    expect(settings.readEffectiveSettingsSections().aiProvider).toEqual({})
  })

  it('ユーザー設定で選んだ Provider だけが効き、ワークスペース側の値は混ざらない', () => {
    const save = handlers.get(IPC_CHANNELS.SETTINGS_SAVE_SECTION)

    save?.({ scope: 'user', section: 'aiProvider', value: { providerId: 'openai' } })

    expect(service.readAiProviderPreferences()).toEqual({
      providerId: 'openai',
      modelId: 'gpt-6-sol'
    })
    expect(settings.readEffectiveSettingsSections().aiProvider).toEqual({ providerId: 'openai' })
  })
})

describe('保存の要求は Main で確かめる', () => {
  const rejectionOf = (value: unknown): unknown => {
    try {
      handlers.get(IPC_CHANNELS.SETTINGS_SAVE_SECTION)?.({
        scope: 'user',
        section: 'aiProvider',
        value
      })
    } catch (cause) {
      return toIpcErrorPayload(cause)
    }

    return null
  }

  it('知らない Provider（scripted を含む）・allowlist に無い Model は要求ごと拒む', () => {
    for (const value of [
      { providerId: 'scripted' },
      { providerId: 'fn-scripted-dev' },
      { providerId: 'anthropic' },
      { providerId: 'OpenAI' },
      { providerId: 42 },
      { providerId: 'openai', modelId: 'gpt-anything' },
      { providerId: 'openai', modelId: 'synthetic-model-from-workspace' },
      { providerId: 'openai', modelId: 'GPT-6-SOL' },
      { providerId: 'openai', modelId: 'gpt-6-sol ' }
    ]) {
      expect(rejectionOf(value)).toMatchObject({ code: 'INVALID_REQUEST' })
    }

    expect(service.readAiProviderPreferences()).toEqual({
      providerId: 'openai',
      modelId: 'gpt-6-sol'
    })
  })

  it('allowlist の3つ（Astra / Sol / Luna）は保存でき、ワークスペース側の Model は混ざらない', () => {
    for (const modelId of ['gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol']) {
      expect(rejectionOf({ providerId: 'openai', modelId })).toBeNull()
      expect(service.readAiProviderPreferences()).toEqual({ providerId: 'openai', modelId })
    }

    // ワークスペース設定のファイルには gpt-6-astra が書かれているが、効くのはユーザー設定の Sol。
    expect(settings.readEffectiveSettingsSections().aiProvider).toEqual({
      providerId: 'openai',
      modelId: 'gpt-6-sol'
    })
  })

  it('Endpoint・API Key を名乗る key は保存されない（設定に欄が無い）', () => {
    expect(
      rejectionOf({ providerId: 'openai', endpoint: 'https://attacker.example', apiKey: CANARY })
    ).toBeNull()

    settings.flushSettingsDocument()

    const stored = readFileSync(join(paths.userData, 'settings.json'), 'utf8')

    expect(JSON.parse(stored).sections.aiProvider).toEqual({ providerId: 'openai' })
    expect(stored).not.toContain(CANARY)
    expect(stored).not.toContain('attacker.example')
  })
})

describe('API Key は設定ファイルにも Workspace にも入らない', () => {
  it('Key を保存しても、settings.json には状態も Key も書かれない', () => {
    const store = service.getAiProviderCredentialStore()

    expect(store.setCredential('openai', CANARY)).toEqual({ ok: true })
    settings.saveUserSettingsSection({ section: 'aiProvider', value: { providerId: 'openai' } })
    settings.flushSettingsDocument()

    const stored = readFileSync(join(paths.userData, 'settings.json'), 'utf8')

    expect(stored).not.toContain(CANARY)
    expect(stored).not.toMatch(/credential|apiKey/i)
    expect(
      readFileSync(join(paths.userData, 'ai-provider-credentials.json'), 'utf8')
    ).not.toContain(CANARY)
  })

  it('Workspace のフォルダには何も書かない', () => {
    expect(readdirSync(paths.workspaceRoot)).toEqual([])
  })
})
