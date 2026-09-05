import { describe, expect, it } from 'vitest'
import { parseKeybinding } from './chord'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { dispatchKeybinding } from './dispatch'
import { resolveKeybindings, type KeybindingRule } from './resolve'
import { emptyWhenContext, type WhenContext } from './when'

function context(overrides: Partial<WhenContext> = {}): WhenContext {
  return { ...emptyWhenContext(), ...overrides }
}

function table(rules: readonly KeybindingRule[] = DEFAULT_KEYBINDINGS) {
  return resolveKeybindings(rules).entries
}

function press(key: string, ctx: WhenContext = context(), rules?: readonly KeybindingRule[]) {
  return dispatchKeybinding(parseKeybinding(key)!, ctx, table(rules))
}

describe('dispatchKeybinding', () => {
  it('割り当てのある打鍵は command を返す', () => {
    expect(press('ctrl+s')).toBe('editor.save')
  })

  it('割り当ての無い打鍵は null', () => {
    expect(press('ctrl+shift+z')).toBeNull()
    // 席を空けてあるもの（Command Palette）。
    expect(press('ctrl+p')).toBeNull()
    expect(press('ctrl+shift+p')).toBeNull()
  })

  it('条件が合わなければ null', () => {
    expect(press('ctrl+shift+s', context({ editorHasActiveTab: false }))).toBeNull()
    expect(press('ctrl+shift+s', context({ editorHasActiveTab: true }))).toBe('editor.saveAs')
  })

  it('同じ打鍵に複数当たれば後ろが勝つ', () => {
    const rules: readonly KeybindingRule[] = [
      { commandId: 'editor.save', key: 'ctrl+x', source: 'default' },
      { commandId: 'settings.open', key: 'ctrl+x', when: ['workspaceOpen'], source: 'user' }
    ]

    expect(press('ctrl+x', context({ workspaceOpen: true }), rules)).toBe('settings.open')
    // 条件が外れれば、前の rule が残っている。
    expect(press('ctrl+x', context({ workspaceOpen: false }), rules)).toBe('editor.save')
  })
})

describe('Terminal に focus があるとき', () => {
  it('端末を触っている最中にアプリ側の操作を走らせない', () => {
    const terminal = context({ terminalFocused: true })

    /*
      xterm が消費する打鍵（Ctrl+J = 0x0A など）は伝播ごと止まるので、
      実機ではそもそもここへ来ない。**来るものもある** ── `ctrl+,` は
      xterm が消費せず window まで上がる（実機で確認。KeybindingProvider.tsx）。
      条件が効いているのはそちらで、この判定はその両方をまとめて受ける。
    */
    expect(press('ctrl+j', terminal)).toBeNull()
    expect(press('ctrl+o', terminal)).toBeNull()
    expect(press('ctrl+,', terminal)).toBeNull()
    expect(press('ctrl+shift+e', terminal)).toBeNull()
    expect(press('ctrl+shift+g', terminal)).toBeNull()
    expect(press('ctrl+shift+s', { ...terminal, editorHasActiveTab: true })).toBeNull()
  })

  it('editor.save だけは条件を持たない（移設前と同じ）', () => {
    /*
      「端末の中でも保存される」という意味ではない ── 実機では xterm が
      Ctrl+S を伝播ごと止めるため、ここまで届かない。移設前の listener も
      同じ形だったので、届く範囲は前後で変わっていない（defaults.ts）。
    */
    expect(press('ctrl+s', context({ terminalFocused: true }))).toBe('editor.save')
  })

  it('端末の外なら通る', () => {
    expect(press('ctrl+j', context({ terminalFocused: false }))).toBe('view.togglePanel.terminal')
  })
})

describe('Settings の面が出ているとき', () => {
  it('パネルの開閉は走らない（面の裏でレイアウトが変わらない）', () => {
    const open = context({ settingsOpen: true })

    expect(press('ctrl+shift+e', open)).toBeNull()
    expect(press('ctrl+j', open)).toBeNull()
  })

  it('保存は走る（面は操作を遮っていない ── aria-modal="false"）', () => {
    expect(press('ctrl+s', context({ settingsOpen: true }))).toBe('editor.save')
  })
})

describe('確認ダイアログが出ているとき', () => {
  /*
    `modalOpen` は rule ごとではなく全体に掛かる唯一の条件（dispatch.ts の冒頭）。
    失われるものがある操作を訊いている最中に、その裏で別の操作が走らないようにする。
  */
  it('既定では、どの command も走らない', () => {
    const modal = context({ modalOpen: true, editorHasActiveTab: true })

    expect(press('ctrl+s', modal)).toBeNull()
    expect(press('ctrl+shift+s', modal)).toBeNull()
    expect(press('ctrl+j', modal)).toBeNull()
    expect(press('ctrl+,', modal)).toBeNull()
  })

  it('`modalOpen` を明示した rule だけが走る', () => {
    const rules: readonly KeybindingRule[] = [
      { commandId: 'settings.close', key: 'ctrl+x', when: ['modalOpen'], source: 'default' }
    ]

    expect(press('ctrl+x', context({ modalOpen: true }), rules)).toBe('settings.close')
    // 逆に、ダイアログが出ていなければ条件が合わない。
    expect(press('ctrl+x', context({ modalOpen: false }), rules)).toBeNull()
  })

  it('Session 4-7A の既定には、裏で走る rule が1つも無い', () => {
    for (const rule of DEFAULT_KEYBINDINGS) {
      expect(rule.when ?? []).not.toContain('modalOpen')
    }
  })
})
