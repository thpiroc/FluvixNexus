import type { JSX } from 'react'
import { FilesView } from '../../files/FilesView'
import { useFilesLayout } from '../../files/useFilesLayout'
import { useWorkspaceFolder } from '../../workspaceFolder/context'

/**
 * Files パネル。
 *
 * 中身は files/ が持つ。ここが決めるのは**何を出す状態か**の3つだけ。
 *
 *   取得中   … 何も出さない（未選択と区別が付かず、一瞬「Workspace がありません」が見える）
 *   未選択   … 開く入口だけを出す
 *   開いている … Files の中身（一覧 / 検索。files/FilesView.tsx）
 *
 * `key` に Workspace の id を渡しているのが要点。Workspace が切り替わると
 * 中身は作り直され、前の Workspace で読み込んだ内容も展開状態も、
 * **選んでいた位置も開いていたカラムも**、**走っている検索も**
 * （useFileSearch.ts の破棄で取り消される）React が破棄する。
 * 「切り替わったら消す」処理を書くより、消し忘れが起こらない
 * （id は開いた記録ごとに変わるため、同じフォルダを開き直した場合も作り直しになる）。
 *
 * ## パネルの形の観測は、この器1か所（Session 3-6-7）
 *
 * ResizeObserver を張るのは下の `.fx-files-panel` 1つだけ（useFilesLayout.ts）。
 * 中身（ツリーの行・カラム）には張らない ── 開いた行の数だけ観測対象が増える。
 *
 * **表示方式（ツリー / カラム）は `key` の外側で持つ。** Workspace を切り替えても、
 * パネルの形も、それに合わせた見え方も変わらないため ── 表示方式は
 * **パネルの見え方**であって Workspace の持ち物ではない（DESIGN.md §3）。
 * 中で持つと、切り替えのたびに選んだ表示方式が初期化される。
 *
 * 後続セッションでここに載るもの:
 *   - 複数選択とその Drag（移動 / コピー / ドラッグ&ドロップは Session 3-6-1〜3-6-3 で実装済み）
 */
export function FilesPanel(): JSX.Element {
  const { status, workspace, busy, openFolder } = useWorkspaceFolder()
  const layout = useFilesLayout()

  return (
    <div className="fx-files-panel" ref={layout.registerContainer}>
      {status === 'loading' ? null : workspace === null ? (
        <div className="fx-files fx-files--empty">
          <p className="fx-files__message">Workspace が開かれていません。</p>
          <button type="button" className="fx-files__action" onClick={openFolder} disabled={busy}>
            フォルダを開く
          </button>
        </div>
      ) : (
        <FilesView key={workspace.id} workspace={workspace} layout={layout} />
      )}
    </div>
  )
}
