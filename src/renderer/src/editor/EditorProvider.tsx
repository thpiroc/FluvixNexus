import { useEffect, useMemo, type JSX, type ReactNode } from 'react'
import { useUnsavedChanges } from '../unsaved/context'
import type { LossItem, LossSource } from '../unsaved/types'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { EditorContext } from './context'
import { useEditorSession } from './useEditorSession'

/**
 * Editor のタブと中身を保持し、Renderer 全体へ配る。
 *
 * 状態・IPC・Monaco の Model は useEditorSession.ts が持ち、ここは Workspace の id を
 * 渡して Context に載せるだけ。WorkspaceFolderProvider の内側・Workspace Shell の外側に置く
 * （App.tsx）。
 *
 *   内側に置けない … Workspace が分からないと、どの Workspace のタブか判断できない
 *   Shell の中に置けない … レイアウトの都合でパネルが作り直されるとタブと編集内容が消える
 *
 * ## 未保存があることを申告する
 *
 * Workspace を閉じる・切り替える・アプリを終了する、はいずれも Editor の外で起きる。
 * それぞれの入口が Editor の事情を知る形にすると、**入口が増えるたびに保護が抜ける**。
 * そこで「未保存を持っている」ことだけを申告し、確認そのものは共通の器
 * （unsaved/UnsavedChangesProvider.tsx）に任せる。
 */
export function EditorProvider({ children }: { children: ReactNode }): JSX.Element {
  const { workspace } = useWorkspaceFolder()
  const controller = useEditorSession(workspace?.id ?? null)
  const { registerSource } = useUnsavedChanges()

  const { unsavedTabs, saveAllUnsaved } = controller

  /*
    申告する中身は「今の値」ではなく「今の値を返す関数」。
    確認が出るのは操作の瞬間で、そのときの最新を見せる必要があるため
    （申告し直すたびに登録し直す形にすると、タブを1枚開くだけで
    購読の付け替えが起きる）。
  */
  const source = useMemo<LossSource>(
    () => ({
      /*
        どの操作でも同じものを申告する。未保存の変更は、Workspace を閉じても
        切り替えても失われる（Terminal と違い、タブは切り替えで捨てられる）。
        非同期なのは器の都合で、こちらは自分の状態を見れば答えられる。
      */
      listLosses: async (): Promise<readonly LossItem[]> =>
        unsavedTabs.map((tab) => ({
          id: tab.relativePath,
          kind: 'unsaved-file',
          name: tab.name,
          detail: tab.relativePath,
          // 消えたファイルは保存し直せない（別名保存は Session 3-6 以降）。
          unsavable: tab.state === 'deleted'
        })),
      saveAll: saveAllUnsaved
    }),
    [unsavedTabs, saveAllUnsaved]
  )

  useEffect(() => registerSource(source), [registerSource, source])

  return <EditorContext.Provider value={controller}>{children}</EditorContext.Provider>
}
