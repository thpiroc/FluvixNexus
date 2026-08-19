import type { JSX } from 'react'
import { EditorWorkArea } from '../../editor/EditorWorkArea'
import { useWorkspaceFolder } from '../../workspaceFolder/context'
import { WorkspaceWelcome } from '../../workspaceFolder/WorkspaceWelcome'

/**
 * Editor パネル。
 *
 * DESIGN.md §3 の表では「Workspace」と呼んでいるコード編集パネル。
 * 本実装では画面全体の器を Workspace Shell と呼び、開いているプロジェクトフォルダを
 * Workspace Folder と呼ぶため、混同を避けてパネル側は Editor という名前にしている
 * （役割は DESIGN.md の Workspace と同じ）。
 *
 * ここが決めるのは**何を出す状態か**の3つだけで、中身は editor/ が持つ
 * （FilesPanel と files/ の分担と同じ）。
 *
 *   取得中   … 何も出さない（未選択と区別が付かず、Welcome が一瞬見える）
 *   未選択   … Welcome。編集対象が決まっていない状態は「空」ではなく「これから開く」段階
 *   開いている … タブと、開いているファイル
 *
 * **`key` を Workspace の id にしていない。** FilesPanel はそうしている（§9.6）が、
 * タブの正本は Shell の外側（EditorProvider）にあるため、ここを作り直しても
 * タブは消えない。Workspace が変わったときの破棄は useEditorTabs.ts が行う。
 */
export function EditorPanel(): JSX.Element {
  const { status, workspace } = useWorkspaceFolder()

  // 取得が済むまでは何も出さない（未選択と区別が付かないため、Welcome が一瞬見えてしまう）。
  if (status === 'loading') {
    return <div className="fx-welcome" />
  }

  if (workspace === null) {
    return <WorkspaceWelcome />
  }

  return <EditorWorkArea />
}
