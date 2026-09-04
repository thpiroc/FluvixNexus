import { useEffect, useMemo, type JSX, type ReactNode } from 'react'
import { useI18n } from '../i18n/context'
import { useUnsavedChanges } from '../unsaved/context'
import type { LossItem, LossSource } from '../unsaved/types'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { TerminalContext } from './context'
import { useTerminalTabs } from './useTerminalTabs'

/**
 * 開いているターミナル（複数タブ）を保持し、Renderer 全体へ配る。
 *
 * 状態と IPC は useTerminalTabs.ts が、画面は terminalScreenStore.ts が持ち、
 * ここは Workspace の id を渡して Context に載せることと、
 * **実行中のものがあることを申告すること**（Session 3-7-4）を受け持つ
 * （EditorProvider と同じ形）。
 *
 * 置き場所は WorkspaceFolderProvider の内側・Workspace Shell の外側（App.tsx）。
 *
 *   内側に置けない … どの Workspace で立てるシェルか判断できない
 *   Shell の中に置けない … パネルを動かすたびにセッションと画面が消える
 *
 * ## 申告するのは、アプリを終了するときだけ
 *
 * Editor は Workspace を閉じる / 切り替える / 終了する のどれでも未保存を申告する。
 * **Terminal は終了のときだけ**にあたる ── Session 3-7-3 で、Workspace が
 * 変わってもセッションを終わらせないことにしたため、切り替えでも Workspace を
 * 閉じても失われるものが無い（docs/ARCHITECTURE.md §13.8）。
 * 失われない操作で確認を出すと、「確認は出るが何も起きない」という形になり、
 * 次に本当に失われるときの確認まで読み飛ばされる。
 *
 * ## 保存にあたるものが無い
 *
 * `saveAll` は何もせず true を返す。ここで false を返すと「保存できなかった」
 * として扱われ、**保存できるファイルまで巻き添えで進めなくなる**
 * （unsaved/types.ts）。実行中のプロセスに対して利用者が選べるのは
 * 「終了する」か「やめる」の2つで、その2つは確認の側が持っている。
 */
export function TerminalProvider({ children }: { children: ReactNode }): JSX.Element {
  const { workspace } = useWorkspaceFolder()
  const controller = useTerminalTabs(workspace?.id ?? null)
  const { t } = useI18n()
  const { registerSource } = useUnsavedChanges()

  const { tabs, listBusyTabs } = controller

  const source = useMemo<LossSource>(
    () => ({
      listLosses: async (action): Promise<readonly LossItem[]> => {
        // 終了以外では何も失われない（このファイルの冒頭）。OS へも聞かない。
        if (action !== 'close-window') {
          return []
        }

        const busy = await listBusyTabs()

        return busy.map((tab) => ({
          id: tab.id,
          kind: 'running-terminal',
          name: tab.shellName ?? t('terminal.tabs.fallbackName'),
          /*
            どのタブのことかを、利用者が見ている並びで言う。同じ名前のタブが
            並ぶことがあり（PowerShell を2本開いた場合）、名前だけでは
            どれのことか分からない。中で何が動いているかは持っていない
            （main/terminal/childProcesses.ts ── 名前は持ち帰らない）。
          */
          detail: t('terminal.unsaved.tabDetail', {
            index: tabs.findIndex((candidate) => candidate.id === tab.id) + 1
          }),
          // 保存にあたるものが無い（このファイルの冒頭）。
          unsavable: true
        }))
      },
      saveAll: async (): Promise<boolean> => true
    }),
    [tabs, listBusyTabs, t]
  )

  useEffect(() => registerSource(source), [registerSource, source])

  return <TerminalContext.Provider value={controller}>{children}</TerminalContext.Provider>
}
