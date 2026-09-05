import { useCallback, useState, type JSX } from 'react'
import type { FileEntry } from '@shared/files'
import type { WorkspaceFolder } from '@shared/workspace'
import { useCommand } from '../commands/useCommand'
import { useEditorContext } from '../editor/context'
import type { FileContentOpenTarget } from './FileContentSearch'
import { FilesExplorer } from './FilesExplorer'
import { FileSearch, type FileSearchMode } from './FileSearch'
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
 *
 * ## 検索の2つの state を、ここが両方持つ（Session 4-7B）
 *
 * 3-6-5 から 4-5C までは分かれていた ── 「ツリーか検索か」はここ、
 * 「名前で探すか中身で探すか」は FileSearch の中。4-7B で後者を
 * ここへ持ち上げた（FileSearch.tsx は props で受ける）。
 *
 * `files.search.byName` / `files.search.byContent` が**2段を同時に動かす**
 * ためになる ── 「検索を開いて、かつ中身の側を選ぶ」は、片方しか持っていない
 * 場所からは言えない。持ち上げれば、両方を知っている場所が1つになり、
 * command はそこが名乗る。
 *
 * 持ち上げたのは持ち主だけで、**振る舞いは1つも変えていない。**
 *
 * ## `files.refresh` はここが名乗らない
 *
 * ツリーの状態（読み込み済みの中身・展開状態）を持っているのは
 * FilesExplorer の中の controller で、ここからは届かない ──
 * **その状態を持っている場所が名乗る**という commands/useCommand.ts の作法
 * どおり、あちらが名乗る（FilesExplorer.tsx）。
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
   * どちらで探しているか（Session 4-7B で FileSearch から持ち上げた。上記）。
   *
   * 検索を閉じても**戻さない** ── 持ち上げる前の FileSearch は隠れるだけで
   * 作り直されなかったので、ツリーへ戻って検索を開き直すと前の探し方のままだった。
   * ここで `'name'` へ戻すと、それが変わってしまう。
   */
  const [searchMode, setSearchMode] = useState<FileSearchMode>('name')
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

  /*
    ------------------------------------------------ command（Session 4-7B）

    検索を、指定した探し方で開く。**ツールバーの虫めがねを押してから
    探し方のボタンを押す**のと同じ2手を、1回で行うだけになる ──
    新しい経路を作っていないので、押した後の姿はどちらでも同じ。

    入力欄への焦点は**ここでは触らない。** 見えるようになったモードが
    自分で移す（FileNameSearch.tsx / FileContentSearch.tsx の `active`）──
    そこに既にある約束で、command のために2つ目の焦点の移し方を作らない。

    既に同じモードを見ているときは何も起きない（`active` が false → true に
    変わらないため、焦点も動かない）。押し直しで入力欄へ戻れる形にするなら
    `active` の側の設計を変えることになり、それは検索の話であって
    command の話ではない ── 後続へ送ってある。
  */
  const showSearch = useCallback((next: FileSearchMode): void => {
    setSearchMode(next)
    setMode('search')
  }, [])

  useCommand('files.search.byName', () => showSearch('name'))
  useCommand('files.search.byContent', () => showSearch('content'))

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
          mode={searchMode}
          onModeChange={setSearchMode}
          onExit={() => setMode('files')}
          onOpen={openEntry}
          onOpenMatch={openMatch}
        />
      </div>
    </div>
  )
}
