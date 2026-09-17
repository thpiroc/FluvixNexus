import { describe, expect, it } from 'vitest'
import { dispatchKeybinding } from './dispatch'
import { parseKeybinding } from './chord'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { resolveKeybindings } from './resolve'
import { readUserKeybindings } from './userKeybindings'
import { emptyWhenContext, type WhenContext } from './when'

/**
 * `keybindings.json` の行を rule へ読み替える（Shortcuts S3）。
 */

function chord(text: string): NonNullable<ReturnType<typeof parseKeybinding>> {
  const parsed = parseKeybinding(text)

  if (parsed === null) {
    throw new Error(`test chord is unreadable: ${text}`)
  }

  return parsed
}

describe('readUserKeybindings', () => {
  it('行が無ければ rule も無い', () => {
    expect(readUserKeybindings([])).toEqual({ rules: [], invalid: [] })
  })

  it('source は user、条件は既定の割り当てから引き継ぐ', () => {
    const { rules, invalid } = readUserKeybindings([
      { key: 'ctrl+alt+r', command: 'editor.renameSymbol' }
    ])

    expect(invalid).toEqual([])
    expect(rules).toEqual([
      {
        commandId: 'editor.renameSymbol',
        key: 'ctrl+alt+r',
        when: ['editorFocused', '!terminalFocused'],
        source: 'user'
      }
    ])
  })

  it('既定の割り当てを持たない command は条件無し', () => {
    expect(readUserKeybindings([{ key: 'ctrl+alt+p', command: 'git.push' }]).rules).toEqual([
      { commandId: 'git.push', key: 'ctrl+alt+p', source: 'user' }
    ])
  })

  it('-command は解除の rule になる', () => {
    expect(readUserKeybindings([{ key: 'f5', command: '-debug.startOrContinue' }]).rules).toEqual([
      { commandId: 'debug.startOrContinue', key: 'f5', source: 'user', remove: true }
    ])
  })

  it('読めない行は理由と位置を付けて invalid へ回し、残りは読む', () => {
    const { rules, invalid } = readUserKeybindings([
      { key: 'ctrl+1', command: 'nope.command' },
      { key: 'ctrl+notakey', command: 'editor.save' },
      { key: 'ctrl+2', command: 'editor.save', when: 'editorFocused' },
      { key: 'ctrl+3', command: '-' },
      { key: 'ctrl+alt+s', command: 'editor.save' }
    ])

    expect(invalid.map(({ index, problem }) => ({ index, problem }))).toEqual([
      { index: 0, problem: 'unknownCommand' },
      { index: 1, problem: 'invalidKey' },
      { index: 2, problem: 'whenNotSupported' },
      { index: 3, problem: 'unknownCommand' }
    ])
    expect(invalid[2].entry).toEqual({
      key: 'ctrl+2',
      command: 'editor.save',
      when: 'editorFocused'
    })
    expect(rules).toEqual([{ commandId: 'editor.save', key: 'ctrl+alt+s', source: 'user' }])
  })
})

describe('既定と連結したときの効き方', () => {
  const editorContext: WhenContext = {
    ...emptyWhenContext(),
    workspaceOpen: true,
    editorFocused: true
  }

  function resolveWith(
    stored: Parameters<typeof readUserKeybindings>[0]
  ): ReturnType<typeof resolveKeybindings>['entries'] {
    return resolveKeybindings([...DEFAULT_KEYBINDINGS, ...readUserKeybindings(stored).rules])
      .entries
  }

  it('ユーザーの行が空なら、既定だけの表とまったく同じ', () => {
    expect(resolveWith([])).toEqual(resolveKeybindings(DEFAULT_KEYBINDINGS).entries)
  })

  it('打鍵の変更（解除＋追加）で、古い打鍵は効かず新しい打鍵が効く', () => {
    const entries = resolveWith([
      { key: 'f2', command: '-editor.renameSymbol' },
      { key: 'ctrl+alt+r', command: 'editor.renameSymbol' }
    ])

    expect(dispatchKeybinding(chord('f2'), editorContext, entries)).toBeNull()
    expect(dispatchKeybinding(chord('ctrl+alt+r'), editorContext, entries)).toBe(
      'editor.renameSymbol'
    )
  })

  it('引き継いだ条件が効く（F2 の移し先も Editor の外では走らない）', () => {
    const entries = resolveWith([{ key: 'ctrl+alt+r', command: 'editor.renameSymbol' }])

    expect(
      dispatchKeybinding(chord('ctrl+alt+r'), { ...editorContext, editorFocused: false }, entries)
    ).toBeNull()
  })

  it('同じ打鍵・同じ条件の既定をユーザーの割り当てが上書きする', () => {
    // ctrl+j の既定（Terminal の開閉）と同じ条件を持つ Files の開閉へ付け替える。
    const entries = resolveWith([{ key: 'ctrl+j', command: 'view.togglePanel.files' }])

    expect(dispatchKeybinding(chord('ctrl+j'), editorContext, entries)).toBe(
      'view.togglePanel.files'
    )
    expect(entries.filter((entry) => entry.token === 'ctrl+j')).toHaveLength(1)
  })

  it('解除だけした打鍵は、どの command にも当たらない', () => {
    const entries = resolveWith([{ key: 'ctrl+s', command: '-editor.save' }])

    expect(dispatchKeybinding(chord('ctrl+s'), editorContext, entries)).toBeNull()
    expect(entries.some((entry) => entry.commandId === 'editor.save')).toBe(false)
  })
})
