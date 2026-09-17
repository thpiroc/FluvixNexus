import { describe, expect, it } from 'vitest'
import { createTranslator } from '../i18n/messages'
import { listCommands } from '../commands/registry'
import { commandTitle } from '../commands/types'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { intendedKeybindings } from './keyWarnings'
import { resolveKeybindings, type KeybindingRule } from './resolve'
import { buildShortcutRows, filterShortcutRows } from './shortcutRows'

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

  it('Default から変えられた command の行が分かる（Reset の活性。Shortcuts S4）', () => {
    const result = buildShortcutRows(
      listCommands(),
      resolveKeybindings([{ commandId: 'editor.save', key: 'f2', source: 'user' }]).entries,
      title,
      new Set(['editor.save', 'git.push'])
    )
    const save = result.find((row) => row.commandId === 'editor.save')
    const push = result.find((row) => row.commandId === 'git.push')
    const open = result.find((row) => row.commandId === 'settings.open')

    expect(save?.source).toBe('user')
    expect(save?.key).toBe('f2')
    expect(save?.isModified).toBe(true)
    /* 解除されて未割り当てになった command も「変更済み」になる。 */
    expect(push?.keybinding).toBeNull()
    expect(push?.isModified).toBe(true)
    expect(open?.isModified).toBe(false)
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
      expect(row.conflict, row.commandId).toBeNull()
      expect(row.reserved, row.commandId).toEqual([])
    }
  })

  /* Shortcuts S5。 */
  it('intended を渡すと、同じ条件で取られた割り当ても行になり「一度も動かない」が付く', () => {
    const rules: KeybindingRule[] = [
      ...DEFAULT_KEYBINDINGS,
      {
        commandId: 'workspace.openFolder',
        key: 'ctrl+,',
        when: ['!terminalFocused'],
        source: 'user'
      }
    ]
    const withoutIntended = rows(rules)
    const withIntended = buildShortcutRows(
      listCommands(),
      resolveKeybindings(rules).entries,
      title,
      new Set(),
      intendedKeybindings(rules)
    )

    /* S4 までの見え方：取られた側は未割り当てに見える。 */
    expect(withoutIntended.find((row) => row.commandId === 'settings.open')?.keybinding).toBeNull()

    const settings = withIntended.find((row) => row.commandId === 'settings.open')
    const open = withIntended.filter((row) => row.commandId === 'workspace.openFolder')

    expect(settings?.key).toBe('ctrl+,')
    expect(settings?.conflict).toEqual({
      commandIds: ['workspace.openFolder'],
      winner: 'workspace.openFolder',
      overridden: true
    })
    expect(settings?.conflictsWith).toEqual(['workspace.openFolder'])
    expect(open.find((row) => row.key === 'ctrl+,')?.conflict?.overridden).toBe(false)
  })

  it('予約キーに重なる行に理由が付く', () => {
    const result = rows([
      ...DEFAULT_KEYBINDINGS,
      { commandId: 'git.push', key: 'ctrl+enter', source: 'user' }
    ])

    expect(result.find((row) => row.commandId === 'git.push')?.reserved).toEqual(['gitCommit'])
  })

  it('検索に要る文字列が揃っている（Command / Keybinding）', () => {
    for (const row of rows()) {
      expect(row.title.length).toBeGreaterThan(0)
      expect(row.category.length).toBeGreaterThan(0)
    }
  })

  /* Session 4-7C から、画面に出るのは翻訳された名前になる。 */
  it('渡された title がそのまま行に出る（翻訳の経路）', () => {
    const t = createTranslator('ja')
    const translated = buildShortcutRows(
      listCommands(),
      resolveKeybindings(DEFAULT_KEYBINDINGS).entries,
      (descriptor) => commandTitle(descriptor, t)
    )

    expect(translated.find((row) => row.commandId === 'editor.save')?.title).toBe('保存')
    expect(translated.find((row) => row.commandId === 'git.push')?.title).toBe('プッシュ')
  })
})

/** 一覧の絞り込み（Session 4-7C）。 */
describe('filterShortcutRows', () => {
  const all = rows()

  it('空・空白だけなら全件返す', () => {
    expect(filterShortcutRows(all, '')).toHaveLength(all.length)
    expect(filterShortcutRows(all, '   ')).toHaveLength(all.length)
  })

  it('表示名に当たる', () => {
    const found = filterShortcutRows(all, 'Toggle')

    expect(found.map((row) => row.commandId)).toEqual([
      'view.togglePanel.files',
      'view.togglePanel.editor',
      'view.togglePanel.terminal',
      'view.togglePanel.git',
      'view.togglePanel.debug',
      'debug.toggleBreakpoint'
    ])
  })

  it('command の id に当たる（表示が翻訳されていても英語で探せる）', () => {
    const found = filterShortcutRows(all, 'git.')

    expect(found).toHaveLength(7)
    for (const row of found) {
      expect(row.category).toBe('git')
    }
  })

  it('打鍵に当たる（Ctrl+Shift+S から逆に引ける）', () => {
    const found = filterShortcutRows(all, 'ctrl+shift+s')

    expect(found.map((row) => row.commandId)).toEqual(['editor.saveAs'])
  })

  /*
    素の部分一致なので、`ctrl+s` は `Ctrl+Shift+E` にも当たる
    （`'Ctrl+S'` が `'Ctrl+Shift+E'` の一部になっている）。

    打鍵を修飾キーごとに分解して厳密に当てることもできるが、v1 では取らない
    ── 出しすぎは目で捨てられる一方、絞りすぎは「あるはずのものが出ない」に
    なり、しかもなぜ出ないかが画面から分からない。
  */
  it('打鍵の一致は素の部分一致（Ctrl+S は Ctrl+Shift+… にも当たる）', () => {
    const found = filterShortcutRows(all, 'ctrl+s')

    /*
      `editor.triggerSuggest` が居るのは Ctrl+Space が当たるため（Session 5-12）。
      上の判断のとおり、出しすぎは目で捨てられる。
    */
    expect(found.map((row) => row.commandId)).toEqual([
      'editor.save',
      'editor.saveAs',
      'editor.triggerSuggest',
      'view.togglePanel.files',
      'view.togglePanel.git'
    ])
  })

  it('大小を無視する', () => {
    expect(filterShortcutRows(all, 'PUSH')).toHaveLength(filterShortcutRows(all, 'push').length)
    expect(filterShortcutRows(all, 'PUSH').length).toBeGreaterThan(0)
  })

  it('未割り当ての行も絞り込みの対象になる', () => {
    const found = filterShortcutRows(all, 'resetLayout')

    expect(found).toHaveLength(1)
    expect(found[0].keybinding).toBeNull()
  })

  /* 「未割り当て」は画面の文言であって、行の持つ文字列ではない。 */
  it('打鍵の無い行が、打鍵での検索に当たらない', () => {
    const found = filterShortcutRows(all, 'ctrl')

    for (const row of found) {
      expect(row.keybinding, row.commandId).not.toBeNull()
    }
  })

  it('当たらなければ空を返す', () => {
    expect(filterShortcutRows(all, 'zzzznope')).toEqual([])
  })

  it('元の並びを保つ', () => {
    const found = filterShortcutRows(all, 'e')

    expect(found).toEqual(all.filter((row) => found.includes(row)))
  })

  it('翻訳された名前でも探せる（日本語）', () => {
    const t = createTranslator('ja')
    const japanese = buildShortcutRows(
      listCommands(),
      resolveKeybindings(DEFAULT_KEYBINDINGS).entries,
      (descriptor) => commandTitle(descriptor, t)
    )

    expect(filterShortcutRows(japanese, '保存').map((row) => row.commandId)).toEqual([
      'editor.save',
      'editor.saveAs'
    ])
  })
})
