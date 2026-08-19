import type { JSX } from 'react'
import { EditorProvider } from './editor/EditorProvider'
import { FilesViewProvider } from './files/FilesViewProvider'
import { UnsavedChangesProvider } from './unsaved/UnsavedChangesProvider'
import { WorkspaceShell } from './workspace/WorkspaceShell'
import { WorkspaceFolderProvider } from './workspaceFolder/WorkspaceFolderProvider'

/**
 * Renderer のルート。
 *
 * 画面の組み立ては Workspace Shell の責務のため、ここでは何も持たない。
 * アプリ全体に関わるもの（エラーバウンダリ、テーマの切り替え、
 * 独立ウィンドウ化した際のルート分岐など）が必要になったときだけこの層に足す。
 *
 * Shell より外側に置いているものが4つある。どれも**レイアウトの都合でパネルが
 * 作り直されても消えてはいけない状態**で、パネルは自由に配置を変えられて
 * 親子関係が固定されていないため prop では配れない。
 *
 *   UnsavedChangesProvider  … 未保存の内容を失う操作に挟む確認（unsaved/types.ts）
 *   WorkspaceFolderProvider … 開いているプロジェクトフォルダ（全パネルが対象にするもの）
 *   EditorProvider          … 開いているファイルのタブ（Files が開き、Editor が出す）
 *   FilesViewProvider       … Files の表示方式として**利用者が選んだ方**（Session 3-6-7）
 *
 * Shell の中に置くと、レイアウトの都合でパネルが作り直されたときに
 * これらの状態まで消える。
 *
 * 前の3つが「パネルをまたいで共有される」ものであるのに対し、FilesViewProvider は
 * Files パネルだけのものになる。それでも外側に置いているのは、**パネルを別の場所へ
 * 運んだだけで、選んだ表示方式が消えてしまう**ため ── 置き場所を変えられることが
 * このアプリの前提である以上、選択は置き場所より長く生きる必要がある
 * （files/FilesViewProvider.tsx）。
 *
 * ## 入れ子の順序
 *
 * 内側ほど、外側に依存する。
 *
 *   Editor は「どの Workspace のタブか」を知る必要がある → Workspace が外
 *   Workspace を閉じる / 切り替えるときに未保存の確認が要る → 確認がさらに外
 *   Editor は「未保存を持っている」と申告する            → 同じ器が両方から見える
 *
 * 確認の器を一番外に置くことで、**未保存を持つ側（Editor）と失わせる側（Workspace）が
 * 互いを知らないまま**、同じ確認を通せる。
 */
function App(): JSX.Element {
  return (
    <UnsavedChangesProvider>
      <WorkspaceFolderProvider>
        <EditorProvider>
          {/* 表示方式の選択は他の3つに依存しない。一番内側で足りる。 */}
          <FilesViewProvider>
            <WorkspaceShell />
          </FilesViewProvider>
        </EditorProvider>
      </WorkspaceFolderProvider>
    </UnsavedChangesProvider>
  )
}

export default App
