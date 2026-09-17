import { describe, expect, it } from 'vitest'
import { LANGUAGE_IDS } from '@shared/language'
import { createTranslator } from '../i18n/messages'
import { parseKeybinding } from './chord'
import {
  BUILTIN_SHORTCUT_GROUP_ORDER,
  BUILTIN_SHORTCUTS,
  buildBuiltinShortcutRows,
  filterBuiltinShortcutRows,
  getBuiltinShortcutGroupTitle
} from './builtinShortcuts'
import { DEFAULT_KEYBINDINGS } from './defaults'

const ja = createTranslator('ja')
const rows = buildBuiltinShortcutRows(BUILTIN_SHORTCUTS, ja)
const byId = (id: string) => rows.find((row) => row.id === id)

describe('BUILTIN_SHORTCUTS', () => {
  it('id が重ならない', () => {
    const ids = BUILTIN_SHORTCUTS.map((descriptor) => descriptor.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('打鍵はすべて parseKeybinding が読める（S5 の照合にそのまま使える）', () => {
    for (const descriptor of BUILTIN_SHORTCUTS) {
      expect(descriptor.keys.length, descriptor.id).toBeGreaterThan(0)
      for (const key of descriptor.keys) {
        expect(parseKeybinding(key), `${descriptor.id} ${key}`).not.toBeNull()
      }
    }
  })

  it('id の先頭語が群と一致する', () => {
    for (const descriptor of BUILTIN_SHORTCUTS) {
      expect(descriptor.id.split('.')[0], descriptor.id).toBe(descriptor.group)
    }
  })

  it('群はすべて並び順に含まれ、空の群が無い', () => {
    for (const group of BUILTIN_SHORTCUT_GROUP_ORDER) {
      expect(
        BUILTIN_SHORTCUTS.some((descriptor) => descriptor.group === group),
        group
      ).toBe(true)
    }
    for (const descriptor of BUILTIN_SHORTCUTS) {
      expect(BUILTIN_SHORTCUT_GROUP_ORDER).toContain(descriptor.group)
    }
  })

  /*
    計画（Notion「確定した方針」）で挙げた基本ショートカットが揃っていること。
    Ctrl+Y と Ctrl+Shift+Z は同じ「やり直す」の2つの打鍵。
  */
  it('基本ショートカット Ctrl+C / V / X / Z / Y / Shift+Z / A / F / H が並ぶ', () => {
    const editing = rows.filter((row) => row.group === 'editing').flatMap((row) => row.keybindings)

    expect([...editing].sort()).toEqual(
      [
        'Ctrl+A',
        'Ctrl+C',
        'Ctrl+F',
        'Ctrl+H',
        'Ctrl+Shift+Z',
        'Ctrl+V',
        'Ctrl+X',
        'Ctrl+Y',
        'Ctrl+Z'
      ].sort()
    )
  })

  it('Terminal 固有の打鍵が並ぶ', () => {
    expect(byId('terminal.interrupt')?.keybindings).toEqual(['Ctrl+C'])
    expect(byId('terminal.copy')?.keybindings).toEqual(['Ctrl+Insert'])
    expect(byId('terminal.paste')?.keybindings).toEqual(['Ctrl+Shift+V', 'Shift+Insert'])
    expect(byId('terminal.sendCtrlV')?.keybindings).toEqual(['Ctrl+V'])
    expect(byId('terminal.fontSizeIncrease')?.keybindings).toEqual(['Ctrl++', 'Ctrl+='])
    expect(byId('terminal.fontSizeDecrease')?.keybindings).toEqual(['Ctrl+-'])
    expect(byId('terminal.fontSizeReset')?.keybindings).toEqual(['Ctrl+0'])
  })

  /* 実機で何もしないと確かめた打鍵は、書き写さない（builtinShortcuts.ts の冒頭）。 */
  it('Terminal の Ctrl+Shift+C は並べない', () => {
    const terminal = rows
      .filter((row) => row.group === 'terminal')
      .flatMap((row) => row.keybindings)

    expect(terminal).not.toContain('Ctrl+Shift+C')
  })

  /*
    組み込みの打鍵は、アプリ全体の既定の割り当て（defaults.ts）と重ならない。
    重なっていれば、どちらかが実際には効かない行を一覧に出していることになる。
  */
  it('既定の割り当てと同じ打鍵を持たない', () => {
    const defaults = new Set(DEFAULT_KEYBINDINGS.map((rule) => rule.key.toLowerCase()))

    for (const descriptor of BUILTIN_SHORTCUTS) {
      for (const key of descriptor.keys) {
        expect(defaults.has(key), `${descriptor.id} ${key}`).toBe(false)
      }
    }
  })
})

describe('buildBuiltinShortcutRows', () => {
  it('表示名・効く場所を翻訳する', () => {
    expect(byId('editing.copy')?.title).toBe('コピー')
    expect(byId('editing.copy')?.scope).toBe('エディター・入力欄')
    expect(byId('editing.find')?.scope).toBe('エディター')
    expect(byId('terminal.interrupt')?.scope).toBeNull()
  })

  it('英語でも翻訳される', () => {
    const en = buildBuiltinShortcutRows(BUILTIN_SHORTCUTS, createTranslator('en'))

    expect(en.find((row) => row.id === 'editing.redo')?.title).toBe('Redo')
    expect(en.find((row) => row.id === 'editing.redo')?.scope).toBe('Editor and text fields')
  })

  for (const language of LANGUAGE_IDS) {
    it(`${language} で全行・全群の名前が解決できる`, () => {
      const t = createTranslator(language)

      for (const row of buildBuiltinShortcutRows(BUILTIN_SHORTCUTS, t)) {
        expect(row.title, row.id).not.toContain('settings.keyboard.')
        expect(row.scope ?? '', row.id).not.toContain('settings.keyboard.')
      }
      for (const group of BUILTIN_SHORTCUT_GROUP_ORDER) {
        expect(getBuiltinShortcutGroupTitle(group, t)).not.toContain('settings.keyboard.')
      }
    })
  }

  it('読めない打鍵は例外にする（書き間違いを黙って落とさない）', () => {
    expect(() =>
      buildBuiltinShortcutRows(
        [
          {
            id: 'editing.broken',
            group: 'editing',
            titleKey: 'settings.keyboard.builtin.actions.copy',
            keys: ['ctrl+nope']
          }
        ],
        ja
      )
    ).toThrow(/editing\.broken/)
  })
})

describe('filterBuiltinShortcutRows', () => {
  it('空・空白だけなら全件返す', () => {
    expect(filterBuiltinShortcutRows(rows, '')).toHaveLength(rows.length)
    expect(filterBuiltinShortcutRows(rows, '  ')).toHaveLength(rows.length)
  })

  it('打鍵で引ける（2つ目の打鍵にも当たる）', () => {
    expect(filterBuiltinShortcutRows(rows, 'ctrl+shift+z').map((row) => row.id)).toEqual([
      'editing.redo'
    ])
    expect(filterBuiltinShortcutRows(rows, 'shift+insert').map((row) => row.id)).toEqual([
      'terminal.paste'
    ])
  })

  /* 素の部分一致なので、`ctrl+v` は `Ctrl+Shift+V`（ターミナルの貼り付け）には当たらない。 */
  it('Ctrl+V は編集とターミナルの両方に当たる', () => {
    expect(filterBuiltinShortcutRows(rows, 'ctrl+v').map((row) => row.id)).toEqual([
      'editing.paste',
      'terminal.sendCtrlV'
    ])
  })

  it('表示名・id・効く場所で引ける', () => {
    expect(filterBuiltinShortcutRows(rows, '置換').map((row) => row.id)).toEqual([
      'editing.replace'
    ])
    expect(
      filterBuiltinShortcutRows(rows, 'terminal.').every((row) => row.group === 'terminal')
    ).toBe(true)
    expect(filterBuiltinShortcutRows(rows, '入力欄').length).toBe(6)
  })

  it('当たらなければ空', () => {
    expect(filterBuiltinShortcutRows(rows, 'zzzznope')).toEqual([])
  })
})
