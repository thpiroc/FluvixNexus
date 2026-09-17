import { describe, expect, it } from 'vitest'
import { findKeybindingConflicts, resolveKeybindings, type KeybindingRule } from './resolve'

describe('resolveKeybindings', () => {
  it('打鍵を正規化して表を引く鍵を付ける', () => {
    const { entries, invalid } = resolveKeybindings([
      { commandId: 'editor.save', key: 'shift+ctrl+s', source: 'default' }
    ])

    expect(invalid).toHaveLength(0)
    expect(entries).toHaveLength(1)
    expect(entries[0].token).toBe('ctrl+shift+s')
    expect(entries[0].chord.key).toBe('s')
    expect(entries[0].when).toEqual([])
  })

  it('読めない打鍵は捨てずに invalid へ回す', () => {
    const broken: KeybindingRule = {
      commandId: 'editor.save',
      key: 'ctrl+notakey',
      source: 'user'
    }

    const { entries, invalid } = resolveKeybindings([
      { commandId: 'editor.saveAs', key: 'ctrl+shift+s', source: 'default' },
      broken
    ])

    expect(entries).toHaveLength(1)
    expect(invalid).toEqual([broken])
  })

  it('同じ打鍵 × 同じ条件 は後勝ちで畳む', () => {
    const { entries } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' },
      { commandId: 'settings.open', key: 'ctrl+s', source: 'user' }
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].commandId).toBe('settings.open')
    expect(entries[0].source).toBe('user')
  })

  it('条件の並びが違うだけなら同じものとして畳む', () => {
    const { entries } = resolveKeybindings([
      {
        commandId: 'editor.save',
        key: 'ctrl+s',
        when: ['workspaceOpen', 'editorFocused'],
        source: 'default'
      },
      {
        commandId: 'settings.open',
        key: 'ctrl+s',
        when: ['editorFocused', 'workspaceOpen'],
        source: 'user'
      }
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].commandId).toBe('settings.open')
  })

  it('条件が違えば両方残る（使い分けであって上書きではない）', () => {
    const { entries } = resolveKeybindings([
      {
        commandId: 'editor.save',
        key: 'ctrl+j',
        when: ['terminalFocused'],
        source: 'default'
      },
      {
        commandId: 'view.togglePanel.terminal',
        key: 'ctrl+j',
        when: ['!terminalFocused'],
        source: 'default'
      }
    ])

    expect(entries).toHaveLength(2)
  })

  it('Default → User → Workspace の優先順が、連結の順序だけで出る', () => {
    /*
      v1 が作るのは default だけだが、後から入れるときに
      「配列を後ろへ足す」以外の変更が要らないことを先に固定しておく
      （resolve.ts の冒頭）。
    */
    const defaults: readonly KeybindingRule[] = [
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' }
    ]
    const user: readonly KeybindingRule[] = [
      { commandId: 'settings.open', key: 'ctrl+s', source: 'user' }
    ]
    const workspace: readonly KeybindingRule[] = [
      { commandId: 'view.resetLayout', key: 'ctrl+s', source: 'workspace' }
    ]

    expect(resolveKeybindings([...defaults, ...user]).entries[0].commandId).toBe('settings.open')
    expect(resolveKeybindings([...defaults, ...user, ...workspace]).entries[0].commandId).toBe(
      'view.resetLayout'
    )
    // 順序が逆なら結果も逆（優先順は配列の順序そのもの）。
    expect(resolveKeybindings([...user, ...defaults]).entries[0].commandId).toBe('editor.save')
  })
})

describe('割り当ての解除（Shortcuts S3）', () => {
  it('前にある同じ command × 同じ打鍵を外す（条件は問わない）', () => {
    const { entries, invalid } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' },
      { commandId: 'editor.save', key: 'ctrl+s', when: ['editorFocused'], source: 'default' },
      { commandId: 'settings.open', key: 'ctrl+,', source: 'default' },
      { commandId: 'editor.save', key: 'shift+ctrl+s', source: 'user', remove: true }
    ])

    expect(invalid).toEqual([])
    // 綴りの順序が違っても、正規化した打鍵で照らす（ctrl+shift+s は無いので何も外れない）。
    expect(entries.map((entry) => entry.commandId)).toEqual([
      'editor.save',
      'editor.save',
      'settings.open'
    ])

    const removed = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' },
      { commandId: 'editor.save', key: 'ctrl+s', when: ['editorFocused'], source: 'default' },
      { commandId: 'settings.open', key: 'ctrl+,', source: 'default' },
      { commandId: 'editor.save', key: 'Ctrl+S', source: 'user', remove: true }
    ])

    expect(removed.entries.map((entry) => entry.commandId)).toEqual(['settings.open'])
  })

  it('同じ打鍵でも別の command は外さない', () => {
    const { entries } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', when: ['editorFocused'], source: 'default' },
      { commandId: 'settings.open', key: 'ctrl+s', when: ['!editorFocused'], source: 'default' },
      { commandId: 'editor.save', key: 'ctrl+s', source: 'user', remove: true }
    ])

    expect(entries.map((entry) => entry.commandId)).toEqual(['settings.open'])
  })

  it('後ろにある割り当ては外さない（解除の後に書き直せばそれが効く）', () => {
    const { entries } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' },
      { commandId: 'editor.save', key: 'ctrl+s', source: 'user', remove: true },
      { commandId: 'editor.save', key: 'ctrl+s', source: 'user' }
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].source).toBe('user')
  })

  it('読めない打鍵の解除は invalid へ回し、何も外さない', () => {
    const broken: KeybindingRule = {
      commandId: 'editor.save',
      key: 'ctrl+notakey',
      source: 'user',
      remove: true
    }

    const { entries, invalid } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' },
      broken
    ])

    expect(entries).toHaveLength(1)
    expect(invalid).toEqual([broken])
  })
})

describe('findKeybindingConflicts', () => {
  it('打鍵が違えば競合しない', () => {
    const { entries } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', source: 'default' },
      { commandId: 'settings.open', key: 'ctrl+,', source: 'default' }
    ])

    expect(findKeybindingConflicts(entries)).toEqual([])
  })

  it('同じ打鍵で、同時に成り立つ条件なら競合', () => {
    const { entries } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', when: ['workspaceOpen'], source: 'default' },
      { commandId: 'settings.open', key: 'ctrl+s', when: ['editorFocused'], source: 'default' }
    ])

    const conflicts = findKeybindingConflicts(entries)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].token).toBe('ctrl+s')
    expect([...conflicts[0].commandIds].sort()).toEqual(['editor.save', 'settings.open'])
  })

  it('両立しない条件なら競合しない', () => {
    const { entries } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+j', when: ['terminalFocused'], source: 'default' },
      {
        commandId: 'view.togglePanel.terminal',
        key: 'ctrl+j',
        when: ['!terminalFocused'],
        source: 'default'
      }
    ])

    expect(findKeybindingConflicts(entries)).toEqual([])
  })

  it('同じ command に複数の割り当てがあっても競合ではない', () => {
    const { entries } = resolveKeybindings([
      { commandId: 'editor.save', key: 'ctrl+s', when: ['workspaceOpen'], source: 'default' },
      { commandId: 'editor.save', key: 'ctrl+s', when: ['editorFocused'], source: 'default' }
    ])

    expect(findKeybindingConflicts(entries)).toEqual([])
  })
})
