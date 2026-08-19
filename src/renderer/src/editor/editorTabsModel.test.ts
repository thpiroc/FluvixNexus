import { describe, expect, it } from 'vitest'
import type { WorkspaceFileChange } from '@shared/files'
import {
  activateTab,
  applyFileChanges,
  closeTab,
  EMPTY_EDITOR_TABS,
  findActiveTab,
  findTabByPath,
  isTabActive,
  listUnsavedTabs,
  openTab,
  setTabDocument,
  setTabStateByPath,
  type EditorTabsState
} from './editorTabsModel'

/**
 * Editor のタブの操作。
 *
 * 要は3つ。
 *   - **同じファイルを2枚開かない**（Session 3-3 の要件そのもの）
 *   - **active はタブごとの状態ではなく導出**（2枚 active / 0枚 active が作れない）
 *   - **ディスク側の変化にタブが追従する**（改名で位置が変わる・削除で閉じる）
 */

/** テストの読みやすさのため、タブを `名前<状態>` の並びで表す（* が手前のタブ）。 */
function describeTabs(state: EditorTabsState): string[] {
  return state.tabs.map(
    (tab) => `${isTabActive(state, tab.id) ? '*' : ''}${tab.relativePath}<${tab.document.status}>`
  )
}

function open(state: EditorTabsState, relativePath: string): EditorTabsState {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return openTab(state, { relativePath, name })
}

function idOf(state: EditorTabsState, relativePath: string): string {
  const tab = findTabByPath(state, relativePath)

  if (tab === null) {
    throw new Error(`no tab for ${relativePath}`)
  }

  return tab.id
}

describe('openTab', () => {
  // 新しいタブは中身が 'loading' で始まる（＝読み込みが要ることが状態から分かる）。
  it('開いたタブが手前に出て、中身は読み込み中から始まる', () => {
    expect(describeTabs(open(EMPTY_EDITOR_TABS, 'src/a.ts'))).toEqual(['*src/a.ts<loading>'])
  })

  it('複数のファイルはそれぞれ別のタブになる', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'src/a.ts'), 'src/b.ts')

    expect(describeTabs(state)).toEqual(['src/a.ts<loading>', '*src/b.ts<loading>'])
  })

  /*
    ここが Session 3-3 の要件（同じファイルを再度開いてもタブが重複しない）。
    中身を読み直さないのも含めて確かめる ── 読み直すと、開いていたファイルを
    もう一度選んだだけで表示中の内容が置き換わる。
  */
  it('同じ位置のファイルは2枚目を作らず、既存のタブを手前に出す', () => {
    const first = open(EMPTY_EDITOR_TABS, 'src/a.ts')
    const firstId = idOf(first, 'src/a.ts')
    const withContent = setTabDocument(first, firstId, {
      status: 'ready',
      content: 'export const a = 1',
      byteLength: 18,
      lineEnding: 'lf',
      encoding: 'utf8',
      revision: { mtimeMs: 1, size: 18 }
    })
    const withOther = open(withContent, 'src/b.ts')

    const again = open(withOther, 'src/a.ts')

    // 'ready' のままであることが「読み直していない」の証拠
    // （読み直していれば 'loading' に戻る）。
    expect(describeTabs(again)).toEqual(['*src/a.ts<ready>', 'src/b.ts<loading>'])
    expect(idOf(again, 'src/a.ts')).toBe(firstId)
  })

  it('同じ名前でもフォルダが違えば別のタブ', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'src/index.ts'), 'docs/index.ts')

    expect(state.tabs).toHaveLength(2)
  })

  it('id は relativePath ではない（リネームでタブの同一性が失われないため）', () => {
    expect(idOf(open(EMPTY_EDITOR_TABS, 'src/a.ts'), 'src/a.ts')).not.toContain('src/a.ts')
  })
})

describe('activateTab', () => {
  it('手前のタブを切り替える', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'a.ts'), 'b.ts')
    const first = state.tabs[0]!

    expect(describeTabs(activateTab(state, first.id))).toEqual(['*a.ts<loading>', 'b.ts<loading>'])
  })

  it('知らない id では何も変えない（元のオブジェクトをそのまま返す）', () => {
    const state = open(EMPTY_EDITOR_TABS, 'a.ts')

    expect(activateTab(state, 'tab-999')).toBe(state)
  })
})

describe('closeTab', () => {
  it('閉じたタブが消える', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'a.ts'), 'b.ts')

    expect(describeTabs(closeTab(state, state.tabs[0]!.id))).toEqual(['*b.ts<loading>'])
  })

  // 先頭に戻す形にすると、続けて閉じるたびに見ている場所が飛ぶ。
  it('手前のタブを閉じたら右隣が手前に出る', () => {
    const state = open(open(open(EMPTY_EDITOR_TABS, 'a.ts'), 'b.ts'), 'c.ts')
    const middle = activateTab(state, state.tabs[1]!.id)

    expect(describeTabs(closeTab(middle, state.tabs[1]!.id))).toEqual([
      'a.ts<loading>',
      '*c.ts<loading>'
    ])
  })

  it('末尾を閉じたら左隣が手前に出る', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'a.ts'), 'b.ts')

    expect(describeTabs(closeTab(state, state.tabs[1]!.id))).toEqual(['*a.ts<loading>'])
  })

  it('手前でないタブを閉じても手前は変わらない', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'a.ts'), 'b.ts')

    expect(describeTabs(closeTab(state, state.tabs[0]!.id))).toEqual(['*b.ts<loading>'])
  })

  it('最後の1枚を閉じると手前のタブが無くなる', () => {
    const state = open(EMPTY_EDITOR_TABS, 'a.ts')
    const closed = closeTab(state, state.tabs[0]!.id)

    expect(closed.tabs).toEqual([])
    expect(closed.activeTabId).toBeNull()
    expect(findActiveTab(closed)).toBeNull()
  })
})

describe('setTabDocument', () => {
  it('届いた中身がそのタブに入る', () => {
    const opened = open(EMPTY_EDITOR_TABS, 'a.ts')
    const ready = setTabDocument(opened, idOf(opened, 'a.ts'), {
      status: 'ready',
      content: 'x',
      byteLength: 1,
      lineEnding: 'crlf',
      encoding: 'utf8-bom',
      revision: { mtimeMs: 100, size: 1 }
    })

    expect(findTabByPath(ready, 'a.ts')?.document).toEqual({
      status: 'ready',
      content: 'x',
      byteLength: 1,
      lineEnding: 'crlf',
      encoding: 'utf8-bom',
      revision: { mtimeMs: 100, size: 1 }
    })
  })

  // 読み込み中に閉じられたタブへ、後から届いた中身が復活しないこと。
  it('もう無いタブへの反映は捨てる', () => {
    const opened = open(EMPTY_EDITOR_TABS, 'a.ts')
    const tabId = idOf(opened, 'a.ts')
    const closed = closeTab(opened, tabId)

    expect(setTabDocument(closed, tabId, { status: 'binary', byteLength: 4 })).toBe(closed)
  })
})

describe('applyFileChanges', () => {
  const renamed = (
    from: string,
    to: string,
    entryType: 'file' | 'directory'
  ): WorkspaceFileChange => ({
    kind: 'renamed',
    fromRelativePath: from,
    toRelativePath: to,
    entryType
  })

  const deleted = (relativePath: string, entryType: 'file' | 'directory'): WorkspaceFileChange => ({
    kind: 'deleted',
    relativePath,
    entryType
  })

  it('開いているファイルの改名に追従する（開き直しにしない）', () => {
    const opened = open(EMPTY_EDITOR_TABS, 'src/a.ts')
    const next = applyFileChanges(opened, [renamed('src/a.ts', 'src/b.ts', 'file')])

    expect(describeTabs(next)).toEqual(['*src/b.ts<loading>'])
    // タブの同一性は保つ（id が変わると React から見て別のタブになる）。
    expect(next.tabs[0]!.id).toBe(idOf(opened, 'src/a.ts'))
    expect(next.tabs[0]!.name).toBe('b.ts')
  })

  it('フォルダの改名では配下のタブの位置だけが動く', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'src/a.ts'), 'docs/b.md')
    const next = applyFileChanges(state, [renamed('src', 'source', 'directory')])

    expect(describeTabs(next)).toEqual(['source/a.ts<loading>', '*docs/b.md<loading>'])
    // 名前（タブに出る文字）は動かない。
    expect(next.tabs[0]!.name).toBe('a.ts')
  })

  it('開いているファイルが削除されたら閉じる（未保存でなければ）', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'a.ts'), 'b.ts')
    const next = applyFileChanges(state, [deleted('a.ts', 'file')])

    expect(describeTabs(next)).toEqual(['*b.ts<loading>'])
  })

  it('フォルダが削除されたら配下のタブをすべて閉じる', () => {
    const state = open(open(open(EMPTY_EDITOR_TABS, 'src/a.ts'), 'src/deep/b.ts'), 'docs/c.md')
    const next = applyFileChanges(state, [deleted('src', 'directory')])

    expect(describeTabs(next)).toEqual(['*docs/c.md<loading>'])
  })

  /*
    Session 3-5 の要件。未保存の内容は**このタブの中にしか無い**ので、
    ファイルが消えたからといって閉じると、利用者が一度も選んでいないのに失われる。
  */
  it('未保存のタブは削除されても閉じず、削除済みとして残る', () => {
    const state = setTabStateByPath(open(open(EMPTY_EDITOR_TABS, 'a.ts'), 'b.ts'), 'a.ts', 'dirty')
    const next = applyFileChanges(state, [deleted('a.ts', 'file')])

    expect(describeTabs(next)).toEqual(['a.ts<loading>', '*b.ts<loading>'])
    expect(findTabByPath(next, 'a.ts')?.state).toBe('deleted')
  })

  it('フォルダが消えても、配下の未保存のタブは残る', () => {
    const state = setTabStateByPath(
      open(open(EMPTY_EDITOR_TABS, 'src/a.ts'), 'src/b.ts'),
      'src/a.ts',
      'conflict'
    )
    const next = applyFileChanges(state, [deleted('src', 'directory')])

    expect(describeTabs(next)).toEqual(['*src/a.ts<loading>'])
    expect(findTabByPath(next, 'src/a.ts')?.state).toBe('deleted')
  })

  /*
    ツリーの形が変わらない変化。中身を持っているのは Model 側なので、
    タブは何もしない（同じ判断が2箇所に分かれないようにするため）。
  */
  it('中身の変更（modified）ではタブは変わらない', () => {
    const state = open(EMPTY_EDITOR_TABS, 'a.ts')

    expect(
      applyFileChanges(state, [
        {
          kind: 'modified',
          relativePath: 'a.ts',
          entryType: 'file',
          revision: { mtimeMs: 5, size: 3 }
        }
      ])
    ).toBe(state)
  })

  it('名前の前方一致だけのフォルダは巻き込まない', () => {
    const state = open(EMPTY_EDITOR_TABS, 'src2/a.ts')

    expect(applyFileChanges(state, [deleted('src', 'directory')]).tabs).toHaveLength(1)
  })

  it('作成では何も変わらない', () => {
    const state = open(EMPTY_EDITOR_TABS, 'a.ts')

    expect(
      applyFileChanges(state, [{ kind: 'created', relativePath: 'b.ts', entryType: 'file' }])
    ).toBe(state)
  })

  it('関係の無い変化では元のオブジェクトをそのまま返す', () => {
    const state = open(EMPTY_EDITOR_TABS, 'a.ts')

    expect(applyFileChanges(state, [renamed('docs', 'guide', 'directory')])).toBe(state)
  })

  it('まとめて届いた変化を順に適用する（将来のファイル監視の形）', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'src/a.ts'), 'src/b.ts')
    const next = applyFileChanges(state, [
      renamed('src/a.ts', 'src/renamed.ts', 'file'),
      deleted('src/b.ts', 'file')
    ])

    expect(describeTabs(next)).toEqual(['*src/renamed.ts<loading>'])
  })
})

/*
  タブの状態（Session 3-4 の未保存の印を、Session 3-5 で Conflict / 削除済みまで拡げたもの）。

  ここが受け取るのは Monaco の Model を持つ層（monaco/documentStore.ts）が出した結果で、
  「ディスクと食い違っているか」自体はここでは決めない（導き方は editorTabState.ts）。
  確かめるのは、**位置からタブへの変換**と、**変化が無いときに再描画を誘わないこと**の2つ。
*/
describe('setTabStateByPath', () => {
  it('開いた直後のタブは clean', () => {
    const state = open(EMPTY_EDITOR_TABS, 'a.ts')

    expect(findTabByPath(state, 'a.ts')?.state).toBe('clean')
  })

  it('位置で指したタブにだけ印が付く', () => {
    const state = open(open(EMPTY_EDITOR_TABS, 'src/a.ts'), 'src/b.ts')
    const next = setTabStateByPath(state, 'src/a.ts', 'dirty')

    expect(findTabByPath(next, 'src/a.ts')?.state).toBe('dirty')
    expect(findTabByPath(next, 'src/b.ts')?.state).toBe('clean')
  })

  it('保存できたら印が消える', () => {
    const dirty = setTabStateByPath(open(EMPTY_EDITOR_TABS, 'a.ts'), 'a.ts', 'dirty')

    expect(findTabByPath(setTabStateByPath(dirty, 'a.ts', 'clean'), 'a.ts')?.state).toBe('clean')
  })

  it('Conflict も同じ1つの欄で表す（旗を並べない）', () => {
    const dirty = setTabStateByPath(open(EMPTY_EDITOR_TABS, 'a.ts'), 'a.ts', 'dirty')

    expect(findTabByPath(setTabStateByPath(dirty, 'a.ts', 'conflict'), 'a.ts')?.state).toBe(
      'conflict'
    )
  })

  it('同じ値なら元のオブジェクトをそのまま返す（打鍵ごとの再描画を作らない）', () => {
    const state = open(EMPTY_EDITOR_TABS, 'a.ts')

    expect(setTabStateByPath(state, 'a.ts', 'clean')).toBe(state)

    const dirty = setTabStateByPath(state, 'a.ts', 'dirty')

    expect(setTabStateByPath(dirty, 'a.ts', 'dirty')).toBe(dirty)
  })

  it('開いていない位置は無視する', () => {
    const state = open(EMPTY_EDITOR_TABS, 'a.ts')

    // タブを閉じた直後に Model の破棄が通知される経路。
    expect(setTabStateByPath(state, 'b.ts', 'dirty')).toBe(state)
  })

  it('改名でタブが移った後は、新しい位置で印が付く', () => {
    const opened = setTabStateByPath(open(EMPTY_EDITOR_TABS, 'src/a.ts'), 'src/a.ts', 'dirty')
    const change: WorkspaceFileChange = {
      kind: 'renamed',
      fromRelativePath: 'src/a.ts',
      toRelativePath: 'src/b.ts',
      entryType: 'file'
    }
    const moved = applyFileChanges(opened, [change])

    // 改名は開き直しではないので、印は付いたまま移る。
    expect(findTabByPath(moved, 'src/b.ts')?.state).toBe('dirty')
    expect(setTabStateByPath(moved, 'src/a.ts', 'clean')).toBe(moved)
  })
})

/*
  Workspace / アプリを閉じる前の確認に出す一覧（unsaved/）。
  別の印を持たず、状態から導くだけであることを確かめる。
*/
describe('listUnsavedTabs', () => {
  it('clean のタブは並ばない', () => {
    expect(listUnsavedTabs(open(EMPTY_EDITOR_TABS, 'a.ts'))).toEqual([])
  })

  it('dirty / conflict / deleted はすべて並ぶ', () => {
    let state = open(open(open(open(EMPTY_EDITOR_TABS, 'a.ts'), 'b.ts'), 'c.ts'), 'd.ts')
    state = setTabStateByPath(state, 'a.ts', 'dirty')
    state = setTabStateByPath(state, 'b.ts', 'conflict')
    state = setTabStateByPath(state, 'c.ts', 'deleted')

    expect(listUnsavedTabs(state).map((tab) => tab.relativePath)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })
})
