import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import type { FileContentMatch } from '@shared/files'
import type { WorkspaceFolder } from '@shared/workspace'
import { resolveDirectoryIconId, resolveFileIconId } from './fileIcon'
import { CloseIcon, FileTypeIcon, SearchIcon } from './FileTreeIcons'
import {
  contentSearchFilesOf,
  isFocusableContentRow,
  summarizeFileContentSearch,
  toFileContentSearchRows,
  type FileContentSearchRow
} from './fileContentSearchModel'
import { useFileContentSearch } from './useFileContentSearch'
import { useI18n } from '../i18n/context'

/**
 * ファイルの中身で探す（Session 3-6-5）。
 *
 * 名前の検索（FileNameSearch.tsx）と対になる、Files パネルのもう1つの検索モード。
 * 枠（戻る手段とモードの切り替え）は共有していて、ここが持つのは
 * **入力欄・状態の案内・結果の並べ方**だけになる。
 *
 * 状態は useFileContentSearch.ts、状態の意味づけと行の並びは
 * fileContentSearchModel.ts（純粋）が持つ。
 *
 * ## 開くのは既存の経路
 *
 * 結果を押したときに呼ぶのは、親から渡された `onOpen` 1つ。その先は
 * `openFileAt({ relativePath, name, line, column, length })`（editor/useEditorTabs.ts）で、
 * **開く部分はツリー・名前検索と同じ `openTab`** にたどり着く ──
 * 既に開いているファイルなら2枚目のタブを作らず、そのタブが手前に出て
 * 位置だけが動く。検索専用の「開く」は作っていない。
 *
 * ## ファイル → 一致 の2段で並べる
 *
 * 平らな一覧にすると、同じファイルの名前が一致の数だけ並ぶ。
 * ファイルを見出しにして、その下に `42:15 const example …` を並べると、
 * **どのファイルに何件あるか**が数えずに分かる。見出し（フォルダ・ファイル）と
 * 一致を1つの配列として持つのは、上下キーの移動を「配列の隣」で決めるため
 * （入れ子の DOM にすると、移動の実装が木の探索になる）。
 *
 * ## 絶対パスは出てこない
 *
 * 出しているのは相対位置・行・桁と、その周辺のテキストだけ。
 * 周辺のテキストは Main が切り出したもので、ファイルの中身そのものは運ばれない。
 */

/** 押されたときに開く相手（行・桁つき）。 */
export interface FileContentOpenTarget {
  readonly relativePath: string
  readonly name: string
  readonly line: number
  readonly column: number
  readonly length: number
}

interface FileContentSearchProps {
  readonly workspace: WorkspaceFolder
  /** 今この表示が見えているか。見えた瞬間に入力欄へ焦点を移すのに使う。 */
  readonly active: boolean
  /** ツリーへ戻る（検索語が空のときの Escape）。 */
  readonly onExit: () => void
  /** 結果を開く（Files → Editor の既存の経路に、位置を添えたもの）。 */
  readonly onOpen: (target: FileContentOpenTarget) => void
}

export function FileContentSearch({
  workspace,
  active,
  onExit,
  onOpen
}: FileContentSearchProps): JSX.Element {
  const { t } = useI18n()
  const search = useFileContentSearch(workspace.id)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** 押せる行の DOM。上下キーで焦点を移すために持つ。 */
  const [rowElements] = useState(() => new Map<string, HTMLButtonElement>())

  const files = contentSearchFilesOf(search.state)
  const summary = summarizeFileContentSearch(search.state, t)

  /*
    結果が変わったときだけ組み直す。行の並びは結果から決まる（純粋）ので、
    描画のたびに作り直すと、押せる行の並びまで毎回別物になる。
  */
  const rows = useMemo(() => toFileContentSearchRows(files), [files])
  /** 上下キーで移動する対象（見出しは飛ばす）。 */
  const focusable = useMemo(() => rows.filter(isFocusableContentRow), [rows])

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
      const row = focusable[index]

      if (row === undefined) {
        return
      }

      rowElements.get(row.id)?.focus()
    },
    [focusable, rowElements]
  )

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        event.preventDefault()
        search.searchNow()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusRow(0)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()

        // 1回目で検索語を消し、何も無ければツリーへ戻る（名前の検索と同じ）。
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

  /** 押せる行の通し番号（上下キーの移動に使う）。見出しは -1。 */
  const focusIndexOf = useCallback(
    (row: FileContentSearchRow): number => focusable.findIndex((target) => target.id === row.id),
    [focusable]
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
          placeholder={t('files.search.contentPlaceholder')}
          aria-label={t('files.search.contentInputLabel', { workspace: workspace.displayName })}
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

      {summary !== null && (
        <div className="fx-search__status" role="status" data-status={search.state.status}>
          <span className="fx-search__status-text">{summary}</span>

          {search.state.status === 'searching' && (
            <button type="button" className="fx-search__status-action" onClick={search.cancel}>
              {t('files.search.cancel')}
            </button>
          )}

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
        aria-label={t('files.search.contentResultsLabel')}
      >
        {rows.map((row) => {
          if (row.kind === 'folder') {
            return (
              <div key={row.id} className="fx-content-folder" title={row.label}>
                <span className="fx-content-folder__icon" aria-hidden="true">
                  <FileTypeIcon icon={resolveDirectoryIconId(false)} />
                </span>
                <span className="fx-content-folder__label">{row.label}</span>
              </div>
            )
          }

          if (row.kind === 'file') {
            return (
              <button
                key={row.id}
                ref={(element) => registerRow(row.id, element)}
                type="button"
                role="listitem"
                className="fx-content-file"
                data-relative-path={row.relativePath}
                title={row.relativePath}
                /*
                  ファイルの行を押したら**最初の一致**へ飛ぶ。
                  「開くだけ」にすると、押した位置によって行くところが変わる
                  （見出しを押すと先頭、一致を押すとその行）── 見出しからでも
                  探しているものが見える方が、続けて次の一致へ進みやすい。
                */
                onClick={() =>
                  onOpen({
                    relativePath: row.relativePath,
                    name: row.name,
                    line: row.first.line,
                    column: row.first.column,
                    length: row.first.length
                  })
                }
                onKeyDown={(event) => handleRowKeyDown(event, focusIndexOf(row))}
              >
                {/*
                  種類別のアイコン（Session 3-6-6）。全文検索の結果は FileEntry を
                  持たず名前しか無いため、**名前から引く関数**（fileIcon.ts）を直接呼ぶ
                  ── ツリー・名前検索が使っているのと同じ表にたどり着く。
                */}
                <span className="fx-content-file__icon" aria-hidden="true">
                  <FileTypeIcon icon={resolveFileIconId(row.name)} />
                </span>

                <span className="fx-content-file__name">{row.name}</span>

                {/* 何件あるか。上限に当たったファイルには、その先があることを示す。 */}
                <span className="fx-content-file__count">
                  {t(
                    row.truncated
                      ? 'files.search.fileMatchCountTruncated'
                      : 'files.search.fileMatchCount',
                    { count: row.matchCount }
                  )}
                </span>
              </button>
            )
          }

          return (
            <button
              key={row.id}
              ref={(element) => registerRow(row.id, element)}
              type="button"
              role="listitem"
              className="fx-content-match"
              data-relative-path={row.relativePath}
              title={`${row.relativePath}:${row.match.line}:${row.match.column}`}
              onClick={() =>
                onOpen({
                  relativePath: row.relativePath,
                  name: row.name,
                  line: row.match.line,
                  column: row.match.column,
                  length: row.match.length
                })
              }
              onKeyDown={(event) => handleRowKeyDown(event, focusIndexOf(row))}
            >
              {/* 行:桁。Editor の行番号とそのまま対応する（1始まり）。 */}
              <span className="fx-content-match__position">
                {row.match.line}:{row.match.column}
              </span>

              <span className="fx-content-match__text">
                <MatchedPreview match={row.match} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 一致した部分に印を付けた周辺のテキスト。
 *
 * 印を付ける位置を**ここで探し直さない。** Main が返した `previewColumn` を
 * そのまま使う ── 一致を見つけたのは Main（main/files/contentMatches.ts）で、
 * ここで探し直すと、大文字小文字の畳み方が2箇所に分かれて印がずれる。
 *
 * 長い検索語では、一致が preview の末尾を越えることがある（切り出しの上限）。
 * その場合は preview の終わりまでを印にする。
 */
function MatchedPreview({ match }: { readonly match: FileContentMatch }): JSX.Element {
  const start = Math.max(0, Math.min(match.previewColumn - 1, match.preview.length))
  const end = Math.min(start + match.length, match.preview.length)

  return (
    <>
      {match.preview.slice(0, start)}
      <mark className="fx-content-match__hit">{match.preview.slice(start, end)}</mark>
      {match.preview.slice(end)}
    </>
  )
}
