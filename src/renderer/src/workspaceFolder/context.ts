import { createContext, useContext } from 'react'
import type { IpcErrorPayload } from '@shared/ipc'
import type { WorkspaceFolder } from '@shared/workspace'

/**
 * 開いている Workspace（プロジェクトフォルダ）を Renderer 全体へ配る仕組み。
 *
 * Files / Editor / Terminal / Git は、いずれも「今どのフォルダを開いているか」を
 * 前提に動く。パネルは自由に配置を変えられ、親子関係が固定されていないため
 * （renderer/src/workspace/）、prop で配ることができない。Context にしておけば
 * どこに置かれたパネルからでも同じ値を読め、Workspace が変わったときには
 * 参照している側だけが描き直される。
 *
 * **正本は Main 側**（main/workspaceFolder/currentWorkspaceFolder.ts）で、
 * ここが持つのは表示のための写し。変更は必ず IPC を通り、その応答で写しを更新する。
 * この形にしておくと、Renderer の状態が古いままファイル操作の基点にされることが無い
 * （Files / Terminal は Main 側の正本を見るため）。
 *
 * Provider は WorkspaceFolderProvider.tsx。この形（Context の定義と Provider の分離）は、
 * Vite の Fast Refresh がコンポーネント以外の export を含むファイルを扱えないため。
 */

export interface WorkspaceFolderController {
  /**
   * 起動直後の取得が済んだか。
   *
   * 'loading' の間は「未選択」と区別が付かないため、Workspace 名や Welcome を
   * まだ出さない（出すと、復元される直前に一瞬「未選択」が見える）。
   */
  readonly status: 'loading' | 'ready'
  /** 今開いている Workspace。未選択なら null。 */
  readonly workspace: WorkspaceFolder | null
  /**
   * 前回の Workspace が見つからず未選択で起動した場合の、そのパス。
   * 利用者にとっては「勝手に閉じられた」ように見えるため、理由として表示する。
   */
  readonly unavailableRootPath: string | null
  /** 直前の操作が失敗したときの利用者向けの文言。成功・取り消しでは null に戻る。 */
  /**
   * 直前の操作の失敗（翻訳前）。
   *
   * 文言にして持つと、失敗を出したまま言語を切り替えたときに前の言語のまま
   * 取り残される。言い表すのは描くとき（WorkspaceWelcome.tsx。Session 4-5B）。
   */
  readonly error: IpcErrorPayload | null
  /** 操作の実行中（ダイアログを開いている間など）。ボタンの二重押しを防ぐ。 */
  readonly busy: boolean
  /** フォルダ選択ダイアログを開く。選ばれたら Workspace を切り替える。 */
  readonly openFolder: () => void
  /** Workspace を閉じて未選択の状態へ戻す。 */
  readonly closeWorkspace: () => void
}

export const WorkspaceFolderContext = createContext<WorkspaceFolderController | null>(null)

/**
 * 開いている Workspace を参照する。
 *
 * Provider の外で呼ばれた場合は例外にする。null を返す形にすると、
 * 「まだ読み込み中」と「Provider を置き忘れた」が同じ値になり、
 * パネル側が前者のつもりで後者を握り潰してしまうため。
 */
export function useWorkspaceFolder(): WorkspaceFolderController {
  const controller = useContext(WorkspaceFolderContext)

  if (controller === null) {
    throw new Error('useWorkspaceFolder must be used inside <WorkspaceFolderProvider>.')
  }

  return controller
}
