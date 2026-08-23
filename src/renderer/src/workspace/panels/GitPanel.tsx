import type { JSX } from 'react'
import { GitView } from '../../git/GitView'
import { useWorkspaceFolder } from '../../workspaceFolder/context'
import '../../git/git.css'

/**
 * Git パネル（Session 3-8-1）。
 *
 * DESIGN.md §3 の GitHub パネルに相当する。Git 操作そのものは Main Process 側で
 * 実行し、Renderer からはコマンドも引数も作業ディレクトリも渡せない
 * （shared/ipc/contracts/git.ts）。
 *
 * 中身は git/ が持つ。ここが決めるのは**何を出す状態か**の2つだけで、
 * FilesPanel / TerminalPanel と同じ分担にしてある。
 *
 *   未選択   … 開く入口だけを出す
 *   開いている … Git の中身（git/GitView.tsx）
 *
 * 「取得中」を持たないのは、その判断が中身の側にもう1段あるため
 * （Workspace の取得と、Git の問い合わせ）。両方をここで見ると、
 * パネルの出し分けが Git の事情を知ることになる。
 *
 * `key` に Workspace の id を渡していないのは、切り替えを中身の側が
 * 見ているから（git/useGitRepository.ts が `workspace.id` を依存に持ち、
 * 変わったら調べ直す）。作り直すより、同じ器のまま調べ直す方が、
 * ブランチ名の欄が一瞬空になる時間が短い。
 */
export function GitPanel(): JSX.Element {
  const { status, workspace, busy, openFolder } = useWorkspaceFolder()

  if (status === 'loading') {
    return <div className="fx-git" />
  }

  if (workspace === null) {
    return (
      <div className="fx-git fx-git--notice">
        <p className="fx-git__title">Workspace が開かれていません。</p>
        <button type="button" className="fx-git__action" onClick={openFolder} disabled={busy}>
          フォルダを開く
        </button>
      </div>
    )
  }

  return <GitView />
}
