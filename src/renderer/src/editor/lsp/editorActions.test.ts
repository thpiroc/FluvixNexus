import { describe, expect, it } from 'vitest'
import { COMMAND_IDS } from '../../commands/commandIds'
import {
  EDITOR_ACTION_BY_COMMAND,
  EDITOR_ACTION_COMMAND_IDS,
  EDITOR_ACTION_SOURCE,
  runEditorActionFor,
  type EditorActionTarget
} from './editorActions'

/**
 * Command から Monaco の Action を叩く層（Session 5-12）。
 *
 * Monaco も React も要らない ── 受け取る型が構造的部分型なので、
 * **偽のエディタ1つで全部を試せる**（editorActions.ts の冒頭）。
 */

interface FakeEditor extends EditorActionTarget {
  readonly focused: () => number
  readonly triggered: () => readonly { readonly source: unknown; readonly id: string }[]
}

function fakeEditor(options: {
  /**
   * その id が `getAction()` に出るか。
   *
   * 既定は「出る」。**`registerAction2` の側（定義 / 参照）は出ない**ので、
   * その状況は `known: () => false` で作る（editorActions.ts の冒頭）。
   */
  readonly known?: (id: string) => boolean
  /** `isSupported()` の答え。既定は true。 */
  readonly supported?: (id: string) => boolean
}): FakeEditor {
  let focusCount = 0
  const triggered: { source: unknown; id: string }[] = []

  return {
    focus: () => {
      focusCount += 1
    },
    getAction: (id) => {
      if (options.known !== undefined && !options.known(id)) {
        return null
      }

      return { isSupported: () => options.supported?.(id) ?? true }
    },
    trigger: (source, handlerId) => {
      triggered.push({ source, id: handlerId })
    },
    focused: () => focusCount,
    triggered: () => triggered
  }
}

describe('EDITOR_ACTION_BY_COMMAND', () => {
  it('6つの操作を持つ（Completion / Hover / Definition / References / Formatting / Rename）', () => {
    expect(EDITOR_ACTION_COMMAND_IDS).toEqual([
      'editor.goToDefinition',
      'editor.findReferences',
      'editor.renameSymbol',
      'editor.formatDocument',
      'editor.triggerSuggest',
      'editor.showHover'
    ])
  })

  it('繋いである command はすべて既知の command（表に載っている）', () => {
    for (const commandId of EDITOR_ACTION_COMMAND_IDS) {
      expect(COMMAND_IDS as readonly string[], commandId).toContain(commandId)
    }
  })

  it('Monaco の Action の id を指している', () => {
    expect(EDITOR_ACTION_BY_COMMAND).toEqual({
      'editor.goToDefinition': 'editor.action.revealDefinition',
      'editor.findReferences': 'editor.action.goToReferences',
      'editor.renameSymbol': 'editor.action.rename',
      'editor.formatDocument': 'editor.action.formatDocument',
      'editor.triggerSuggest': 'editor.action.triggerSuggest',
      'editor.showHover': 'editor.action.showHover'
    })
  })

  it('同じ Action を2つの command が指していない', () => {
    const actions = Object.values(EDITOR_ACTION_BY_COMMAND)

    expect(new Set(actions).size).toBe(actions.length)
  })

  /*
    Diagnostics と Document Sync は常時動くもので、「実行する」形を持たない
    （commands/commandIds.ts）。うっかり繋がないことを実数で押さえておく。
  */
  it('Diagnostics / Document Sync を繋いでいない', () => {
    const actions = Object.values(EDITOR_ACTION_BY_COMMAND).join(' ')

    expect(actions).not.toContain('marker')
    expect(actions).not.toContain('diagnostic')
  })

  /* `'keyboard'` は Monaco が入力として扱う予約された名前（editorActions.ts）。 */
  it('呼び出し元の名前が `keyboard` ではない', () => {
    expect(EDITOR_ACTION_SOURCE).not.toBe('keyboard')
    expect(EDITOR_ACTION_SOURCE.length).toBeGreaterThan(0)
  })
})

describe('runEditorActionFor', () => {
  it('Action を叩き、先に focus を戻す', () => {
    const editor = fakeEditor({})

    expect(runEditorActionFor(editor, 'editor.goToDefinition')).toBe(true)
    expect(editor.triggered()).toEqual([
      { source: EDITOR_ACTION_SOURCE, id: 'editor.action.revealDefinition' }
    ])
    expect(editor.focused()).toBe(1)
  })

  it('6つとも、それぞれの Action へ届く', () => {
    const editor = fakeEditor({})

    for (const commandId of EDITOR_ACTION_COMMAND_IDS) {
      expect(runEditorActionFor(editor, commandId), commandId).toBe(true)
    }

    expect(editor.triggered().map((entry) => entry.id)).toEqual(
      Object.values(EDITOR_ACTION_BY_COMMAND)
    )
  })

  /* エディタが無いのは失敗ではない（Editor パネルを閉じている・バイナリを見ている）。 */
  it('エディタが無ければ何もしない', () => {
    expect(runEditorActionFor(null, 'editor.formatDocument')).toBe(false)
  })

  /*
    **ここが Session 5-12 の production 確認で見つかった落とし穴にあたる。**

    定義 / 参照は `registerAction2` で登録されているため `getAction()` に出ない
    （editorActions.ts の冒頭）。`getAction()` が null を返したら「出来ない」ではなく
    「分からない」として扱い、`trigger()` へ渡す ── 渡さないと、F12 と Shift+F12
    だけが黙って何もしないことになる。
  */
  it('getAction に出ない Action（registerAction2 の側）も trigger で叩く', () => {
    const editor = fakeEditor({ known: () => false })

    expect(runEditorActionFor(editor, 'editor.goToDefinition')).toBe(true)
    expect(runEditorActionFor(editor, 'editor.findReferences')).toBe(true)

    expect(editor.triggered().map((entry) => entry.id)).toEqual([
      'editor.action.revealDefinition',
      'editor.action.goToReferences'
    ])
    // 焦点も戻す ── `EditorAction2.run` は焦点のあるエディタを自分で探す。
    expect(editor.focused()).toBe(2)
  })

  /*
    ここが capability の反映そのものにあたる（Session 5-10 / 5-11）。

    Pyright は整形を出さないので python には整形 Provider を登録しておらず
    （lsp/formattingAvailability.ts）、`.py` の Model では
    `hasDocumentFormattingProvider` が立たない ── `isSupported()` が false になり、
    **何も起きない。** 内蔵の TypeScript 整形へ落ちる道はこの関数に無い。
  */
  it('その文書で使えない Action（isSupported が false）は叩かず、焦点も動かさない', () => {
    const editor = fakeEditor({
      supported: (id) => id !== 'editor.action.formatDocument'
    })

    expect(runEditorActionFor(editor, 'editor.formatDocument')).toBe(false)
    expect(editor.triggered()).toEqual([])
    expect(editor.focused()).toBe(0)

    // 使える Action は同じエディタで普通に走る。
    expect(runEditorActionFor(editor, 'editor.renameSymbol')).toBe(true)
    expect(editor.triggered().map((entry) => entry.id)).toEqual(['editor.action.rename'])
  })
})
