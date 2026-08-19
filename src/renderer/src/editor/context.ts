import { createContext, useContext } from 'react'
import type { EditorController } from './useEditorSession'

/**
 * 開いているファイル（Editor のタブと中身）を Renderer 全体へ配る仕組み。
 *
 * **開く側と描く側が別のパネルにある**のがこの Context の理由。
 * Files パネルがファイルを選び、Editor パネルがそれを出すが、2つは自由に配置を
 * 変えられて親子関係が固定されていない（ARCHITECTURE.md §7.3）ため prop では配れない。
 * 開いている Workspace（workspaceFolder/context.ts）と同じ形にしてある。
 *
 * Provider は Workspace Shell の**外側**（App.tsx）に置く。中に置くと、
 * レイアウトの都合でパネルが作り直されたときに開いていたタブまで消える。
 * Monaco の Model も同じ持ち主にぶら下がるため、**Editor パネルを閉じても
 * 未保存の編集が消えない**（monaco/documentStore.ts）。
 *
 * Provider は EditorProvider.tsx。この形（Context の定義と Provider の分離）は、
 * Vite の Fast Refresh がコンポーネント以外の export を含むファイルを扱えないため。
 */

export const EditorContext = createContext<EditorController | null>(null)

/**
 * 開いているタブと中身を参照する。
 *
 * Provider の外で呼ばれた場合は例外にする（useWorkspaceFolder と同じ理由。
 * null を返すと「まだ何も開いていない」と「Provider を置き忘れた」が同じ値になる）。
 */
export function useEditorContext(): EditorController {
  const controller = useContext(EditorContext)

  if (controller === null) {
    throw new Error('useEditorContext must be used inside <EditorProvider>.')
  }

  return controller
}
