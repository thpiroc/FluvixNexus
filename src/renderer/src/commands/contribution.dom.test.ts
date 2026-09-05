/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorContext } from '../editor/context'
import type { EditorController } from '../editor/useEditorSession'
import { FilesView } from '../files/FilesView'
import type { FilesLayoutController } from '../files/useFilesLayout'
import { GitCommands } from '../git/GitCommands'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { CommandProvider } from './CommandProvider'
import { useCommands, type CommandRegistryController } from './context'
import { useCommand } from './useCommand'

/**
 * パネルが名乗る command（Session 4-7B の contribution）。
 *
 * 純粋層（registry / commandIds）は素のテストで見てあるので、ここで見るのは
 * **所有者が居ることでしか決まらないもの**にする。
 *
 *   - 押せないときは登録されない（`enabled`）
 *   - 所有者が消えれば実行できなくなる
 *   - handler が描画のたびに作り直されても、登録し直さない
 *   - Files の検索が、2段の state をまたいで正しい面を開く
 *
 * Git 側は `GitCommands` を**単体で** mount する。GitView ごと立てると
 * `fluvix.git` の全面を mock することになり、テストが実装の写しになる ──
 * あちらから渡ってくるのは props だけなので、props を渡せば同じものが試せる。
 */

const filesApi = vi.hoisted(() => ({
  readDirectory: vi.fn(),
  onChanged: vi.fn(),
  search: vi.fn(),
  searchContent: vi.fn(),
  cancelSearch: vi.fn()
}))

vi.mock('../api/fluvix', () => ({ fluvix: { files: filesApi } }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  // settings/SettingsOverlay.dom.test.ts と同じ（act の外の更新を警告させる）。
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  filesApi.readDirectory.mockResolvedValue({
    ok: true,
    data: { workspaceId: 'w1', entries: [], truncated: false }
  })
  filesApi.onChanged.mockReturnValue(() => {})
  filesApi.search.mockResolvedValue({ ok: true, data: {} })
  filesApi.searchContent.mockResolvedValue({ ok: true, data: {} })
  filesApi.cancelSearch.mockResolvedValue({ ok: true, data: {} })
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

/** 実行時の表を読むための覗き口（画面には何も出さない）。 */
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

/** CommandProvider ＋ 覗き口を積んだ器。 */
function harness(children: ReactNode): ReactElement {
  return createElement(CommandProvider, null, createElement(Probe, null), children)
}

// ---------------------------------------------------------------- enabled

describe('useCommand の enabled（Session 4-7B）', () => {
  function Owner({ enabled, run }: { enabled: boolean; run: () => void }): null {
    useCommand('git.push', run, enabled)
    return null
  }

  it('enabled が false の間は登録されない', () => {
    const run = vi.fn()

    render(harness(createElement(Owner, { enabled: false, run })))

    expect(registry().isRegistered('git.push')).toBe(false)
    // 実行もできない。**失敗ではなく「今はできない」**（commands/context.ts）。
    expect(registry().execute('git.push')).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('enabled が true なら登録され、実行できる', () => {
    const run = vi.fn()

    render(harness(createElement(Owner, { enabled: true, run })))

    expect(registry().isRegistered('git.push')).toBe(true)
    expect(registry().execute('git.push')).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('enabled が変わると、登録と解除が追いかける', () => {
    const run = vi.fn()

    render(harness(createElement(Owner, { enabled: false, run })))
    expect(registry().isRegistered('git.push')).toBe(false)

    // 押せるようになった（Commit が済んで、送るものができた等）。
    render(harness(createElement(Owner, { enabled: true, run })))
    expect(registry().isRegistered('git.push')).toBe(true)

    // また押せなくなった（別の Git 操作が走り始めた等）。
    render(harness(createElement(Owner, { enabled: false, run })))
    expect(registry().isRegistered('git.push')).toBe(false)
    expect(registry().execute('git.push')).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('所有者が消えると解除される', () => {
    render(harness(createElement(Owner, { enabled: true, run: () => {} })))
    expect(registry().isRegistered('git.push')).toBe(true)

    // Git パネルを背面へ回した／リポジトリが使えなくなった、に当たる。
    render(harness(null))
    expect(registry().isRegistered('git.push')).toBe(false)
  })

  it('描画のたびに作り直される handler でも、実行されるのは最新のもの', () => {
    /*
      呼ぶ側は `useCallback` を通していないことが多い（GitView から渡る
      `runCommit` は `message` を閉じ込めており、1文字打つたびに別の関数になる）。
      `useCommand` は ref に最新を置くので、登録は mount の1回のまま
      **中身だけが差し替わる**（commands/useCommand.ts）。

      ここで見るのは、その結果として起きること ── **古い closure が
      実行されない**こと。これが崩れると、Commit が「1つ前の文章」で走る。
    */
    const seen: string[] = []

    function Owner({ message }: { message: string }): null {
      // 毎回の描画で別の関数になる（意図的に useCallback を使わない）。
      useCommand('git.commit', () => seen.push(message))
      return null
    }

    render(harness(createElement(Owner, { message: 'first' })))
    render(harness(createElement(Owner, { message: 'second' })))

    expect(registry().execute('git.commit')).toBe(true)
    expect(seen).toEqual(['second'])
  })

  it('描き直しの間、登録が途切れない', () => {
    // 上と同じ形。解除と再登録が挟まっていれば、その隙に実行できない瞬間ができる。
    function Owner({ message }: { message: string }): null {
      useCommand('git.commit', () => void message)
      return null
    }

    render(harness(createElement(Owner, { message: 'first' })))
    expect(registry().isRegistered('git.commit')).toBe(true)

    render(harness(createElement(Owner, { message: 'second' })))
    expect(registry().isRegistered('git.commit')).toBe(true)
  })

  it('同じ command を2つの所有者が名乗ると例外になる', () => {
    // 「所有者はちょうど1つ」（commands/context.ts）。
    expect(() =>
      render(
        harness([
          createElement(Owner, { key: 'a', enabled: true, run: () => {} }),
          createElement(Owner, { key: 'b', enabled: true, run: () => {} })
        ])
      )
    ).toThrow(/already registered/)
  })
})

// ---------------------------------------------------------------- Git

describe('GitCommands（Session 4-7B）', () => {
  const handlers = {
    onRefresh: vi.fn(),
    onCommit: vi.fn(),
    onPush: vi.fn(),
    onPull: vi.fn(),
    onFetch: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenStash: vi.fn()
  }

  function gitCommands(
    enabled: Partial<{
      refreshEnabled: boolean
      commitEnabled: boolean
      pushEnabled: boolean
      pullEnabled: boolean
      fetchEnabled: boolean
    }> = {}
  ): ReactElement {
    return createElement(GitCommands, {
      ...handlers,
      refreshEnabled: true,
      commitEnabled: true,
      pushEnabled: true,
      pullEnabled: true,
      fetchEnabled: true,
      ...enabled
    })
  }

  it('readiness が出そろっていれば7件とも登録される', () => {
    render(harness(gitCommands()))

    for (const id of [
      'git.refresh',
      'git.commit',
      'git.push',
      'git.pull',
      'git.fetch',
      'git.openHistory',
      'git.stashPush'
    ] as const) {
      expect(registry().isRegistered(id), id).toBe(true)
    }
  })

  it('押せない操作は登録されない（画面のボタンと同じ判断）', () => {
    /*
      渡ってくるのは GitView がボタンの活性に使っているのと同じ値で、
      その正本は gitChanges.ts と gitInProgress.ts になる ──
      **ここでは条件を組み立て直していない**（git/GitCommands.tsx）。
      ステージ済みが無い・rebase の途中、はどちらもこの形で届く。
    */
    render(harness(gitCommands({ commitEnabled: false, pushEnabled: false, pullEnabled: false })))

    expect(registry().isRegistered('git.commit')).toBe(false)
    expect(registry().isRegistered('git.push')).toBe(false)
    expect(registry().isRegistered('git.pull')).toBe(false)

    // 読み取りと Fetch は条件を持たないので残る。
    expect(registry().isRegistered('git.fetch')).toBe(true)
    expect(registry().isRegistered('git.openHistory')).toBe(true)
  })

  it('調べ直しは busy の間だけ落ちる', () => {
    render(harness(gitCommands({ refreshEnabled: false })))
    expect(registry().isRegistered('git.refresh')).toBe(false)

    render(harness(gitCommands({ refreshEnabled: true })))
    expect(registry().isRegistered('git.refresh')).toBe(true)
    expect(registry().execute('git.refresh')).toBe(true)
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('git.stashPush は退避を実行せず、面を開く', () => {
    /*
      名前と挙動がずれているのは意図で、理由は commands/registry.ts にある
      （確認を1つも挟まずに作業ツリー全体を退避しないため）。
      **ここが、その意図を実数で押さえる唯一の場所**になる。
    */
    render(harness(gitCommands()))

    expect(registry().execute('git.stashPush')).toBe(true)
    expect(handlers.onOpenStash).toHaveBeenCalledTimes(1)
  })

  it('パネルが消えれば Git の command は1つも残らない', () => {
    render(harness(gitCommands()))
    render(harness(null))

    for (const id of ['git.refresh', 'git.commit', 'git.openHistory', 'git.stashPush'] as const) {
      expect(registry().isRegistered(id), id).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- Files

describe('Files の検索 command（Session 4-7B）', () => {
  function mockLayout(): FilesLayoutController {
    return {
      mode: 'tree',
      suggestion: 'tree',
      preference: { kind: 'auto' },
      registerContainer: () => {},
      chooseMode: () => {},
      followPanelShape: () => {},
      columnWidth: 240,
      setColumnWidth: () => {}
    } as unknown as FilesLayoutController
  }

  function mockEditor(): EditorController {
    return {
      openFile: () => {},
      openFileAt: () => {},
      unsavedTabs: []
    } as unknown as EditorController
  }

  const workspace = {
    id: 'w1',
    rootPath: 'D:\\project',
    displayName: 'project',
    exists: true,
    openedAt: 0
  }

  function mockWorkspaceFolder(): WorkspaceFolderController {
    return {
      status: 'ready',
      workspace,
      unavailableRootPath: null,
      error: null,
      busy: false,
      openFolder: () => {},
      closeWorkspace: () => {}
    }
  }

  function filesView(): ReactElement {
    return createElement(
      I18nContext.Provider,
      { value: { language: 'ja', setLanguage: () => {}, t: createTranslator('ja') } },
      createElement(
        WorkspaceFolderContext.Provider,
        { value: mockWorkspaceFolder() },
        createElement(
          EditorContext.Provider,
          { value: mockEditor() },
          createElement(FilesView, { workspace, layout: mockLayout() })
        )
      )
    )
  }

  /** 名前 / 全文の面。並びは FileSearch.tsx の `MODES` と同じ（name → content）。 */
  function panes(): readonly HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('.fx-search__pane')]
  }

  /** ツリーと検索の切り替えの側（FilesView.tsx）。 */
  function views(): readonly HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('.fx-files-view__pane')]
  }

  it('3件とも登録される', () => {
    render(harness(filesView()))

    expect(registry().isRegistered('files.refresh')).toBe(true)
    expect(registry().isRegistered('files.search.byName')).toBe(true)
    expect(registry().isRegistered('files.search.byContent')).toBe(true)
  })

  it('最初はツリーを見ている', () => {
    render(harness(filesView()))

    const [tree, search] = views()
    expect(tree.hidden).toBe(false)
    expect(search.hidden).toBe(true)
  })

  it('files.search.byContent で全文検索の面が開き、入力欄へ焦点が移る', () => {
    render(harness(filesView()))

    act(() => {
      expect(registry().execute('files.search.byContent')).toBe(true)
    })

    const [tree, search] = views()
    expect(tree.hidden).toBe(true)
    expect(search.hidden).toBe(false)

    const [namePane, contentPane] = panes()
    expect(namePane.hidden).toBe(true)
    expect(contentPane.hidden).toBe(false)

    // 焦点を移すのは面の側（`active` を見る既存の effect）。command は触らない。
    expect(contentPane.contains(document.activeElement)).toBe(true)
    expect((document.activeElement as HTMLElement).className).toContain('fx-search__input')
  })

  it('files.search.byName で名前検索の面が開き、入力欄へ焦点が移る', () => {
    render(harness(filesView()))

    // 全文 → 名前 と渡り歩いても、その都度その面の入力欄へ移る。
    act(() => {
      registry().execute('files.search.byContent')
    })
    act(() => {
      expect(registry().execute('files.search.byName')).toBe(true)
    })

    const [namePane, contentPane] = panes()
    expect(namePane.hidden).toBe(false)
    expect(contentPane.hidden).toBe(true)
    expect(namePane.contains(document.activeElement)).toBe(true)
  })

  /** 画面上のボタンを名前で押す（並び順に依存しない）。 */
  function click(label: string): void {
    const t = createTranslator('ja')
    const selector = `button[aria-label="${t(label as Parameters<typeof t>[0])}"]`
    const button = container.querySelector<HTMLButtonElement>(selector)

    if (button === null) {
      throw new Error(`ボタンが見つからない: ${selector}`)
    }

    act(() => button.click())
  }

  it('ツリーへ戻っても、選んでいた探し方は残る', () => {
    /*
      持ち上げる前（FileSearch の useState）は隠れるだけで作り直されなかったので、
      戻って開き直すと前の探し方のままだった。持ち主が変わっても、そこは同じ
      （files/FilesView.tsx の `searchMode`）。
    */
    render(harness(filesView()))

    act(() => {
      registry().execute('files.search.byContent')
    })

    click('files.search.backLabel')
    expect(views()[0].hidden).toBe(false)
    expect(views()[1].hidden).toBe(true)

    // 既存の入口（ツールバーの虫めがね）から開き直しても、全文のまま。
    click('files.toolbar.searchLabel')
    expect(views()[1].hidden).toBe(false)
    expect(panes()[0].hidden).toBe(true)
    expect(panes()[1].hidden).toBe(false)
  })

  it('既存のツールバーの入口は、これまでどおり名前検索から始まる', () => {
    // 4-7B で変えたのは持ち主だけで、初期値は `'name'` のまま（FileSearch.tsx）。
    render(harness(filesView()))

    click('files.toolbar.searchLabel')

    expect(views()[1].hidden).toBe(false)
    expect(panes()[0].hidden).toBe(false)
    expect(panes()[1].hidden).toBe(true)
  })

  it('files.refresh はツリーの読み直しを呼ぶ（既存の ⟳ と同じ経路）', () => {
    render(harness(filesView()))

    // mount のときの読み込みぶんを数え終えてから。
    const before = filesApi.readDirectory.mock.calls.length

    act(() => {
      expect(registry().execute('files.refresh')).toBe(true)
    })

    // `reloadAll` は読み込み済みを忘れ、展開されている位置を読み直させる。
    expect(filesApi.readDirectory.mock.calls.length).toBeGreaterThan(before)
  })

  it('パネルが消えれば Files の command も残らない', () => {
    render(harness(filesView()))
    render(harness(null))

    for (const id of ['files.refresh', 'files.search.byName', 'files.search.byContent'] as const) {
      expect(registry().isRegistered(id), id).toBe(false)
    }
  })
})
