import { describe, expect, it } from 'vitest'
import type { StoredKeybindingEntry } from '@shared/keybindings'
import type { CommandId } from '../commands/commandIds'
import { parseKeybinding } from './chord'
import { DEFAULT_KEYBINDINGS } from './defaults'
import {
  commandKeys,
  defaultCommandKeys,
  isAssignableChord,
  modifiedCommandIds,
  replaceKey,
  withCommandKeys
} from './editKeybindings'
import { resolveKeybindings } from './resolve'
import { readUserKeybindings } from './userKeybindings'

/** ファイルの行から、効く表を作る（KeybindingProvider と同じ連結）。 */
function tableOf(stored: readonly StoredKeybindingEntry[]) {
  return resolveKeybindings([...DEFAULT_KEYBINDINGS, ...readUserKeybindings(stored).rules]).entries
}

function keysIn(stored: readonly StoredKeybindingEntry[], commandId: CommandId): string[] {
  return tableOf(stored)
    .filter((entry) => entry.commandId === commandId)
    .map((entry) => entry.token)
}

function rulesOf(stored: readonly StoredKeybindingEntry[]) {
  return readUserKeybindings(stored).rules
}

describe('commandKeys / defaultCommandKeys', () => {
  it('既定の打鍵を chordToken の形で返す', () => {
    expect(defaultCommandKeys('editor.save')).toEqual(['ctrl+s'])
    expect(defaultCommandKeys('settings.open')).toEqual(['ctrl+,'])
    expect(defaultCommandKeys('git.push')).toEqual([])
  })

  it('ユーザーの行を畳んだ結果を返す', () => {
    const stored = [
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'ctrl+alt+s', command: 'editor.save' }
    ]

    expect(commandKeys('editor.save', rulesOf(stored))).toEqual(['ctrl+alt+s'])
  })

  /*
    別の command が同じ打鍵を後勝ちで奪っていても、この command の側の
    打鍵としては残る（表から読むと、編集のたびに黙って消える）。
  */
  it('別の command に奪われた打鍵も、その command の打鍵として数える', () => {
    const stored = [{ key: 'ctrl+o', command: 'settings.open' }]

    expect(keysIn(stored, 'workspace.openFolder')).toEqual([])
    expect(commandKeys('workspace.openFolder', rulesOf(stored))).toEqual(['ctrl+o'])
  })
})

describe('withCommandKeys', () => {
  it('変更：既定の打鍵を外し、新しい打鍵を足す2行になる', () => {
    const next = withCommandKeys([], 'editor.save', ['ctrl+alt+s'])

    expect(next).toEqual([
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'ctrl+alt+s', command: 'editor.save' }
    ])
    expect(keysIn(next, 'editor.save')).toEqual(['ctrl+alt+s'])
  })

  it('既定を持たない command への割り当ては1行だけ', () => {
    const next = withCommandKeys([], 'git.push', ['ctrl+alt+p'])

    expect(next).toEqual([{ key: 'ctrl+alt+p', command: 'git.push' }])
    expect(keysIn(next, 'git.push')).toEqual(['ctrl+alt+p'])
  })

  it('解除：既定の打鍵なら -command の1行、足した打鍵なら行が消える', () => {
    const removedDefault = withCommandKeys([], 'editor.save', [])

    expect(removedDefault).toEqual([{ key: 'ctrl+s', command: '-editor.save' }])
    expect(keysIn(removedDefault, 'editor.save')).toEqual([])

    const assigned = withCommandKeys([], 'git.push', ['ctrl+alt+p'])

    expect(withCommandKeys(assigned, 'git.push', [])).toEqual([])
  })

  it('既定と同じ並びにすると、その command の行が無くなる（デフォルトへ戻す）', () => {
    const changed = withCommandKeys([], 'editor.save', ['ctrl+alt+s'])

    expect(withCommandKeys(changed, 'editor.save', defaultCommandKeys('editor.save'))).toEqual([])
  })

  /* 変えては戻すを繰り返しても、打ち消し合う行が溜まらない。 */
  it('何度変えても、行は既定との差分だけ', () => {
    let stored: readonly StoredKeybindingEntry[] = []

    for (const key of ['ctrl+alt+1', 'ctrl+alt+2', 'f7', 'ctrl+alt+3']) {
      stored = withCommandKeys(stored, 'settings.open', [key])
    }

    expect(stored).toEqual([
      { key: 'ctrl+,', command: '-settings.open' },
      { key: 'ctrl+alt+3', command: 'settings.open' }
    ])
  })

  it('他の command の行と、読めない行には触らない（読めない行は元の位置のまま）', () => {
    const stored: StoredKeybindingEntry[] = [
      { key: 'ctrl+alt+r', command: 'view.resetLayout' },
      { key: 'ctrl+1', command: 'nope.command' },
      { key: 'ctrl+alt+x', command: 'editor.save', when: 'editorFocused' },
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'not a key', command: 'editor.save' },
      { key: 'f8', command: 'editor.save' }
    ]

    expect(withCommandKeys(stored, 'editor.save', ['ctrl+alt+s'])).toEqual([
      { key: 'ctrl+alt+r', command: 'view.resetLayout' },
      { key: 'ctrl+1', command: 'nope.command' },
      { key: 'ctrl+alt+x', command: 'editor.save', when: 'editorFocused' },
      { key: 'not a key', command: 'editor.save' },
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'ctrl+alt+s', command: 'editor.save' }
    ])
  })

  it('書き方の違う打鍵は chordToken の形に揃え、読めないものは落とす', () => {
    expect(withCommandKeys([], 'git.push', ['Shift+Ctrl+P', '???', 'ctrl+shift+p'])).toEqual([
      { key: 'ctrl+shift+p', command: 'git.push' }
    ])
  })

  /* 条件は既定から引き継がれる（userKeybindings.ts）── 移しても F2 の editorFocused が残る。 */
  it('移した打鍵にも、その command の既定の条件が付く', () => {
    const next = withCommandKeys([], 'editor.renameSymbol', ['ctrl+alt+n'])
    const entry = tableOf(next).find((candidate) => candidate.commandId === 'editor.renameSymbol')

    expect(entry?.token).toBe('ctrl+alt+n')
    expect(entry?.when).toEqual(['editorFocused', '!terminalFocused'])
  })
})

describe('modifiedCommandIds', () => {
  it('ユーザーの行が無ければ空', () => {
    expect(modifiedCommandIds([])).toEqual(new Set())
  })

  it('変更・解除・割り当てのどれでも変更済みになる', () => {
    let stored = withCommandKeys([], 'editor.save', ['ctrl+alt+s'])
    stored = withCommandKeys(stored, 'settings.open', [])
    stored = withCommandKeys(stored, 'git.push', ['ctrl+alt+p'])

    expect(modifiedCommandIds(rulesOf(stored))).toEqual(
      new Set(['editor.save', 'settings.open', 'git.push'])
    )
  })

  it('行があっても、打鍵の組が既定と同じなら変更済みではない', () => {
    const stored = [
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'ctrl+s', command: 'editor.save' }
    ]

    expect(modifiedCommandIds(rulesOf(stored))).toEqual(new Set())
  })
})

describe('replaceKey', () => {
  it('指した打鍵だけを置き換える', () => {
    expect(replaceKey(['ctrl+s', 'f8'], 'f8', 'f9')).toEqual(['ctrl+s', 'f9'])
  })

  it('from が null なら末尾に足す', () => {
    expect(replaceKey(['ctrl+s'], null, 'f9')).toEqual(['ctrl+s', 'f9'])
  })

  it('同じ打鍵を2つにしない', () => {
    expect(replaceKey(['ctrl+s', 'f8'], 'f8', 'ctrl+s')).toEqual(['ctrl+s'])
    expect(replaceKey(['ctrl+s'], null, 'ctrl+s')).toEqual(['ctrl+s'])
  })
})

describe('isAssignableChord', () => {
  const assignable = (key: string): boolean => {
    const chord = parseKeybinding(key)

    if (chord === null) {
      throw new Error(key)
    }

    return isAssignableChord(chord)
  }

  it('Ctrl / Alt / Meta 付きは割り当てられる', () => {
    for (const key of ['ctrl+s', 'alt+x', 'meta+k', 'ctrl+enter', 'ctrl+shift+,', 'shift+alt+f']) {
      expect(assignable(key), key).toBe(true)
    }
  })

  it('F1〜F24 は単体でも Shift 付きでも割り当てられる', () => {
    for (const key of ['f1', 'f12', 'f24', 'shift+f5']) {
      expect(assignable(key), key).toBe(true)
    }
  })

  /* 割り当てた瞬間に入力欄で文字が打てなくなるもの。 */
  it('文字・Shift+文字・Enter・矢印などは単体では割り当てられない', () => {
    for (const key of [
      'a',
      'shift+a',
      '1',
      ',',
      'space',
      'enter',
      'escape',
      'tab',
      'up',
      'delete'
    ]) {
      expect(assignable(key), key).toBe(false)
    }
  })
})
