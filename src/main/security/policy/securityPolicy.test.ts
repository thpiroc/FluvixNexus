import { mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isSettingsScope, SETTINGS_SCHEMA_VERSION } from '@shared/settings'
import { parseSettingsSectionUpdate } from '../../store/settingsSections'
import { createSettingsStore, SETTINGS_FILE_NAME } from '../../store/settingsStore'
import {
  createWorkspaceSettingsStore,
  WORKSPACE_SETTINGS_FILE_NAME
} from '../../store/workspaceSettingsStore'
import { FAIL_CLOSED_SECURITY_POLICY, resolveSecurityPolicy } from './securityPolicy'

/**
 * Security Policy の組み立て（Security Core v1 の STEP1）。
 *
 * 後半は**実際の store**（一時フォルダ）を通して、Main が持つ値から Policy が決まること、
 * Renderer から届く保存要求で Policy を緩められないことを確かめる。
 * 保存要求の検証は ipc/handlers/settings.ts と同じ順（形 → scope）で通す。
 */

describe('resolveSecurityPolicy', () => {
  it('既定（どちらも未設定）は Ask', () => {
    expect(resolveSecurityPolicy(undefined, null)).toEqual({ permissionMode: 'ask' })
    expect(resolveSecurityPolicy({}, {})).toEqual({ permissionMode: 'ask' })
  })

  it('User / Workspace の4通り（strictest）', () => {
    const cases = [
      ['ask', 'ask', 'ask'],
      ['ask', 'read', 'read'],
      ['read', 'ask', 'read'],
      ['read', 'read', 'read']
    ] as const

    for (const [user, workspace, expected] of cases) {
      expect(
        resolveSecurityPolicy({ permissionMode: user }, { permissionMode: workspace })
      ).toEqual({ permissionMode: expected })
    }
  })

  it('不正な値は Read', () => {
    expect(resolveSecurityPolicy({ permissionMode: 'auto' }, null)).toEqual({
      permissionMode: 'read'
    })
    expect(
      resolveSecurityPolicy({ permissionMode: 42 as unknown as string }, null).permissionMode
    ).toBe('read')
  })

  it('Policy に入るのは Permission だけ（規則を止める欄が無い）', () => {
    expect(Object.keys(resolveSecurityPolicy({ permissionMode: 'ask' }, null))).toEqual([
      'permissionMode'
    ])
  })

  it('返す Policy は凍結されている', () => {
    const policy = resolveSecurityPolicy({ permissionMode: 'read' }, null)

    expect(Object.isFrozen(policy)).toBe(true)
    expect(() => {
      ;(policy as { permissionMode: string }).permissionMode = 'ask'
    }).toThrow(TypeError)
    expect(Object.isFrozen(FAIL_CLOSED_SECURITY_POLICY)).toBe(true)
    expect(FAIL_CLOSED_SECURITY_POLICY.permissionMode).toBe('read')
  })
})

const WORKSPACE = 'D:\\work\\project-a'

let directory: string

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'fx-security-policy-')))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** Main の2つの store と、それを材料にした Policy。 */
function stores() {
  const user = createSettingsStore(directory)
  const workspace = createWorkspaceSettingsStore(directory)

  return {
    user,
    workspace,
    policy: () => resolveSecurityPolicy(user.read().security, workspace.read(WORKSPACE).security)
  }
}

/** Renderer から届いた保存要求を、settings ハンドラと同じ検証に通してから保存する。 */
function saveFromRenderer(target: ReturnType<typeof stores>, raw: unknown): 'saved' | 'rejected' {
  const update = parseSettingsSectionUpdate(raw)
  const scope = typeof raw === 'object' && raw !== null ? (raw as { scope?: unknown }).scope : null

  if (update === null || !isSettingsScope(scope)) {
    return 'rejected'
  }

  if (scope === 'user') {
    target.user.saveSection(update)
  } else {
    target.workspace.saveSection(WORKSPACE, update)
  }

  return 'saved'
}

describe('Main の store から決まる Policy', () => {
  it('何も保存されていなければ Ask', () => {
    expect(stores().policy()).toEqual({ permissionMode: 'ask' })
  })

  it('User Read のとき、Workspace へ Ask を保存しても Read のまま', () => {
    const target = stores()

    expect(
      saveFromRenderer(target, {
        scope: 'user',
        section: 'security',
        value: { permissionMode: 'read' }
      })
    ).toBe('saved')
    expect(
      saveFromRenderer(target, {
        scope: 'workspace',
        workspaceId: 'ws-a',
        section: 'security',
        value: { permissionMode: 'ask' }
      })
    ).toBe('saved')

    expect(target.policy()).toEqual({ permissionMode: 'read' })
  })

  it('User Ask のとき、Workspace で Read にできる', () => {
    const target = stores()

    saveFromRenderer(target, {
      scope: 'workspace',
      workspaceId: 'ws-a',
      section: 'security',
      value: { permissionMode: 'read' }
    })

    expect(target.policy()).toEqual({ permissionMode: 'read' })
  })

  it('不正な値の保存要求は拒まれ、Policy は変わらない', () => {
    const target = stores()

    saveFromRenderer(target, {
      scope: 'user',
      section: 'security',
      value: { permissionMode: 'read' }
    })

    for (const permissionMode of ['auto', 'allow', 'ASK', 1, true, null]) {
      for (const scope of ['user', 'workspace']) {
        expect(
          saveFromRenderer(target, {
            scope,
            workspaceId: 'ws-a',
            section: 'security',
            value: { permissionMode }
          })
        ).toBe('rejected')
      }
    }

    expect(target.user.read().security).toEqual({ permissionMode: 'read' })
    expect(target.policy()).toEqual({ permissionMode: 'read' })
  })

  it('保存した値は再起動（store の作り直し）後も同じ Policy になる', () => {
    const first = stores()

    saveFromRenderer(first, {
      scope: 'user',
      section: 'security',
      value: { permissionMode: 'read' }
    })
    first.user.flush()

    expect(stores().policy()).toEqual({ permissionMode: 'read' })
  })

  it('ファイルに書かれた旧値・不正な値は Read として読む', async () => {
    for (const permissionMode of ['auto', 'allow', 42, true, null, { mode: 'ask' }]) {
      await writeFile(
        join(directory, SETTINGS_FILE_NAME),
        JSON.stringify({
          schemaVersion: SETTINGS_SCHEMA_VERSION,
          sections: { security: { permissionMode } }
        }),
        'utf8'
      )

      expect(stores().policy()).toEqual({ permissionMode: 'read' })
    }
  })

  it('User の settings.json が壊れていれば Read', async () => {
    for (const text of [
      '{ not json',
      '42',
      '{"schemaVersion":"x"}',
      '{"schemaVersion":1,"sections":1}'
    ]) {
      await writeFile(join(directory, SETTINGS_FILE_NAME), text, 'utf8')

      expect(stores().policy()).toEqual({ permissionMode: 'read' })
    }
  })

  it('Workspace の欄の不正な値は Read（User が Ask でも）', async () => {
    await writeFile(
      join(directory, WORKSPACE_SETTINGS_FILE_NAME),
      JSON.stringify({
        schemaVersion: 1,
        workspaces: {
          [WORKSPACE]: {
            updatedAt: 1,
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            sections: { security: { permissionMode: 7 } }
          }
        }
      }),
      'utf8'
    )

    expect(stores().policy()).toEqual({ permissionMode: 'read' })
  })

  it('Workspace の設定ファイルが丸ごと読めなくても、User より緩くはならない', async () => {
    await writeFile(join(directory, WORKSPACE_SETTINGS_FILE_NAME), '{ not json', 'utf8')

    const target = stores()
    saveFromRenderer(target, {
      scope: 'user',
      section: 'security',
      value: { permissionMode: 'read' }
    })

    expect(target.policy()).toEqual({ permissionMode: 'read' })
  })
})
