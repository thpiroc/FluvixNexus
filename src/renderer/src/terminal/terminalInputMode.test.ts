import { describe, expect, it } from 'vitest'
import {
  AI_CLI_NEWLINE,
  AI_CLI_SUBMIT,
  aiCliInputAction,
  type TerminalInputKeyStroke
} from './terminalInputMode'

/**
 * AI CLI モードの読み替え（terminalInputMode.ts）。
 *
 * 通常モードのタブはこの関数を通らない（TerminalSurface.tsx）ので、ここで確かめるのは
 * 「AI CLI モードで何を取り、何を xterm へ通すか」だけになる。
 */

function stroke(overrides: Partial<TerminalInputKeyStroke>): TerminalInputKeyStroke {
  return {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    isComposing: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides
  }
}

describe('aiCliInputAction — Enter', () => {
  it('Enter は改行（0x0A）', () => {
    expect(aiCliInputAction(stroke({}))).toEqual({ kind: 'send', data: '\n' })
    expect(AI_CLI_NEWLINE).toBe('\x0a')
  })

  it('Shift+Enter も改行', () => {
    expect(aiCliInputAction(stroke({ shiftKey: true }))).toEqual({ kind: 'send', data: '\n' })
  })

  it('Ctrl+Enter は送信（0x0D）', () => {
    expect(aiCliInputAction(stroke({ ctrlKey: true }))).toEqual({ kind: 'send', data: '\r' })
    expect(AI_CLI_SUBMIT).toBe('\x0d')
  })

  it('テンキーの Enter も同じ扱い', () => {
    expect(aiCliInputAction(stroke({ code: 'NumpadEnter' }))).toEqual({
      kind: 'send',
      data: '\n'
    })
  })

  it('Alt / Meta 付き・Ctrl+Shift+Enter は xterm へ通す', () => {
    expect(aiCliInputAction(stroke({ altKey: true }))).toBeNull()
    expect(aiCliInputAction(stroke({ metaKey: true }))).toBeNull()
    expect(aiCliInputAction(stroke({ ctrlKey: true, shiftKey: true }))).toBeNull()
  })
})

describe('aiCliInputAction — IME', () => {
  it('変換中の Enter（確定）は取らない', () => {
    expect(aiCliInputAction(stroke({ isComposing: true }))).toBeNull()
  })

  it('keyCode 229（IME が処理中）の打鍵は取らない', () => {
    expect(aiCliInputAction(stroke({ key: 'Process', keyCode: 229 }))).toBeNull()
    expect(aiCliInputAction(stroke({ keyCode: 229, ctrlKey: true }))).toBeNull()
  })
})

describe('aiCliInputAction — Ctrl+V', () => {
  const ctrlV = stroke({ key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true })

  it('Ctrl+V は貼り付け', () => {
    expect(aiCliInputAction(ctrlV)).toEqual({ kind: 'paste' })
  })

  it('物理キーで見る（Caps Lock などで key が大文字でも同じ）', () => {
    expect(aiCliInputAction({ ...ctrlV, key: 'V' })).toEqual({ kind: 'paste' })
  })

  it('code が取れないときだけ key で見る', () => {
    expect(aiCliInputAction({ ...ctrlV, code: '' })).toEqual({ kind: 'paste' })
    expect(aiCliInputAction({ ...ctrlV, code: 'KeyB', key: 'v' })).toBeNull()
  })

  it('Ctrl+Shift+V・Alt 付き・Ctrl 無しは xterm へ通す', () => {
    expect(aiCliInputAction({ ...ctrlV, shiftKey: true })).toBeNull()
    expect(aiCliInputAction({ ...ctrlV, altKey: true })).toBeNull()
    expect(aiCliInputAction({ ...ctrlV, ctrlKey: false })).toBeNull()
  })
})

describe('aiCliInputAction — それ以外', () => {
  it('ほかの打鍵には触らない（Ctrl+C・Ctrl+J・文字）', () => {
    expect(
      aiCliInputAction(stroke({ key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true }))
    ).toBeNull()
    expect(
      aiCliInputAction(stroke({ key: 'j', code: 'KeyJ', keyCode: 74, ctrlKey: true }))
    ).toBeNull()
    expect(aiCliInputAction(stroke({ key: 'a', code: 'KeyA', keyCode: 65 }))).toBeNull()
  })
})
