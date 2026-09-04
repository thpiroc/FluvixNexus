import { describe, expect, it } from 'vitest'
import {
  describeEditorTabState,
  hasUnsavedChanges,
  resolveEditorTabState,
  type EditorDocumentFacts,
  type EditorTabState
} from './editorTabState'
import { createTranslator } from '../i18n/messages'

/**
 * タブの状態の導き方（Session 3-5）。
 *
 * 要は3つ。
 *   - **旗を並べず1つの状態にまとめる**（あり得ない組み合わせが表現できない）
 *   - **未保存でなければ conflict にも deleted にもしない**（失うものが無い）
 *   - 優先順位が「利用者が次に選べる手」で決まっている
 */

const facts = (overrides: Partial<EditorDocumentFacts> = {}): EditorDocumentFacts => ({
  dirty: false,
  externalChange: false,
  missing: false,
  ...overrides
})

describe('resolveEditorTabState', () => {
  it('何も無ければ clean', () => {
    expect(resolveEditorTabState(facts())).toBe('clean')
  })

  it('未保存の変更だけなら dirty', () => {
    expect(resolveEditorTabState(facts({ dirty: true }))).toBe('dirty')
  })

  it('未保存でディスク側も変わっていれば conflict', () => {
    expect(resolveEditorTabState(facts({ dirty: true, externalChange: true }))).toBe('conflict')
  })

  it('未保存でディスクから消えていれば deleted', () => {
    expect(resolveEditorTabState(facts({ dirty: true, missing: true }))).toBe('deleted')
  })

  /*
    消えていることは食い違いより強い。読み直す先も比べる相手も無いため、
    Reload / Compare / 上書き のどれも選べない。
  */
  it('消えている方が食い違いより優先される', () => {
    expect(resolveEditorTabState(facts({ dirty: true, externalChange: true, missing: true }))).toBe(
      'deleted'
    )
  })

  /*
    失うものが無いなら選択肢を出す意味が無い（未保存でなければ読み直せばよい）。
    ここが緩むと、ファイルを開いて眺めているだけで Conflict の帯が出る。
  */
  it('未保存でなければ、外部変更も削除も clean のまま', () => {
    expect(resolveEditorTabState(facts({ externalChange: true }))).toBe('clean')
    expect(resolveEditorTabState(facts({ missing: true }))).toBe('clean')
    expect(resolveEditorTabState(facts({ externalChange: true, missing: true }))).toBe('clean')
  })
})

describe('hasUnsavedChanges', () => {
  it('clean 以外はすべて「閉じると失われる」', () => {
    expect(hasUnsavedChanges('clean')).toBe(false)

    for (const state of ['dirty', 'conflict', 'deleted'] satisfies EditorTabState[]) {
      expect(hasUnsavedChanges(state)).toBe(true)
    }
  })
})

/*
  文言は辞書が正本になった（Session 4-5B）。日本語の翻訳器を渡して、
  これまでと同じ文言・同じ言い分けが保たれていることを確かめる。
*/
const t = createTranslator('ja')

describe('describeEditorTabState', () => {
  it('clean には文言が無い（印も出ない）', () => {
    expect(describeEditorTabState('clean', t)).toBeNull()
  })

  // 色だけに頼らないよう、どの状態にも読み上げられる文言を持たせる。
  it('それ以外はすべて理由を持つ', () => {
    for (const state of ['dirty', 'conflict', 'deleted'] satisfies EditorTabState[]) {
      expect(describeEditorTabState(state, t)).toBeTruthy()
    }
  })
})
