import { describe, expect, it } from 'vitest'
import { isCommandId } from '../commands/commandIds'
import { chordToken, parseKeybinding } from './chord'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { findKeybindingConflicts, resolveKeybindings } from './resolve'
import { parseWhenClause } from './when'

/**
 * 既定の割り当て（Session 4-7A）。
 *
 * ここは「実装が正しいか」ではなく**選び方の約束が守られているか**を見る。
 * 割り当てを1つ足すときに、うっかり Monaco や端末の打鍵を取っていないかを
 * 機械が先に言う形にしておく。
 */

const resolution = resolveKeybindings(DEFAULT_KEYBINDINGS)

describe('DEFAULT_KEYBINDINGS', () => {
  it('すべて既知の command を指す', () => {
    for (const rule of DEFAULT_KEYBINDINGS) {
      expect(isCommandId(rule.commandId)).toBe(true)
    }
  })

  it('すべて打鍵として読める', () => {
    expect(resolution.invalid).toEqual([])
    expect(resolution.entries).toHaveLength(DEFAULT_KEYBINDINGS.length)
  })

  it('条件はすべて既知（綴りの間違いを残さない）', () => {
    for (const rule of DEFAULT_KEYBINDINGS) {
      for (const clause of rule.when ?? []) {
        expect(parseWhenClause(clause), `${rule.commandId}: ${clause}`).not.toBeNull()
      }
    }
  })

  it('v1 が作るのは default だけ', () => {
    for (const rule of DEFAULT_KEYBINDINGS) {
      expect(rule.source).toBe('default')
    }
  })

  it('既定どうしで競合しない', () => {
    expect(findKeybindingConflicts(resolution.entries)).toEqual([])
  })
})

describe('取らないと決めた打鍵', () => {
  const tokens = new Set(resolution.entries.map((entry) => entry.token))

  it('Command Palette の席（Ctrl+P / Ctrl+Shift+P）を空けてある', () => {
    expect(tokens.has('ctrl+p')).toBe(false)
    expect(tokens.has('ctrl+shift+p')).toBe(false)
  })

  it('Monaco の既定を取らない', () => {
    /*
      取ると Editor の中でそれらが死ぬ。実際には Monaco が
      stopPropagation するのでここまで上がってこないが、
      **割り当てとして書いてしまうこと自体**を止める
      （設定画面に出た割り当てが効かない、という食い違いになる）。
    */
    for (const reserved of [
      'ctrl+f',
      'ctrl+h',
      'ctrl+g',
      'ctrl+/',
      'ctrl+d',
      'ctrl+shift+k',
      'ctrl+shift+f'
    ]) {
      expect(tokens.has(reserved), reserved).toBe(false)
    }
  })

  it('日本語配列で半角/全角キーになる位置（Ctrl+`）を使わない', () => {
    expect(tokens.has('ctrl+`')).toBe(false)
  })

  it('Terminal の文字の大きさ（Ctrl + `+` / `-` / `0`）を取らない', () => {
    // 既存の経路（terminal/terminalDisplay.ts）のまま。Session 4-7B の判断へ送ってある。
    for (const reserved of ['ctrl+=', 'ctrl+-', 'ctrl+0', 'ctrl++']) {
      expect(tokens.has(reserved), reserved).toBe(false)
    }
  })
})

describe('端末を触っている最中にアプリ側の操作を走らせない', () => {
  /*
    xterm が消費する打鍵（Ctrl+J = 0x0A など）は `stopPropagation` されて
    window まで上がってこないが、**消費しない打鍵は上がってくる**
    （`ctrl+,` は実機で確認済み。keybindings/KeybindingProvider.tsx）。
    条件が無ければ、端末で打っている最中に Settings が開くことになる。

    例外は `editor.save` だけで、これは移設前と条件を揃えるため（下）。
  */
  it('editor.save 以外の Ctrl 系はすべて `!terminalFocused` を持つ', () => {
    for (const rule of DEFAULT_KEYBINDINGS) {
      if (rule.commandId === 'editor.save') {
        continue
      }

      const chord = parseKeybinding(rule.key)

      if (chord === null || !chord.ctrl) {
        continue
      }

      expect(rule.when ?? [], `${rule.commandId} (${rule.key})`).toContain('!terminalFocused')
    }
  })
})

describe('移設前の Ctrl+S と同じであること', () => {
  /*
    Session 3-5 〜 4-5B の `editor/useEditorSession.ts` は、`window` へ直接
    Ctrl+S を掛けていた ── **条件を1つも持っていなかった。**
    ここでも条件を持たせないことで、届く打鍵の範囲が移設の前後で変わらない。

    （端末に focus があるときは、そもそも xterm が伝播ごと止めるので
    どちらの実装にも届かない。defaults.ts の `editor.save`）

    移設で変わってよいのは「確認ダイアログの裏では走らない」の1点だけで、
    それは rule ではなく dispatch の全体規則にしてある（dispatch.test.ts）。
  */
  it('editor.save は ctrl+s に、条件なしで割り当てられている', () => {
    const save = DEFAULT_KEYBINDINGS.filter((rule) => rule.commandId === 'editor.save')

    expect(save).toHaveLength(1)
    expect(chordToken(parseKeybinding(save[0].key)!)).toBe('ctrl+s')
    expect(save[0].when ?? []).toEqual([])
  })
})
