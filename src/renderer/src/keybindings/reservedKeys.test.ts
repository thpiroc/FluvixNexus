import { describe, expect, it } from 'vitest'
import { parseKeybinding } from './chord'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { isAssignableChord } from './editKeybindings'
import { RESERVED_KEYS, reservedKeyReasons } from './reservedKeys'

describe('RESERVED_KEYS', () => {
  it('すべての打鍵が読め、chordToken の形で書かれている', () => {
    for (const entry of RESERVED_KEYS) {
      const chord = parseKeybinding(entry.key)

      expect(chord, entry.key).not.toBeNull()
    }
  })

  /*
    割り当てられない打鍵（S4 の isAssignableChord が断る）を並べても、警告を出す場面が無い。
  */
  it('どれも割り当てられる打鍵（警告を出す場面がある）', () => {
    for (const entry of RESERVED_KEYS) {
      const chord = parseKeybinding(entry.key)

      expect(chord !== null && isAssignableChord(chord), entry.key).toBe(true)
    }
  })

  it('同じ打鍵 × 同じ理由を2度載せていない', () => {
    const seen = RESERVED_KEYS.map((entry) => `${entry.key}:${entry.reason}`)

    expect(new Set(seen).size).toBe(seen.length)
  })

  it('既定の割り当ては、自分の条件で予約キーに重ならない', () => {
    for (const rule of DEFAULT_KEYBINDINGS) {
      expect(reservedKeyReasons(rule.key, rule.when ?? []), rule.commandId).toEqual([])
    }
  })
})

describe('reservedKeyReasons', () => {
  it('入力欄の編集キーは、どこで効く command でも警告する', () => {
    expect(reservedKeyReasons('ctrl+c', [])).toEqual(['textEditing'])
    expect(reservedKeyReasons('ctrl+shift+z', ['editorFocused'])).toEqual(['textEditing'])
  })

  it('書き方の違い（大文字・修飾子の順）を吸収する', () => {
    expect(reservedKeyReasons('Ctrl+P', [])).toEqual(['commandPalette'])
    expect(reservedKeyReasons('shift+ctrl+p', [])).toEqual(['commandPalette'])
  })

  it('予約されていない打鍵・読めない打鍵は何も返さない', () => {
    expect(reservedKeyReasons('ctrl+alt+k', [])).toEqual([])
    expect(reservedKeyReasons('ctrl+nope', [])).toEqual([])
  })

  describe('条件が重なるときだけ', () => {
    it('Git の Ctrl+Enter：エディターの中だけの command なら重ならない', () => {
      expect(reservedKeyReasons('ctrl+enter', ['!terminalFocused'])).toEqual(['gitCommit'])
      expect(reservedKeyReasons('ctrl+enter', [])).toEqual(['gitCommit'])
      expect(reservedKeyReasons('ctrl+enter', ['editorFocused', '!terminalFocused'])).toEqual([])
    })

    it('Files の F2：エディターの中だけの command（シンボル名の変更）なら重ならない', () => {
      expect(reservedKeyReasons('f2', ['editorFocused'])).toEqual([])
      expect(reservedKeyReasons('f2', ['workspaceOpen'])).toEqual(['filesRename'])
    })

    it('エディターの検索：エディターの中でも効く command だけ', () => {
      expect(reservedKeyReasons('ctrl+f', ['editorFocused'])).toEqual(['editorFind'])
      expect(reservedKeyReasons('ctrl+f', [])).toEqual(['editorFind'])
      expect(reservedKeyReasons('ctrl+f', ['!editorFocused'])).toEqual([])
    })

    it('端末の文字の大きさ：端末を避ける command なら重ならない', () => {
      expect(reservedKeyReasons('ctrl+=', [])).toEqual(['terminalFontSize'])
      expect(reservedKeyReasons('ctrl+0', ['!terminalFocused'])).toEqual([])
      /* 日本語配列の `+`（Shift + `;`）。 */
      expect(reservedKeyReasons('ctrl+shift+;', [])).toEqual(['terminalFontSize'])
    })
  })

  it('IME の切り替え・ウィンドウを閉じる打鍵', () => {
    expect(reservedKeyReasons('alt+`', ['!terminalFocused'])).toEqual(['imeToggle'])
    expect(reservedKeyReasons('alt+f4', [])).toEqual(['windowClose'])
  })
})
