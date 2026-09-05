import { describe, expect, it } from 'vitest'
import {
  chordFromEvent,
  chordToken,
  formatKeybinding,
  parseKeybinding,
  type KeyStrokeLike
} from './chord'

function stroke(
  overrides: Partial<KeyStrokeLike> & Pick<KeyStrokeLike, 'key' | 'code'>
): KeyStrokeLike {
  return {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides
  }
}

describe('parseKeybinding', () => {
  it('修飾子と主キーを読む', () => {
    expect(parseKeybinding('ctrl+shift+s')).toEqual({
      key: 's',
      ctrl: true,
      shift: true,
      alt: false,
      meta: false
    })
  })

  it('修飾子の順序に依存しない', () => {
    expect(parseKeybinding('shift+ctrl+s')).toEqual(parseKeybinding('ctrl+shift+s'))
  })

  it('大文字・前後の空白を吸収する', () => {
    expect(parseKeybinding('  Ctrl+Shift+S  ')).toEqual(parseKeybinding('ctrl+shift+s'))
  })

  it('`control` と `cmd` を別名として受ける', () => {
    expect(parseKeybinding('control+s')).toEqual(parseKeybinding('ctrl+s'))
    expect(parseKeybinding('cmd+s')).toEqual(parseKeybinding('meta+s'))
  })

  it('記号そのものを主キーにできる（`ctrl++` は Ctrl と `+` キー）', () => {
    expect(parseKeybinding('ctrl++')?.key).toBe('+')
    expect(parseKeybinding('ctrl+,')?.key).toBe(',')
    expect(parseKeybinding('ctrl+`')?.key).toBe('`')
  })

  it('名前の付いたキーを読む', () => {
    expect(parseKeybinding('f1')?.key).toBe('f1')
    expect(parseKeybinding('ctrl+enter')?.key).toBe('enter')
    expect(parseKeybinding('alt+up')?.key).toBe('up')
  })

  it('読めない形は null', () => {
    expect(parseKeybinding('')).toBeNull()
    expect(parseKeybinding('   ')).toBeNull()
    // 主キーが無い
    expect(parseKeybinding('ctrl+')).toBeNull()
    // 同じ修飾子を2度
    expect(parseKeybinding('ctrl+ctrl+s')).toBeNull()
    // 知らない名前
    expect(parseKeybinding('ctrl+notakey')).toBeNull()
    expect(parseKeybinding('f99')).toBeNull()
  })
})

describe('chordFromEvent', () => {
  it('英字は `event.code` の位置で決める（配列に依存しない）', () => {
    expect(chordFromEvent(stroke({ key: 's', code: 'KeyS', ctrlKey: true }))?.key).toBe('s')
    // Shift が付くと `event.key` は 'E' になるが、位置は変わらない。
    expect(
      chordFromEvent(stroke({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true }))?.key
    ).toBe('e')
  })

  it('数字も位置で決める', () => {
    expect(chordFromEvent(stroke({ key: '1', code: 'Digit1' }))?.key).toBe('1')
    // 日本語配列で Shift + 2 は '"' になるが、位置は Digit2 のまま。
    expect(chordFromEvent(stroke({ key: '"', code: 'Digit2', shiftKey: true }))?.key).toBe('2')
  })

  it('記号は US 配列の刻印を名前にする（日本語配列でも同じ位置を指す）', () => {
    expect(chordFromEvent(stroke({ key: ',', code: 'Comma', ctrlKey: true }))?.key).toBe(',')
    expect(chordFromEvent(stroke({ key: '@', code: 'BracketLeft' }))?.key).toBe('[')
  })

  it('名前の付いたキーを読む', () => {
    expect(chordFromEvent(stroke({ key: 'Enter', code: 'Enter' }))?.key).toBe('enter')
    expect(chordFromEvent(stroke({ key: 'ArrowUp', code: 'ArrowUp' }))?.key).toBe('up')
    expect(chordFromEvent(stroke({ key: 'F1', code: 'F1' }))?.key).toBe('f1')
  })

  it('修飾キーそのものは打鍵にならない', () => {
    expect(
      chordFromEvent(stroke({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))
    ).toBeNull()
    expect(chordFromEvent(stroke({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull()
    expect(chordFromEvent(stroke({ key: 'Alt', code: 'AltLeft', altKey: true }))).toBeNull()
    expect(chordFromEvent(stroke({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull()
  })

  it('`code` で決められなければ `key` へ落ちる', () => {
    // テンキーなど、表に無い位置。
    expect(chordFromEvent(stroke({ key: '5', code: 'Numpad5' }))?.key).toBe('5')
  })

  it('`code` でも `key` でも決められなければ null', () => {
    expect(chordFromEvent(stroke({ key: 'Unidentified', code: 'Unknown' }))).toBeNull()
  })

  it('修飾子をそのまま持つ', () => {
    expect(
      chordFromEvent(
        stroke({
          key: 's',
          code: 'KeyS',
          ctrlKey: true,
          shiftKey: true,
          altKey: true,
          metaKey: true
        })
      )
    ).toEqual({ key: 's', ctrl: true, shift: true, alt: true, meta: true })
  })
})

describe('chordToken', () => {
  it('修飾子の並びを固定する（表を引く鍵になるため）', () => {
    expect(chordToken({ key: 's', ctrl: true, shift: true, alt: false, meta: false })).toBe(
      'ctrl+shift+s'
    )
    expect(chordToken({ key: 's', ctrl: false, shift: false, alt: false, meta: false })).toBe('s')
  })

  it('打鍵と、書かれた割り当てが同じ鍵になる', () => {
    const fromEvent = chordFromEvent(
      stroke({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })
    )
    const fromText = parseKeybinding('shift+ctrl+s')

    expect(fromEvent).not.toBeNull()
    expect(fromText).not.toBeNull()
    expect(chordToken(fromEvent!)).toBe(chordToken(fromText!))
  })

  it('parse → token は元の正規形へ戻る', () => {
    for (const text of ['ctrl+s', 'ctrl+shift+s', 'alt+up', 'ctrl+,', 'f1', 'ctrl+alt+meta+x']) {
      expect(chordToken(parseKeybinding(text)!)).toBe(text)
    }
  })
})

describe('formatKeybinding', () => {
  it('画面に出す形にする', () => {
    expect(formatKeybinding(parseKeybinding('ctrl+shift+s')!)).toBe('Ctrl+Shift+S')
    expect(formatKeybinding(parseKeybinding('ctrl+,')!)).toBe('Ctrl+,')
    expect(formatKeybinding(parseKeybinding('alt+up')!)).toBe('Alt+Up')
    expect(formatKeybinding(parseKeybinding('f1')!)).toBe('F1')
  })
})
