import { describe, expect, it } from 'vitest'
import { listCommands } from '../commands/registry'
import { commandTitle } from '../commands/types'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { resolveKeybindings, type KeybindingRule } from './resolve'
import { buildShortcutRows } from './shortcutRows'

const title = (descriptor: Parameters<typeof commandTitle>[0]): string =>
  commandTitle(descriptor, (key) => key)

function rows(rules: readonly KeybindingRule[] = DEFAULT_KEYBINDINGS) {
  return buildShortcutRows(listCommands(), resolveKeybindings(rules).entries, title)
}

describe('buildShortcutRows', () => {
  it('割り当ての無い command も並べる（そこで打鍵を付けられるように）', () => {
    const unbound = rows().filter((row) => row.keybinding === null)

    expect(unbound.map((row) => row.commandId)).toContain('view.resetLayout')
    expect(unbound.map((row) => row.commandId)).toContain('settings.close')

    for (const row of unbound) {
      expect(row.source).toBeNull()
      expect(row.when).toEqual([])
      expect(row.isModified).toBe(false)
    }
  })

  it('登録されている command が1つ残らず出る', () => {
    const ids = new Set(rows().map((row) => row.commandId))

    expect(ids.size).toBe(listCommands().length)
  })

  it('割り当てのある行は、画面に出す形の打鍵を持つ', () => {
    const save = rows().find((row) => row.commandId === 'editor.save')

    expect(save?.keybinding).toBe('Ctrl+S')
    expect(save?.source).toBe('default')
    expect(save?.isModified).toBe(false)
  })

  it('条件をそのまま持つ（When 列）', () => {
    const toggle = rows().find((row) => row.commandId === 'view.togglePanel.terminal')
    const saveAs = rows().find((row) => row.commandId === 'editor.saveAs')

    expect(toggle?.when).toEqual(['!terminalFocused', '!settingsOpen'])
    expect(saveAs?.when).toEqual(['editorHasActiveTab', '!terminalFocused'])
  })

  it('1つの command に2つの割り当てがあれば2行になる', () => {
    const result = rows([
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' },
      { commandId: 'editor.save', key: 'f2', source: 'user' }
    ])

    const save = result.filter((row) => row.commandId === 'editor.save')

    expect(save.map((row) => row.keybinding)).toEqual(['Ctrl+S', 'F2'])
  })

  it('Default から変えられた行が分かる（Reset の活性）', () => {
    const result = rows([{ commandId: 'editor.save', key: 'f2', source: 'user' }])
    const save = result.find((row) => row.commandId === 'editor.save')

    expect(save?.source).toBe('user')
    expect(save?.isModified).toBe(true)
  })

  it('競合している相手を出す', () => {
    const result = rows([
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' },
      { commandId: 'settings.open', key: 'ctrl+s', when: ['workspaceOpen'], source: 'user' }
    ])

    const save = result.find((row) => row.commandId === 'editor.save')
    const settings = result.find((row) => row.commandId === 'settings.open')

    expect(save?.conflictsWith).toEqual(['settings.open'])
    expect(settings?.conflictsWith).toEqual(['editor.save'])
  })

  it('Session 4-7A の既定は競合を1つも出さない', () => {
    for (const row of rows()) {
      expect(row.conflictsWith, row.commandId).toEqual([])
    }
  })

  it('検索に要る文字列が揃っている（Command / Keybinding）', () => {
    for (const row of rows()) {
      expect(row.title.length).toBeGreaterThan(0)
      expect(row.category.length).toBeGreaterThan(0)
    }
  })
})
