import { describe, expect, it } from 'vitest'
import type { StoredKeybindingEntry } from '@shared/keybindings'
import type { CommandId } from '../commands/commandIds'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { intendedKeybindings, keyWarnings, previewKeyWarnings } from './keyWarnings'
import { resolveKeybindings, type KeybindingRule } from './resolve'
import { readUserKeybindings } from './userKeybindings'

/** ファイルの行から、画面と同じ2つの表を作って警告を引く。 */
function warningsOf(stored: readonly StoredKeybindingEntry[], commandId: CommandId, key: string) {
  const rules: KeybindingRule[] = [...DEFAULT_KEYBINDINGS, ...readUserKeybindings(stored).rules]

  return keyWarnings(commandId, key, intendedKeybindings(rules), resolveKeybindings(rules).entries)
}

describe('intendedKeybindings', () => {
  it('同じ条件で別の command に取られた割り当ても、取られた側に残る', () => {
    const rules: KeybindingRule[] = [
      { commandId: 'settings.open', key: 'ctrl+,', when: ['!terminalFocused'], source: 'default' },
      {
        commandId: 'workspace.openFolder',
        key: 'ctrl+,',
        when: ['!terminalFocused'],
        source: 'user'
      }
    ]

    expect(resolveKeybindings(rules).entries.map((entry) => entry.commandId)).toEqual([
      'workspace.openFolder'
    ])
    expect(intendedKeybindings(rules).map((entry) => entry.commandId)).toEqual([
      'settings.open',
      'workspace.openFolder'
    ])
  })

  it('解除は自分の command の中で効く', () => {
    const rules: KeybindingRule[] = [
      ...DEFAULT_KEYBINDINGS,
      { commandId: 'editor.save', key: 'ctrl+s', source: 'user', remove: true }
    ]

    expect(intendedKeybindings(rules).some((entry) => entry.commandId === 'editor.save')).toBe(
      false
    )
  })

  it('既定だけなら、効いている表と同じ割り当てになる', () => {
    const pairs = (entries: ReturnType<typeof intendedKeybindings>) =>
      entries.map((entry) => `${entry.commandId}:${entry.token}`).sort()

    expect(pairs(intendedKeybindings(DEFAULT_KEYBINDINGS))).toEqual(
      pairs(resolveKeybindings(DEFAULT_KEYBINDINGS).entries)
    )
  })
})

describe('keyWarnings', () => {
  it('既定だけなら、どの割り当てにも警告は無い', () => {
    for (const rule of DEFAULT_KEYBINDINGS) {
      expect(warningsOf([], rule.commandId, rule.key), rule.commandId).toEqual({
        conflict: null,
        reserved: []
      })
    }
  })

  it('同じ条件で取られた側は「一度も動かない」、取った側が勝つ', () => {
    const stored = [{ key: 'ctrl+,', command: 'workspace.openFolder' }]

    expect(warningsOf(stored, 'settings.open', 'ctrl+,').conflict).toEqual({
      commandIds: ['workspace.openFolder'],
      winner: 'workspace.openFolder',
      overridden: true
    })
    expect(warningsOf(stored, 'workspace.openFolder', 'ctrl+,').conflict).toEqual({
      commandIds: ['settings.open'],
      winner: 'workspace.openFolder',
      overridden: false
    })
  })

  it('条件が違っても重なるなら、後ろにある方が勝つ', () => {
    /* editor.save は条件なし、settings.open は !terminalFocused（既定から引き継ぐ）。 */
    const stored = [{ key: 'ctrl+s', command: 'settings.open' }]

    expect(warningsOf(stored, 'editor.save', 'ctrl+s').conflict).toEqual({
      commandIds: ['settings.open'],
      winner: 'settings.open',
      overridden: false
    })
    expect(warningsOf(stored, 'settings.open', 'ctrl+s').conflict).toEqual({
      commandIds: ['editor.save'],
      winner: 'settings.open',
      overridden: false
    })
  })

  it('条件が両立しなければ競合ではない', () => {
    /* エディターの中と外で打鍵を使い分けている。 */
    const rules: KeybindingRule[] = [
      { commandId: 'editor.save', key: 'ctrl+k', when: ['editorFocused'], source: 'user' },
      { commandId: 'settings.open', key: 'ctrl+k', when: ['!editorFocused'], source: 'user' }
    ]

    expect(
      keyWarnings(
        'editor.save',
        'ctrl+k',
        intendedKeybindings(rules),
        resolveKeybindings(rules).entries
      ).conflict
    ).toBeNull()
  })

  it('予約キーの理由も付く', () => {
    const stored = [{ key: 'ctrl+p', command: 'git.push' }]

    expect(warningsOf(stored, 'git.push', 'ctrl+p')).toEqual({
      conflict: null,
      reserved: ['commandPalette']
    })
  })

  it('その command がその打鍵を持っていなければ何も返さない', () => {
    expect(warningsOf([], 'git.push', 'ctrl+s')).toEqual({ conflict: null, reserved: [] })
  })
})

describe('previewKeyWarnings（記録中の打鍵を確定したら）', () => {
  it('別の command の打鍵へ変えると、確定後の勝ち負けが出る', () => {
    expect(previewKeyWarnings([], 'workspace.openFolder', 'ctrl+o', 'ctrl+,').conflict).toEqual({
      commandIds: ['settings.open'],
      winner: 'workspace.openFolder',
      overridden: false
    })
  })

  it('既定の打鍵へ戻すと、先に取っていた command に負けることもある', () => {
    /* settings.open が Ctrl+S を取り、editor.save からは外してある。 */
    const stored = [
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'ctrl+s', command: 'settings.open' }
    ]

    expect(previewKeyWarnings(stored, 'editor.save', null, 'ctrl+s').conflict).toEqual({
      commandIds: ['settings.open'],
      winner: 'settings.open',
      overridden: false
    })
  })

  it('自分の打鍵を同じ打鍵で押し直しても警告は無い', () => {
    expect(previewKeyWarnings([], 'editor.save', 'ctrl+s', 'ctrl+s')).toEqual({
      conflict: null,
      reserved: []
    })
  })

  it('予約キーは、その command の条件で判定する', () => {
    /* git.push は条件を持たないので、Commit 欄と端末の両方に重なる（S1〜S6 統合）。 */
    expect(previewKeyWarnings([], 'git.push', null, 'ctrl+enter').reserved).toEqual([
      'gitCommit',
      'terminalSubmit'
    ])
    expect(previewKeyWarnings([], 'editor.goToDefinition', 'f12', 'ctrl+enter').reserved).toEqual(
      []
    )
  })

  it('打鍵を読めなければ何も返さない', () => {
    expect(previewKeyWarnings([], 'git.push', null, 'ctrl+nope')).toEqual({
      conflict: null,
      reserved: []
    })
  })
})
