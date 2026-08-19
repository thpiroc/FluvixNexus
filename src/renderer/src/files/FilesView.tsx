import { useCallback, useState, type JSX } from 'react'
import type { FileEntry } from '@shared/files'
import type { WorkspaceFolder } from '@shared/workspace'
import { useEditorContext } from '../editor/context'
import type { FileContentOpenTarget } from './FileContentSearch'
import { FilesExplorer } from './FilesExplorer'
import { FileSearch } from './FileSearch'
import type { FilesLayoutController } from './useFilesLayout'
import './files.css'

/**
 * Files パネルの中身（一覧 / 検索の切り替え。Session 3-6-4）。
 *
 * ## パネルを増やさない
 *
 * 検索は Files パネルの中の**もう1つの見せ方**であって、別の場所ではない。
 * パネルを足すと、置き場所と大きさを利用者が決めることになり、
 * 「探す → 開く → 一覧で場所を確かめる」という一続きの操作が
 * 画面上の2箇所に分かれる。View メニューにも1つ増える。
 *
 * ## どちらも作り直さない（両方を持ったまま隠す）
 *
 * `hidden` で隠すだけにして、**どちらの状態も捨てない。**
 * 切り替えのたびに作り直すと、
 *   - 一覧 … 展開状態と読み込み済みの中身が消え、戻るたびに読み直しになる
 *   - 検索 … 結果が消え、一覧で場所を確かめてから戻ると探し直しになる
 * となる。Lazy Load（Session 3-2）で読む量を利用者の操作した範囲に留めているのに、
 * 表示の切り替えだけで全部忘れるのは筋が通らない。
 *
 * 隠れている側は何もしない ── 検索は検索語が入るまで要求を出さず、
 * 一覧は変化の通知を受けるだけ（それは表示していなくても正しい振る舞いになる）。
 *
 * **ツリーとカラムの切り替え（Session 3-6-7）はこの層より内側にある。**
 * あちらは状態をすべて controller が持っているため、隠さずに描き分けてよい
 * （FilesExplorer.tsx）。ここで隠しているのは、状態を持ち合わせている
 * 一覧と検索の2つになる。
 *
 * ## 開く経路は1つ
 *
 * 検索結果を押したときに呼ぶのも、一覧の行を押したときと同じ
 * `openFile({ relativePath, name })`（editor/context.ts）。ここで分岐しているのは
 * **フォルダかファイルか**だけで、フォルダは一覧側で場所を見せる。
 *
 * 全文検索の結果（Session 3-6-5）も同じで、呼ぶのは `openFileAt` ── これも
 * 中では同じ `openTab` を通り、**既に開いているファイルなら2枚目のタブを作らない**。
 * 違うのは「開いた後にこの行・桁を見せてほしい」という依頼が付くところだけになる
 * （editor/editorReveal.ts）。
 */

type FilesViewMode = 'files' | 'search'

interface FilesViewProps {
  readonly workspace: WorkspaceFolder
  /** パネルの形と、利用者が選んだ表示方式（useFilesLayout.ts）。 */
  readonly layout: FilesLayoutController
}

export function FilesView({ workspace, layout }: FilesViewProps): JSX.Element {
  const [mode, setMode] = useState<FilesViewMode>('files')
  /**
   * 一覧の中で場所を見せる対象（見せる必要が無ければ null）。
   *
   * 検索結果を押したときにここへ入れ、一覧が祖先を開いて選ぶ。
   * **一覧の状態そのものは一覧が持つ**（useFilesController.ts）ので、
   * ここが持つのは「どこを見せてほしいか」という依頼だけになる。
   */
  const [revealTarget, setRevealTarget] = useState<FileEntry | null>(null)

  const { openFile, openFileAt } = useEditorContext()

  /** 名前の検索の結果を開く（Session 3-6-4）。 */
  const openEntry = useCallback(
    (entry: FileEntry): void => {
      // 開いたもの / 選んだものが、一覧側でも見えるようにしておく。
      setRevealTarget(entry)

      /*
        フォルダは Editor で開けない。押した意図は「そこを見たい」なので、
        一覧へ戻って場所を見せる（検索欄と結果はそのまま残る）。
      */
      if (entry.type === 'directory') {
        setMode('files')
        return
      }

      /*
        ファイルは開いて、**検索モードのまま**にしておく。
        続けて別の結果を開くのが素直な流れで、戻す方が手数になる。
      */
      openFile({ relativePath: entry.relativePath, name: entry.name })
    },
    [openFile]
  )

  /**
   * 全文検索の結果を開く（Session 3-6-5）。
   *
   * 呼ぶのは `openFileAt` 1つ。**開く部分は `openFile` と同じ `openTab`** で
   * （editor/useEditorTabs.ts）、既に開いているファイルなら2枚目のタブは作られず、
   * そのタブが手前に出て位置だけが動く。
   */
  const openMatch = useCallback(
    (target: FileContentOpenTarget): void => {
      setRevealTarget({
        // id の作り方は一覧・列挙と同じ（shared/files/entry.ts）。
        id: `f:${target.relativePath}`,
        name: target.name,
        relativePath: target.relativePath,
        type: 'file',
        // 拡張子は場所を見せるのに使わない（アイコンは行の種別で決まる）。
        extension: null
      })

      openFileAt({
        relativePath: target.relativePath,
        name: target.name,
        line: target.line,
        column: target.column,
        length: target.length
      })
    },
    [openFileAt]
  )

  return (
    <div className="fx-files-view">
      <div className="fx-files-view__pane" hidden={mode !== 'files'}>
        <FilesExplorer
          workspace={workspace}
          layout={layout}
          revealTarget={revealTarget}
          onSearch={() => setMode('search')}
        />
      </div>

      <div className="fx-files-view__pane" hidden={mode !== 'search'}>
        <FileSearch
          workspace={workspace}
          active={mode === 'search'}
          onExit={() => setMode('files')}
          onOpen={openEntry}
          onOpenMatch={openMatch}
        />
      </div>
    </div>
  )
}
