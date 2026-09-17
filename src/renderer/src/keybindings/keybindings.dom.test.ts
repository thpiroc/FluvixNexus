/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../commands/CommandProvider'
import { CommandContext } from '../commands/context'
import { useCommand } from '../commands/useCommand'
import { EditorContext } from '../editor/context'
import type { EditorController } from '../editor/useEditorSession'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { KeybindingProvider } from './KeybindingProvider'
import { useWhenFlag } from './useWhenFlag'

/**
 * 打鍵の受け口（Session 4-7A）。
 *
 * 純粋層（chord / when / resolve / dispatch）は素のテストで見てあるので、
 * ここで見るのは**DOM が絡む所だけ**にする。
 *
 *   - 所有者の mount / unmount で command が入れ替わる
 *   - focus がどのパネルにあるかで結果が変わる
 *   - `preventDefault()` を呼ぶ条件
 *   - Monaco / xterm と衝突しないための前提
 */

/*
  `keybindings.json` の読み込みは返さない（既定の割り当てだけで動く状態のまま）。
  ユーザーの割り当てが絡む振る舞いは userKeybindings.dom.test.ts（Shortcuts S3）。
*/
vi.mock('../api/fluvix', () => ({
  fluvix: { keybindings: { load: () => new Promise(() => {}), save: vi.fn() } }
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

function render(node: ReactElement): void {
  act(() => root.render(node))
}

function mockWorkspace(): WorkspaceFolderController {
  return {
    status: 'ready',
    workspace: {
      id: 'w1',
      rootPath: 'D:\\project',
      displayName: 'project',
      exists: true,
      openedAt: 0
    },
    unavailableRootPath: null,
    error: null,
    busy: false,
    openFolder: () => {},
    closeWorkspace: () => {}
  }
}

function mockEditor(activeTab: unknown): EditorController {
  return { activeTab } as unknown as EditorController
}

/** Provider を積んだ器。中身のパネルは `data-panel-body` を持つ本物と同じ形にする。 */
function harness(children: ReactNode, activeTab: unknown = null): ReactElement {
  return createElement(
    CommandProvider,
    null,
    createElement(
      WorkspaceFolderContext.Provider,
      { value: mockWorkspace() },
      createElement(
        EditorContext.Provider,
        { value: mockEditor(activeTab) },
        createElement(KeybindingProvider, null, children)
      )
    )
  )
}

/** 実際の打鍵と同じ形のイベントを窓へ流し、`preventDefault` されたかを返す。 */
function press(init: {
  key: string
  code: string
  ctrlKey?: boolean
  shiftKey?: boolean
}): boolean {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: false,
    shiftKey: false,
    ...init
  })

  act(() => {
    window.dispatchEvent(event)
  })

  return event.defaultPrevented
}

const CTRL_S = { key: 's', code: 'KeyS', ctrlKey: true }

describe('command の登録と実行', () => {
  it('所有者が mount している間だけ実行できる', () => {
    const save = vi.fn()

    function Owner(): null {
      useCommand('editor.save', save)

      return null
    }

    render(harness(createElement(Owner)))
    expect(press(CTRL_S)).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)

    // 所有者が居なくなる（パネルを閉じた・Provider が外れた）。
    render(harness(null))
    expect(press(CTRL_S)).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('handler が作り直されても登録し直さない（最新が呼ばれる）', () => {
    const calls: string[] = []

    function Owner({ label }: { label: string }): null {
      // 毎回新しい関数（useCallback を通していない）。
      useCommand('editor.save', () => calls.push(label))

      return null
    }

    render(harness(createElement(Owner, { label: 'first' })))
    press(CTRL_S)

    render(harness(createElement(Owner, { label: 'second' })))
    press(CTRL_S)

    expect(calls).toEqual(['first', 'second'])
  })

  it('同じ command id を2つ登録すると例外になる', () => {
    function Owner(): null {
      useCommand('editor.save', () => {})

      return null
    }

    /*
      後勝ちにしない理由は commands/context.ts。所有者が2つあるのは
      設計の間違いで、黙って片方が死ぬ形にすると気付けない。
    */
    expect(() => {
      render(harness([createElement(Owner, { key: 'a' }), createElement(Owner, { key: 'b' })]))
    }).toThrow(/already registered/)
  })

  it('登録も解除もしていない command は、実行しても何も起きない', () => {
    render(harness(null))

    // 例外にはならない（所有者が居ないのは失敗ではない）。
    expect(press(CTRL_S)).toBe(false)
  })
})

describe('preventDefault を呼ぶ条件', () => {
  it('command を実行できたときだけ呼ぶ', () => {
    function Owner(): null {
      useCommand('editor.save', () => {})

      return null
    }

    render(harness(createElement(Owner)))

    // 割り当てのある打鍵 → 実行できた → 止める。
    expect(press(CTRL_S)).toBe(true)
    // 割り当ての無い打鍵 → 止めない（ブラウザの既定を殺さない）。
    expect(press({ key: 'z', code: 'KeyZ', ctrlKey: true })).toBe(false)
    // 修飾キー単体 → 止めない。
    expect(press({ key: 'Control', code: 'ControlLeft', ctrlKey: true })).toBe(false)
  })

  it('所有者が居ない command のためにブラウザの既定を止めない', () => {
    render(harness(null))

    expect(press(CTRL_S)).toBe(false)
  })

  it('条件が合わなければ止めない', () => {
    const saveAs = vi.fn()

    function Owner(): null {
      useCommand('editor.saveAs', saveAs)

      return null
    }

    // タブが1枚も無い（`editorHasActiveTab` が false）。
    render(harness(createElement(Owner), null))
    expect(press({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(saveAs).not.toHaveBeenCalled()

    // タブがある。
    render(harness(createElement(Owner), { id: 'tab-1' }))
    expect(press({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(saveAs).toHaveBeenCalledTimes(1)
  })
})

describe('focus がどこにあるか', () => {
  /** `workspace/shell/PanelGroup.tsx` が本体の器へ付ける印と同じ形。 */
  function panelBody(panelId: string, inputId: string): ReactElement {
    return createElement(
      'div',
      { 'data-panel-body': panelId },
      createElement('input', { id: inputId, type: 'text' })
    )
  }

  function focus(inputId: string): void {
    document.getElementById(inputId)?.focus()
  }

  it('Terminal の中では、端末で意味を持つ打鍵を横取りしない', () => {
    const toggle = vi.fn()

    function Owner(): ReactElement {
      useCommand('view.togglePanel.terminal', toggle)

      return createElement('div', null, panelBody('terminal', 'term'), panelBody('editor', 'edit'))
    }

    render(harness(createElement(Owner)))

    // 端末に focus。Ctrl+J は端末では改行（0x0A）なので、シェルへ通す。
    focus('term')
    expect(press({ key: 'j', code: 'KeyJ', ctrlKey: true })).toBe(false)
    expect(toggle).not.toHaveBeenCalled()

    // Editor に focus。ここでは横取りしてよい。
    focus('edit')
    expect(press({ key: 'j', code: 'KeyJ', ctrlKey: true })).toBe(true)
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('editor.save は terminalFocused でも降りない（移設前と同じ条件）', () => {
    /*
      実機では xterm が Ctrl+S を伝播ごと止めるため、端末に focus があるときは
      そもそもここまで届かない（移設前の listener も同じ）。この判定が見ているのは
      **rule に条件を足していないこと**で、それが「Files のツリーや Git の面に
      focus があるときに効く」を保っている（defaults.ts の `editor.save`）。
    */
    const save = vi.fn()

    function Owner(): ReactElement {
      useCommand('editor.save', save)

      return panelBody('terminal', 'term')
    }

    render(harness(createElement(Owner)))
    focus('term')

    expect(press(CTRL_S)).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('パネルのタブに focus があっても「そのパネルの中」とは見なさない', () => {
    const toggle = vi.fn()

    function Owner(): ReactElement {
      useCommand('view.togglePanel.terminal', toggle)

      return createElement(
        'div',
        null,
        // タブ側の印（PanelGroup.tsx の `data-panel`）。本体の外にある。
        createElement(
          'div',
          { 'data-panel': 'terminal' },
          createElement('button', { id: 'tab', type: 'button' })
        ),
        panelBody('terminal', 'term')
      )
    }

    render(harness(createElement(Owner)))
    document.getElementById('tab')?.focus()

    expect(press({ key: 'j', code: 'KeyJ', ctrlKey: true })).toBe(true)
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})

describe('確認ダイアログが出ている間', () => {
  it('その裏では command が走らない', () => {
    const save = vi.fn()

    function Owner(): ReactElement {
      useCommand('editor.save', save)

      // 6つの確認ダイアログが実際に付けている属性（unsaved/UnsavedChangesDialog.tsx ほか）。
      return createElement('div', { role: 'dialog', 'aria-modal': 'true' })
    }

    render(harness(createElement(Owner)))

    expect(press(CTRL_S)).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('`aria-modal="false"` の面（Settings・Git の各面）は遮らない', () => {
    const save = vi.fn()

    function Owner(): ReactElement {
      useCommand('editor.save', save)

      return createElement('div', { role: 'dialog', 'aria-modal': 'false' })
    }

    render(harness(createElement(Owner)))

    expect(press(CTRL_S)).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('useWhenFlag', () => {
  it('申告した条件が打鍵の判定へ届く', () => {
    const toggle = vi.fn()

    function Owner({ settingsOpen }: { settingsOpen: boolean }): null {
      useCommand('view.togglePanel.files', toggle)
      useWhenFlag('settingsOpen', settingsOpen)

      return null
    }

    render(harness(createElement(Owner, { settingsOpen: false })))
    expect(press({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(toggle).toHaveBeenCalledTimes(1)

    // 面が出ている間は、その裏でレイアウトを変えない。
    render(harness(createElement(Owner, { settingsOpen: true })))
    expect(press({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})

describe('Monaco / xterm と衝突しないための前提', () => {
  it('Monaco / xterm が処理した打鍵は、伝播が止まっているので届かない', () => {
    /*
      どちらも自分が処理した打鍵に preventDefault と **stopPropagation の両方**を
      呼ぶ（Monaco は standaloneServices.js の StandaloneKeybindingService、
      xterm は CoreBrowserTerminal の `cancel(event, true)`）。
      その状況を、器の途中で伝播を止めることで再現する。

      実機でも確かめてある（Session 4-7A）── 端末に focus を置いて Ctrl+S を
      打つと、window listener には `Control` しか届かない。
    */
    const save = vi.fn()

    function Owner(): ReactElement {
      useCommand('editor.save', save)

      return createElement('div', {
        id: 'monaco',
        ref: (node: HTMLDivElement | null) => {
          node?.addEventListener('keydown', (event) => event.stopPropagation())
        }
      })
    }

    render(harness(createElement(Owner)))

    const monaco = document.getElementById('monaco')!
    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })

    act(() => {
      monaco.dispatchEvent(event)
    })

    expect(save).not.toHaveBeenCalled()
  })

  it('preventDefault だけされた打鍵は、まだ受ける', () => {
    /*
      `event.defaultPrevented` を見て降りる作りにしていない、ということ
      （KeybindingProvider.tsx）。

      Monaco も xterm も伝播ごと止めるので、この判定を足しても防げるものは
      増えない。一方で `preventDefault()` だけを呼ぶ無関係な handler
      （入力欄の Enter など）が1つ増えるたびに、**割り当てが黙って効かなくなる
      経路**ができる ── 買えるものが無く、失うものがある判定なので置いていない。
    */
    const save = vi.fn()

    function Owner(): null {
      useCommand('editor.save', save)

      return null
    }

    render(harness(createElement(Owner)))

    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })

    event.preventDefault()

    act(() => {
      window.dispatchEvent(event)
    })

    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('Provider の外では使えない', () => {
  it('CommandProvider の外で useCommand を呼ぶと例外', () => {
    function Orphan(): null {
      useCommand('editor.save', () => {})

      return null
    }

    expect(() => render(createElement(Orphan))).toThrow(/CommandProvider/)
  })

  it('KeybindingProvider の外で useWhenFlag を呼ぶと例外', () => {
    function Orphan(): null {
      useWhenFlag('settingsOpen', true)

      return null
    }

    expect(() =>
      render(createElement(CommandContext.Provider, { value: null }, createElement(Orphan)))
    ).toThrow(/KeybindingProvider/)
  })
})
