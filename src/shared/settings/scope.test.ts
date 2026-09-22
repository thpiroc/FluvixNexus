import { describe, expect, it } from 'vitest'
import { emptySettingsSections, type SettingsSections } from './sections'
import {
  getEffectiveSetting,
  isOverriddenInWorkspace,
  isSettingsScope,
  isWorkspaceScopedSection,
  resolveEffectiveSettings,
  SETTINGS_SECTION_SCOPES
} from './scope'

/**
 * どちらの設定が効くか（feature/settings-scope）。
 *
 * Main（最初の1枚の色・Language Server）と Renderer（各機能）の両方がこの関数を通るので、
 * ここで決めた順序がアプリ全体の答えになる。
 */

function sections(partial: Partial<SettingsSections>): SettingsSections {
  return { ...emptySettingsSections(), ...partial }
}

describe('getEffectiveSetting', () => {
  it('ワークスペース設定 → ユーザー設定 → 既定（undefined）の順に探す', () => {
    const user = sections({ terminal: { fontSize: 14, scrollback: 3000 } })
    const workspace = sections({ terminal: { fontSize: 20 } })

    expect(getEffectiveSetting(user, workspace, 'terminal', 'fontSize')).toBe(20)
    expect(getEffectiveSetting(user, workspace, 'terminal', 'scrollback')).toBe(3000)
    expect(getEffectiveSetting(user, workspace, 'editor', 'autoSaveMode')).toBeUndefined()
  })

  it('Workspace を開いていなければユーザー設定だけを見る', () => {
    const user = sections({ appearance: { theme: 'light' } })

    expect(getEffectiveSetting(user, null, 'appearance', 'theme')).toBe('light')
  })

  it('ユーザー設定でしか変えられない section は、ワークスペース側に値があっても使わない', () => {
    const user = sections({ general: { language: 'ja' } })
    const workspace = sections({ general: { language: 'en' } })

    expect(getEffectiveSetting(user, workspace, 'general', 'language')).toBe('ja')
  })
})

describe('resolveEffectiveSettings', () => {
  it('key 単位で重ねる（section ごと置き換えない）', () => {
    const user = sections({
      terminal: { fontSize: 14, scrollback: 3000 },
      appearance: { theme: 'dark' }
    })
    const workspace = sections({ terminal: { fontSize: 20 } })

    const effective = resolveEffectiveSettings(user, workspace)

    expect(effective.terminal).toEqual({ fontSize: 20, scrollback: 3000 })
    expect(effective.appearance).toEqual({ theme: 'dark' })
  })

  it('ワークスペース設定が空ならユーザー設定そのもの（同じ object）', () => {
    const user = sections({ editor: { autoSaveMode: 'afterDelay' } })

    const effective = resolveEffectiveSettings(user, sections({}))

    expect(effective.editor).toBe(user.editor)
    expect(resolveEffectiveSettings(user, null).editor).toBe(user.editor)
  })

  it('application の section は重ねない', () => {
    const user = sections({ general: { language: 'ja' } })

    expect(
      resolveEffectiveSettings(user, sections({ general: { language: 'en' } })).general
    ).toEqual({
      language: 'ja'
    })
  })

  it('中身の変わらない section は前回と同じ object を返す', () => {
    const user = sections({ terminal: { fontSize: 14 } })
    const workspace = sections({ editor: { autoSaveMode: 'off' } })
    const first = resolveEffectiveSettings(user, workspace)

    const nextUser = { ...user, terminal: { fontSize: 15 } }
    const second = resolveEffectiveSettings(nextUser, { ...workspace }, first)

    expect(second.editor).toBe(first.editor)
    expect(second.terminal).not.toBe(first.terminal)
    expect(second.terminal).toEqual({ fontSize: 15 })
  })
})

describe('scope の判定', () => {
  it('表示言語だけがユーザー設定専用', () => {
    expect(isWorkspaceScopedSection('general')).toBe(false)

    for (const id of ['appearance', 'editor', 'lsp', 'files', 'terminal'] as const) {
      expect(isWorkspaceScopedSection(id)).toBe(true)
    }
  })

  it('scope の名前は2つだけ', () => {
    expect(isSettingsScope('user')).toBe(true)
    expect(isSettingsScope('workspace')).toBe(true)
    expect(isSettingsScope('folder')).toBe(false)
    expect(isSettingsScope(undefined)).toBe(false)
  })

  it('上書きされているかは、その項目の key のどれかがあるかで決まる', () => {
    const workspace = sections({ lsp: { pythonEnabled: false } })

    expect(isOverriddenInWorkspace(workspace, 'lsp', ['typescriptEnabled', 'pythonEnabled'])).toBe(
      true
    )
    expect(isOverriddenInWorkspace(workspace, 'lsp', ['enabled'])).toBe(false)
    expect(isOverriddenInWorkspace(null, 'lsp', ['pythonEnabled'])).toBe(false)
  })
})

/*
  Security（FN Agent の Permission）は `workspace > user` ではなく、常に厳しい方を採る
  （Security Core v1 の STEP1）。Renderer が画面に出す効く値も、Main の Policy と同じ答えになる。
*/
describe('security（restrictive）', () => {
  it('ワークスペース設定で変えられるが、種類は restrictive', () => {
    expect(isWorkspaceScopedSection('security')).toBe(true)
    expect(SETTINGS_SECTION_SCOPES.security).toBe('restrictive')
  })

  it('User Read + Workspace Ask → Read（ワークスペースから緩められない）', () => {
    const user = sections({ security: { permissionMode: 'read' } })
    const workspace = sections({ security: { permissionMode: 'ask' } })

    expect(resolveEffectiveSettings(user, workspace).security).toEqual({ permissionMode: 'read' })
    expect(getEffectiveSetting(user, workspace, 'security', 'permissionMode')).toBe('read')
  })

  it('User Ask + Workspace Read → Read', () => {
    const user = sections({ security: { permissionMode: 'ask' } })
    const workspace = sections({ security: { permissionMode: 'read' } })

    expect(resolveEffectiveSettings(user, workspace).security).toEqual({ permissionMode: 'read' })
    expect(getEffectiveSetting(user, workspace, 'security', 'permissionMode')).toBe('read')
  })

  it('User Ask + Workspace Ask → Ask、User Read + Workspace Read → Read', () => {
    const askBoth = sections({ security: { permissionMode: 'ask' } })
    const readBoth = sections({ security: { permissionMode: 'read' } })

    expect(getEffectiveSetting(askBoth, askBoth, 'security', 'permissionMode')).toBe('ask')
    expect(getEffectiveSetting(readBoth, readBoth, 'security', 'permissionMode')).toBe('read')
  })

  it('User が未設定（既定 Ask）でも、Workspace の Read は効く', () => {
    const workspace = sections({ security: { permissionMode: 'read' } })

    expect(getEffectiveSetting(sections({}), workspace, 'security', 'permissionMode')).toBe('read')
  })

  it('Workspace の上書きが無ければ User の section がそのまま（同じ object）', () => {
    const user = sections({ security: { permissionMode: 'read' } })

    expect(resolveEffectiveSettings(user, sections({})).security).toBe(user.security)
    expect(resolveEffectiveSettings(user, null).security).toBe(user.security)
  })

  it('Workspace 側の読めない値は Read へ倒れる（緩む側へは倒れない）', () => {
    const user = sections({ security: { permissionMode: 'ask' } })
    const workspace = sections({ security: { permissionMode: 'auto' } })

    expect(getEffectiveSetting(user, workspace, 'security', 'permissionMode')).toBe('read')
  })

  it('他の section の重ね方（workspace > user）は変わらない', () => {
    const user = sections({ terminal: { fontSize: 14 }, security: { permissionMode: 'read' } })
    const workspace = sections({ terminal: { fontSize: 20 }, security: { permissionMode: 'ask' } })
    const effective = resolveEffectiveSettings(user, workspace)

    expect(effective.terminal).toEqual({ fontSize: 20 })
    expect(effective.security).toEqual({ permissionMode: 'read' })
  })
})
