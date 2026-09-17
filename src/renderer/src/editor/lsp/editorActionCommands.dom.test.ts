/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../commands/CommandProvider'
import { useCommands, type CommandRegistryController } from '../../commands/context'
import { EditorContext } from '../context'
import { KeybindingProvider } from '../../keybindings/KeybindingProvider'
import {
  WorkspaceFolderContext,
  type WorkspaceFolderController
} from '../../workspaceFolder/context'
import type { EditorController } from '../useEditorSession'
import { EDITOR_ACTION_COMMAND_IDS, type EditorActionTarget } from './editorActions'
import { useEditorActionCommands } from './useEditorActionCommands'

/**
 * Language Server の操作を command / 打鍵から呼ぶ（Session 5-12）。
 *
 * 純粋層（editorActions.ts）は素のテストで見てあるので、ここで見るのは
 * **所有者と DOM が絡む所だけ**にする。
 *
 *   - エディタを持っている間だけ登録され、消えれば実行できなくなる
 *   - 打鍵が届く条件（`editorFocused`）
 *   - **Files の F2（ファイル名の変更）を奪わないこと**
 *   - 使えない Action（Pyright の整形）で何も起きないこと
 *
 * Monaco は読み込まない ── 叩く相手は構造的部分型で受けているため、
 * 偽のエディタで同じ経路を通せる（editorActions.ts の冒頭）。
 */

// `keybindings.json` の読み込みは返さない（既定の割り当てだけで動く。Shortcuts S3）。
vi.mock('../../api/fluvix', () => ({
  fluvix: { keybindings: { load: () => new Promise(() => {}), save: vi.fn() } }
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
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

function mockEditorContext(): EditorController {
  return { activeTab: { id: 'tab-1' } } as unknown as EditorController
}

let commands: CommandRegistryController | null = null

function Probe(): null {
  commands = useCommands()

  return null
}

function registry(): CommandRegistryController {
  if (commands === null) {
    throw new Error('CommandProvider の中で Probe が描かれていない。')
  }

  return commands
}

/** App.tsx と同じ順に Provider を積む。 */
function harness(children: ReactNode): ReactElement {
  return createElement(
    CommandProvider,
    null,
    createElement(Probe, null),
    createElement(
      WorkspaceFolderContext.Provider,
      { value: mockWorkspace() },
      createElement(
        EditorContext.Provider,
        { value: mockEditorContext() },
        createElement(KeybindingProvider, null, children)
      )
    )
  )
}

/**
 * 叩かれた Action を記録する偽のエディタ。
 *
 * `getAction()` は本物と同じく、`registerAction2` の側（定義 / 参照）へは
 * null を返す ── そこを true にすると、production で踏んだ落とし穴
 * （F12 / Shift+F12 だけ無反応）をこのテストが見逃す（lsp/editorActions.ts）。
 */
function fakeEditor(supported: (actionId: string) => boolean = () => true): {
  readonly target: EditorActionTarget
  readonly ran: () => readonly string[]
} {
  const ran: string[] = []
  const action2 = new Set(['editor.action.revealDefinition', 'editor.action.goToReferences'])

  return {
    target: {
      focus: () => {},
      getAction: (id) => (action2.has(id) ? null : { isSupported: () => supported(id) }),
      trigger: (_source, handlerId) => {
        ran.push(handlerId)
      }
    },
    ran: () => ran
  }
}

/**
 * Monaco の器の代わり。
 *
 * 本物（monaco/MonacoEditor.tsx）と同じく `data-panel-body="editor"` の中に居て、
 * 焦点を受け取れる要素を持つ。
 */
function Owner({
  editor,
  panel = 'editor'
}: {
  readonly editor: EditorActionTarget | null
  readonly panel?: string
}): ReactElement {
  useEditorActionCommands(() => editor)

  return createElement(
    'div',
    { 'data-panel-body': panel },
    createElement('textarea', { id: 'monaco' }),
    createElement('button', { id: 'toolbar', type: 'button' })
  )
}

function press(init: {
  key: string
  code: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): boolean {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init
  })

  act(() => {
    window.dispatchEvent(event)
  })

  return event.defaultPrevented
}

function focus(id: string): void {
  document.getElementById(id)?.focus()
}

const F12 = { key: 'F12', code: 'F12' }
const SHIFT_F12 = { key: 'F12', code: 'F12', shiftKey: true }
const F2 = { key: 'F2', code: 'F2' }
const SHIFT_ALT_F = { key: 'F', code: 'KeyF', shiftKey: true, altKey: true }
const CTRL_SPACE = { key: ' ', code: 'Space', ctrlKey: true }

describe('command の登録', () => {
  it('エディタを持つ器が居る間だけ、6つとも登録される', () => {
    const editor = fakeEditor()

    render(harness(createElement(Owner, { editor: editor.target })))

    for (const commandId of EDITOR_ACTION_COMMAND_IDS) {
      expect(registry().isRegistered(commandId), commandId).toBe(true)
    }

    /*
      器が消える（Editor パネルを閉じた・バイナリのタブへ切り替えた）。
      **失敗ではなく「今はその操作ができない」**（commands/context.ts）。
    */
    render(harness(null))

    for (const commandId of EDITOR_ACTION_COMMAND_IDS) {
      expect(registry().isRegistered(commandId), commandId).toBe(false)
      expect(registry().execute(commandId), commandId).toBe(false)
    }
  })

  it('command から Monaco の Action へ届く', () => {
    const editor = fakeEditor()

    render(harness(createElement(Owner, { editor: editor.target })))

    expect(registry().execute('editor.goToDefinition')).toBe(true)
    expect(registry().execute('editor.formatDocument')).toBe(true)

    expect(editor.ran()).toEqual(['editor.action.revealDefinition', 'editor.action.formatDocument'])
  })

  /*
    器は居るがエディタがまだ / もう無い（生成前・破棄後）。例外にせず、
    何も起きないだけにする ── 打鍵の側から見ると「実行できた」ことになるが、
    この隙間は本物では同じ commit の中で埋まる（MonacoEditor.tsx）。
  */
  it('エディタが無ければ安全に何もしない', () => {
    render(harness(createElement(Owner, { editor: null })))

    expect(() => registry().execute('editor.renameSymbol')).not.toThrow()
  })
})

describe('打鍵から', () => {
  it('Editor に焦点があれば、既定の5つが届く', () => {
    const editor = fakeEditor()

    render(harness(createElement(Owner, { editor: editor.target })))
    focus('monaco')

    expect(press(F12)).toBe(true)
    expect(press(SHIFT_F12)).toBe(true)
    expect(press(F2)).toBe(true)
    expect(press(SHIFT_ALT_F)).toBe(true)
    expect(press(CTRL_SPACE)).toBe(true)

    expect(editor.ran()).toEqual([
      'editor.action.revealDefinition',
      'editor.action.goToReferences',
      'editor.action.rename',
      'editor.action.formatDocument',
      'editor.action.triggerSuggest'
    ])
  })

  /*
    **Files のツリーの F2（ファイル名の変更）を奪わない**（keybindings/defaults.ts）。

    files/FileTree.tsx の `onKeyDown` は `preventDefault()` を呼ぶが
    `stopPropagation()` は呼ばないため、F2 は window まで上がってくる。
    `editorFocused` が無ければ、ツリーで F2 を押すたびにファイル名の変更と
    シンボル名の変更が同時に始まることになる。
  */
  it('Files のツリーに焦点があるときは、F2 を横取りしない', () => {
    const editor = fakeEditor()

    render(
      harness([
        createElement(Owner, { key: 'editor', editor: editor.target }),
        createElement(
          'div',
          { key: 'files', 'data-panel-body': 'files' },
          createElement('div', { id: 'tree', tabIndex: 0 })
        )
      ])
    )

    focus('tree')

    expect(press(F2)).toBe(false)
    expect(editor.ran()).toEqual([])
  })

  it('Terminal に焦点があるときは届かない', () => {
    const editor = fakeEditor()

    render(
      harness([
        createElement(Owner, { key: 'editor', editor: editor.target }),
        createElement(
          'div',
          { key: 'terminal', 'data-panel-body': 'terminal' },
          createElement('textarea', { id: 'term' })
        )
      ])
    )

    focus('term')

    expect(press(CTRL_SPACE)).toBe(false)
    expect(press(F12)).toBe(false)
    expect(editor.ran()).toEqual([])
  })

  /*
    Editor パネルの中でエディタの外（工具列のボタン）。Monaco はこの打鍵を
    受け取らないので、ここが受ける ── 実際に届く経路の1つにあたる
    （lsp/useEditorActionCommands.ts）。
  */
  it('Editor パネルの中なら、エディタの外に焦点があっても届く', () => {
    const editor = fakeEditor()

    render(harness(createElement(Owner, { editor: editor.target })))
    focus('toolbar')

    expect(press(F12)).toBe(true)
    expect(editor.ran()).toEqual(['editor.action.revealDefinition'])
  })

  it('器が居なければブラウザの既定を止めない', () => {
    render(harness(null))

    expect(press(F12)).toBe(false)
    expect(press(F2)).toBe(false)
    expect(press(SHIFT_ALT_F)).toBe(false)
    expect(press(CTRL_SPACE)).toBe(false)
  })
})

describe('server capability を尊重する', () => {
  /*
    Session 5-10 / 5-11 の判断を、command / 打鍵の経路でも保つ。

    Pyright は `documentFormattingProvider` を出さないので python には整形
    Provider を登録しておらず（lsp/formattingAvailability.ts）、`.py` の Model では
    `hasDocumentFormattingProvider` が立たない ── Monaco 側の Shift+Alt+F も
    成立しないため打鍵はここまで上がってくるが、`isSupported()` が false で
    **何も起きない。**

    **`.py` が TypeScript worker で整形されることはない** ── 落とし先を決めて
    いるのは Provider の中（monaco/lspFormatting.ts）で、この経路には
    言語で分岐する道が1つも無い。
  */
  it('Pyright が整形を出さない文書では、Shift+Alt+F で何も起きない', () => {
    const editor = fakeEditor((id) => id !== 'editor.action.formatDocument')

    render(harness(createElement(Owner, { editor: editor.target })))
    focus('monaco')

    press(SHIFT_ALT_F)

    expect(editor.ran()).toEqual([])

    // 同じ文書でも、サーバが出す機能は普通に動く（定義・参照・Rename）。
    press(F12)
    press(F2)

    expect(editor.ran()).toEqual(['editor.action.revealDefinition', 'editor.action.rename'])
  })

  /*
    `getAction()` に出る3つ（Rename / 整形 / 補完）は、ここで止まる。

    定義 / 参照は `registerAction2` の側で `getAction()` に出ないため、
    ここからは「出来ない」と分からない ── `trigger()` まで渡し、
    同じ precondition を `EditorAction2.run` が見て何もしない
    （lsp/editorActions.ts の「事前に訊けるのは半分だけ」）。
  */
  it('Provider が1つも無い文書では、事前に訊ける3つが止まる', () => {
    const editor = fakeEditor(() => false)

    render(harness(createElement(Owner, { editor: editor.target })))
    focus('monaco')

    press(F2)
    press(SHIFT_ALT_F)
    press(CTRL_SPACE)

    expect(editor.ran()).toEqual([])

    press(F12)
    press(SHIFT_F12)

    expect(editor.ran()).toEqual(['editor.action.revealDefinition', 'editor.action.goToReferences'])
  })
})
