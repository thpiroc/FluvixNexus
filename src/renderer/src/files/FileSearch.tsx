import { useState, type JSX } from 'react'
import type { FileEntry } from '@shared/files'
import type { WorkspaceFolder } from '@shared/workspace'
import { FileContentSearch, type FileContentOpenTarget } from './FileContentSearch'
import { FileNameSearch } from './FileNameSearch'
import { BackIcon } from './FileTreeIcons'
import { useI18n } from '../i18n/context'

/**
 * Files パネルの検索モード（Session 3-6-4 / 3-6-5）。
 *
 * **新しいパネルを作っていない。** ツリーと同じ Files パネルの中で表示を差し替える
 * （FilesView.tsx）。パネルを増やすと、置き場所を利用者が決めることになり、
 * 「探して開く」という一続きの操作が2つの領域に分かれる。
 *
 * Session 3-6-5 で探し方が2つになった。このファイルが持つのは、
 * その2つに共通する枠だけになる。
 *
 * ```
 * [<]  [ ファイル名 | 全文 ]      ← ここ（戻る手段とモードの切り替え）
 *      [検索欄]                   ← FileNameSearch.tsx / FileContentSearch.tsx
 *      状態の1行
 *      結果
 * ```
 *
 * ## モードを増やしても、探し方は増やさない
 *
 * 「ファイル名も中身も同時に探す」形にしていない。同時に探すと、
 * **結果の並べ方が2種類混ざる**（名前の一致は1行、中身の一致はファイル単位の入れ子）
 * うえに、上限が2つの検索ぶん緩む。どちらを探しているかは利用者が知っている情報で、
 * 押して切り替えるほうが結果を読みやすい。
 *
 * ## どちらのモードも作り直さない
 *
 * FilesView.tsx がツリーと検索を `hidden` で切り替えているのと同じ形で、
 * 2つのモードも**両方を持ったまま隠す**。切り替えのたびに作り直すと、
 * 名前で探して見つからなかったので全文へ切り替え、また名前へ戻す、という
 * 行き来のたびに結果が消える。
 *
 * 隠れている側は何もしない ── 検索語が入るまで要求を出さないため。
 *
 * ## 走っている検索は Main 側で1本に絞られる
 *
 * モードを切り替えても、Renderer 側では前のモードの検索を止めていない。
 * 止まるのは**新しい検索が始まったとき**で、それを保証しているのは Main の
 * workspaceSearchSession.ts（名前・全文が同じ管理を通る）。
 * ここで止める手を足すと、同じ約束が2箇所で守られることになり、
 * 片方だけを直したときに食い違う。
 */

/** 探し方。将来ここに増える場合も、増えるのは行の並べ方であって開く経路ではない。 */
type FileSearchMode = 'name' | 'content'

const MODES: readonly FileSearchMode[] = ['name', 'content']

interface FileSearchProps {
  readonly workspace: WorkspaceFolder
  /** 今この表示が見えているか。見えた瞬間に入力欄へ焦点を移すのに使う。 */
  readonly active: boolean
  /** ツリーへ戻る。 */
  readonly onExit: () => void
  /** 名前の検索の結果を開く（フォルダはツリーで場所を見せる）。 */
  readonly onOpen: (entry: FileEntry) => void
  /** 全文検索の結果を開く（行・桁へ飛ぶ）。 */
  readonly onOpenMatch: (target: FileContentOpenTarget) => void
}

export function FileSearch({
  workspace,
  active,
  onExit,
  onOpen,
  onOpenMatch
}: FileSearchProps): JSX.Element {
  const { t } = useI18n()
  const [mode, setMode] = useState<FileSearchMode>('name')

  return (
    <div className="fx-files fx-search">
      <div className="fx-search__modes">
        <button
          type="button"
          className="fx-files__tool"
          aria-label={t('files.search.backLabel')}
          title={t('files.search.backLabel')}
          onClick={onExit}
        >
          <BackIcon />
        </button>

        {/*
          探し方の切り替え。タブとして読ませる（押すと表示が入れ替わる）。
          選ばれている方は `aria-pressed` で伝える ── 見た目の色だけだと、
          読み上げでどちらを見ているかが分からない。
        */}
        <div
          className="fx-search__mode-group"
          role="group"
          aria-label={t('files.search.modeGroupLabel')}
        >
          {MODES.map((value) => (
            <button
              key={value}
              type="button"
              className="fx-search__mode-button"
              data-active={value === mode}
              aria-pressed={value === mode}
              onClick={() => setMode(value)}
            >
              {value === 'name' ? t('files.search.nameMode') : t('files.search.contentMode')}
            </button>
          ))}
        </div>
      </div>

      <div className="fx-search__pane" hidden={mode !== 'name'}>
        <FileNameSearch
          workspace={workspace}
          active={active && mode === 'name'}
          onExit={onExit}
          onOpen={onOpen}
        />
      </div>

      <div className="fx-search__pane" hidden={mode !== 'content'}>
        <FileContentSearch
          workspace={workspace}
          active={active && mode === 'content'}
          onExit={onExit}
          onOpen={onOpenMatch}
        />
      </div>
    </div>
  )
}
