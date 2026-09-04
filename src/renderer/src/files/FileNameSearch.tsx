import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { findFileNameMatch, parentRelativePath, type FileEntry } from '@shared/files'
import type { WorkspaceFolder } from '@shared/workspace'
import { resolveEntryIconId } from './fileIcon'
import { CloseIcon, FileTypeIcon, SearchIcon } from './FileTreeIcons'
import { searchMatchesOf, summarizeFileSearch, type FileSearchState } from './fileSearchModel'
import { useFileSearch } from './useFileSearch'
import { useI18n } from '../i18n/context'

/**
 * 名前で探す（Session 3-6-4）。
 *
 * Session 3-6-5 で、検索モードが**ファイル名 / 全文**の2つになった
 * （FileSearch.tsx）。それに合わせて、もとの FileSearch.tsx の中身のうち
 * 「名前で探す側」をこのファイルへ移している ── 中身は変えていない
 * （枠と戻る手段だけが、2つのモードで共有する側へ移った）。
 *
 * 状態は useFileSearch.ts が持ち、状態の意味づけは fileSearchModel.ts が持つ。
 * ここにあるのは描くことと、操作を受け取ることだけ（FileTree.tsx と同じ分担）。
 *
 * ## 開くのはツリーと同じ経路
 *
 * 結果を押したときに呼ぶのは、親から渡された `onOpen` 1つだけ。その先は
 * ツリーの行を押したときとまったく同じ `openFile({ relativePath, name })` で、
 * **検索専用の「開く」を作っていない** ── 作ると、タブの重複の扱いや
 * 未保存の確認が経路ごとに分かれる。
 *
 * ## 絶対パスは出てこない
 *
 * 出しているのは名前と、それを含むフォルダの相対位置だけ。Renderer は
 * そもそも絶対パスを持たない（ARCHITECTURE.md §9.3）。
 */

interface FileNameSearchProps {
  readonly workspace: WorkspaceFolder
  /** 今この表示が見えているか。見えた瞬間に入力欄へ焦点を移すのに使う。 */
  readonly active: boolean
  /** ツリーへ戻る（検索語が空のときの Escape）。 */
  readonly onExit: () => void
  /** 結果を開く（Files → Editor の既存の経路）。 */
  readonly onOpen: (entry: FileEntry) => void
}

export function FileNameSearch({
  workspace,
  active,
  onExit,
  onOpen
}: FileNameSearchProps): JSX.Element {
  const { t } = useI18n()
  const search = useFileSearch(workspace.id)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** 結果の行の DOM。上下キーで焦点を移すために持つ（FileTree.tsx と同じ形）。 */
  const [rowElements] = useState(() => new Map<string, HTMLButtonElement>())

  const matches = searchMatchesOf(search.state)
  const summary = summarizeFileSearch(search.state, t)

  /*
    このモードが見えるようになった瞬間だけ入力欄へ移す
    （ツリーへ戻って作業している間・別のモードを見ている間は焦点を奪わない）。
  */
  useEffect(() => {
    if (active) {
      inputRef.current?.focus()
    }
  }, [active])

  const registerRow = useCallback(
    (id: string, element: HTMLButtonElement | null): void => {
      if (element === null) {
        rowElements.delete(id)
        return
      }

      rowElements.set(id, element)
    },
    [rowElements]
  )

  const focusRow = useCallback(
    (index: number): void => {
      const entry = matches[index]

      if (entry === undefined) {
        return
      }

      rowElements.get(entry.id)?.focus()
    },
    [matches, rowElements]
  )

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        // 待たずに探す（打ち終えているのに待たされない）。
        event.preventDefault()
        search.searchNow()
        return
      }

      if (event.key === 'ArrowDown') {
        // 入力欄から結果へ降りる（ツリーの上下移動と同じ感覚にする）。
        event.preventDefault()
        focusRow(0)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()

        /*
          1回目で検索語を消し、何も無ければツリーへ戻る。
          いきなり戻すと、打ち間違いを消したいだけの Escape で
          結果ごと画面が変わる。
        */
        if (search.query !== '') {
          search.clear()
          return
        }

        onExit()
      }
    },
    [search, focusRow, onExit]
  )

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusRow(index + 1)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()

        if (index === 0) {
          inputRef.current?.focus()
          return
        }

        focusRow(index - 1)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    },
    [focusRow]
  )

  return (
    <div className="fx-search__mode">
      <div className="fx-search__bar">
        <span className="fx-search__icon" aria-hidden="true">
          <SearchIcon />
        </span>

        <input
          ref={inputRef}
          type="text"
          className="fx-search__input"
          value={search.query}
          placeholder={t('files.search.namePlaceholder')}
          aria-label={t('files.search.nameInputLabel', { workspace: workspace.displayName })}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />

        {search.query !== '' && (
          <button
            type="button"
            className="fx-files__tool"
            aria-label={t('files.search.clearLabel')}
            title={t('files.search.clearLabel')}
            onClick={() => {
              search.clear()
              inputRef.current?.focus()
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {/*
        状態の案内。**結果の一覧とは別に持つ**（0 件・取り消し・失敗は
        並べる行が無い状態でも伝える必要がある）。
      */}
      {summary !== null && (
        <div className="fx-search__status" role="status" data-status={search.state.status}>
          <span className="fx-search__status-text">{summary}</span>

          {/* 止める手段は、走っている間だけ出す。 */}
          {search.state.status === 'searching' && (
            <button type="button" className="fx-search__status-action" onClick={search.cancel}>
              {t('files.search.cancel')}
            </button>
          )}

          {/* 取り消した後・失敗した後は、同じ語でもう一度試せるようにする。 */}
          {(search.state.status === 'cancelled' || search.state.status === 'error') && (
            <button type="button" className="fx-search__status-action" onClick={search.searchNow}>
              {t('files.search.retry')}
            </button>
          )}
        </div>
      )}

      <div
        className="fx-search__results"
        role="list"
        aria-label={t('files.search.nameResultsLabel')}
      >
        {matches.map((entry, index) => (
          <button
            key={entry.id}
            ref={(element) => registerRow(entry.id, element)}
            type="button"
            role="listitem"
            className="fx-search-row"
            data-type={entry.type}
            data-relative-path={entry.relativePath}
            // 全体はここで読めるようにする（名前も位置も幅に合わせて省略される）。
            title={entry.relativePath}
            onClick={() => onOpen(entry)}
            onKeyDown={(event) => handleRowKeyDown(event, index)}
          >
            {/*
              種類別のアイコン（Session 3-6-6）。**ツリーと同じ判定**を呼ぶ
              （fileIcon.ts）── ここで書き直すと、同じファイルがツリーと
              検索結果で違う絵になる。フォルダは開閉の状態を持たないので、
              展開状態は渡さない（＝閉じたフォルダとして描かれる）。
            */}
            <span className="fx-search-row__icon" aria-hidden="true">
              <FileTypeIcon icon={resolveEntryIconId(entry)} />
            </span>

            <span className="fx-search-row__name">
              <MatchedName name={entry.name} query={queryOf(search.state)} />
            </span>

            {/*
              どこにあるか。同じ名前のファイルは複数あるのが普通で、
              名前だけでは選べない。出すのは**含んでいるフォルダ**までにする
              （相対位置そのものは title で読める）。
            */}
            <span className="fx-search-row__path">{describeLocation(entry)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** その結果に対応する検索語（結果を持つ状態にだけ入っている）。 */
function queryOf(state: FileSearchState): string {
  return state.status === 'idle' ? '' : state.query
}

/**
 * 一致した部分に印を付けた名前。
 *
 * 一致の判断も範囲も shared/files/search.ts の規則から出ている ──
 * Main が「一致した」と答えた根拠と、ここで色を付ける範囲が同じ1つの規則になる。
 * 範囲を決められない名前（畳むと長さが変わる文字を含む）では印を付けない。
 */
function MatchedName({
  name,
  query
}: {
  readonly name: string
  readonly query: string
}): JSX.Element {
  const match = findFileNameMatch(name, query)

  if (match === null) {
    return <>{name}</>
  }

  return (
    <>
      {name.slice(0, match.start)}
      <mark className="fx-search-row__hit">
        {name.slice(match.start, match.start + match.length)}
      </mark>
      {name.slice(match.start + match.length)}
    </>
  )
}

/**
 * それを含んでいるフォルダ。
 *
 * **Workspace 直下のものには何も出さない。** そこは相対位置として空文字であり、
 * `/` のような印を置くと、名前の隣に意味の無い記号が並ぶだけになる
 * （出したいのは「他とどう違う場所にあるか」であって、root であることではない）。
 */
function describeLocation(entry: FileEntry): string {
  return parentRelativePath(entry.relativePath) ?? ''
}
