import type { JSX } from 'react'
import { CommandProvider } from './commands/CommandProvider'
import { BreakpointProvider } from './debug/BreakpointProvider'
import { CallStackProvider } from './debug/CallStackProvider'
import { DebugProvider } from './debug/DebugProvider'
import { ExecutionLocationFollower } from './debug/ExecutionLocationFollower'
import { EditorProvider } from './editor/EditorProvider'
import { FilesViewProvider } from './files/FilesViewProvider'
import { LanguageProvider } from './i18n/LanguageProvider'
import { KeybindingProvider } from './keybindings/KeybindingProvider'
import { LspSettingsProvider } from './lsp/LspSettingsProvider'
import { TerminalProvider } from './terminal/TerminalProvider'
import { ThemeProvider } from './theme/ThemeProvider'
import { UnsavedChangesProvider } from './unsaved/UnsavedChangesProvider'
import { WorkspaceShell } from './workspace/WorkspaceShell'
import { WorkspaceFolderProvider } from './workspaceFolder/WorkspaceFolderProvider'

/**
 * Renderer のルート。
 *
 * 画面の組み立ては Workspace Shell の責務のため、ここでは何も持たない。
 * アプリ全体に関わるもの（エラーバウンダリ、独立ウィンドウ化した際のルート分岐など）が
 * 必要になったときだけこの層に足す。
 *
 * Shell より外側に置いているものが11ある。どれも**レイアウトの都合でパネルが
 * 作り直されても消えてはいけない状態**で、パネルは自由に配置を変えられて
 * 親子関係が固定されていないため prop では配れない。
 *
 *   ThemeProvider           … アプリ全体の見た目（Session 4-4。theme/ThemeProvider.tsx）
 *   CommandProvider         … 実行できる操作の表（Session 4-7A。commands/CommandProvider.tsx）
 *   UnsavedChangesProvider  … 失われるものがある操作に挟む確認（unsaved/types.ts）
 *   WorkspaceFolderProvider … 開いているプロジェクトフォルダ（全パネルが対象にするもの）
 *   EditorProvider          … 開いているファイルのタブ（Files が開き、Editor が出す）
 *   TerminalProvider        … 動いているシェルと、その画面（Session 3-7-1）
 *   FilesViewProvider       … Files の表示方式として**利用者が選んだ方**（Session 3-6-7）
 *   LspSettingsProvider     … Language Server を使うか（Session 5-4。lsp/）
 *   DebugProvider           … Profile 選択と実行 command（Session 7-1A。debug/）
 *   BreakpointProvider      … その Workspace の breakpoint（Session 6-3。debug/）
 *   KeybindingProvider      … 打鍵を command へ繋ぐ（Session 4-7A。keybindings/）
 *
 * Shell の中に置くと、レイアウトの都合でパネルが作り直されたときに
 * これらの状態まで消える。Terminal はそれが**最も分かりやすく表に出る**もので、
 * パネルを動かしただけでシェルが切れては道具にならない
 * （terminal/terminalScreenStore.ts）。
 *
 * 前の4つが「パネルをまたいで共有される」ものであるのに対し、FilesViewProvider は
 * Files パネルだけのものになる。それでも外側に置いているのは、**パネルを別の場所へ
 * 運んだだけで、選んだ表示方式が消えてしまう**ため ── 置き場所を変えられることが
 * このアプリの前提である以上、選択は置き場所より長く生きる必要がある
 * （files/FilesViewProvider.tsx）。
 *
 * ## 入れ子の順序
 *
 * 内側ほど、外側に依存する。
 *
 *   Theme はどこにも依存せず、**すべてに効く**              → 一番外
 *   Editor は「どの Workspace のタブか」を知る必要がある → Workspace が外
 *   Workspace を閉じる / 切り替えるときに未保存の確認が要る → 確認がさらに外
 *   Editor は「未保存を持っている」と申告する            → 同じ器が両方から見える
 *   Terminal は「実行中のものがある」と申告する（3-7-4） → 同上
 *
 * 確認の器を一番外に置くことで、**失われるものを持つ側（Editor / Terminal）と
 * 失わせる側（Workspace・ウィンドウを閉じる）が互いを知らないまま**、
 * 同じ確認を通せる。
 *
 * Theme をさらに外へ置いたのは、**確認ダイアログにも効く必要がある**ため
 * ── Workspace を1つも開いていない画面（WorkspaceWelcome）も、閉じる前の確認も、
 * Theme の外側には無い。
 *
 * ## Command と Keybinding は、両端に分かれる（Session 4-7A）
 *
 * 打鍵の基盤は2つの器に分かれていて、**間に他の Provider を挟むのが正しい。**
 *
 *   CommandProvider … 上の方（Language の内側）。中身はただの表で何にも依存せず、
 *                     **command を登録する側より外**である必要がある
 *                     （EditorProvider も WorkspaceShell も登録する）
 *   KeybindingProvider … 一番内側。打鍵の瞬間に Workspace と Editor の状態を読む
 *                     （keybindings/when.ts の `workspaceOpen` / `editorHasActiveTab`）
 *
 * 逆にすると成り立たない ── 打鍵の側を外に置けば状態が読めず、
 * command の表を内に置けば登録する側から見えなくなる。
 */
function App(): JSX.Element {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <CommandProvider>
          <UnsavedChangesProvider>
            <WorkspaceFolderProvider>
              <EditorProvider>
                <TerminalProvider>
                  {/* 表示方式の選択は他の4つに依存しない。一番内側で足りる。 */}
                  <FilesViewProvider>
                    {/*
                      Language Server を使うかどうか（Session 5-4）。
                      Files の表示方式と同じく他に依存しないので内側で足りる。

                      **Editor より外に置く必要は無い。** この値が効くのは
                      Settings 画面の表示だけで、実際にサーバを立てる / 終わらせるのは
                      Main が自分で読んだ同じ設定になる（lsp/LspSettingsProvider.tsx）。
                    */}
                    <LspSettingsProvider>
                      {/*
                        Breakpoint（Session 6-3）。**Editor より外**に置く必要がある
                        ── 印は Editor パネルより長く生き、パネルを閉じても
                        別の場所へ運んでも消えない（debug/context.ts）。

                        Workspace には依存する（相対位置は Workspace が変われば
                        別のファイルを指す）ので、WorkspaceFolderProvider の内側になる。
                      */}
                      <DebugProvider>
                        <BreakpointProvider>
                          <CallStackProvider>
                            {/*
                              止まったら、その位置を Editor で開く（Session 6-13）。Debug パネルを
                              閉じていても働くよう、パネルではなくここに1つだけ置く。
                            */}
                            <ExecutionLocationFollower />
                            <KeybindingProvider>
                              <WorkspaceShell />
                            </KeybindingProvider>
                          </CallStackProvider>
                        </BreakpointProvider>
                      </DebugProvider>
                    </LspSettingsProvider>
                  </FilesViewProvider>
                </TerminalProvider>
              </EditorProvider>
            </WorkspaceFolderProvider>
          </UnsavedChangesProvider>
        </CommandProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

export default App
