import type { JSX } from 'react'
import { useI18n } from '../../i18n/context'
import { TerminalView } from '../../terminal/TerminalView'
import { useWorkspaceFolder } from '../../workspaceFolder/context'
import '../../terminal/terminal.css'

/**
 * Terminal パネル。
 *
 * 中身は terminal/ が持つ。ここが決めるのは**何を出す状態か**の3つだけ
 * （FilesPanel / EditorPanel と同じ分担）。
 *
 *   取得中   … 何も出さない（未選択と区別が付かず、案内が一瞬見える）
 *   未選択   … 開く入口だけを出す
 *   開いている … ターミナル（terminal/TerminalView.tsx）
 *
 * ## Workspace が無ければ開かない
 *
 * ホームフォルダなどで代わりに開くことはしない。DESIGN.md §3 のとおり
 * 4つのパネルは「今開いているフォルダ」を共通の対象にしていて、
 * Terminal だけがそこから外れると、**Files に見えているものと違う場所で
 * コマンドが走る**ことになる。Main 側も同じ理由で断る
 * （main/terminal/terminalSessions.ts）。
 *
 * 未選択のときに出すのは Welcome（EditorPanel）ではなく、Files と同じ
 * 短い案内にしてある。Welcome は「まず何をすればよいか」を1画面で伝えるもので、
 * **同時に2枚出ると、どちらを読めばよいか分からなくなる**（既定のレイアウトでは
 * Editor と Terminal が同時に見えている）。
 *
 * ## `key` に Workspace の id を渡していない
 *
 * FilesPanel はそうしている（§9.6）が、セッションと画面の正本は Shell の外側
 * （TerminalProvider）にある。ここを作り直してもシェルは切れないし、
 * Workspace が変わったときの破棄は useTerminalTabs.ts が行う
 * （EditorPanel と同じ理由）。
 *
 * 複数タブと、開くシェルの選択（PowerShell / Node / Claude Code）は
 * Session 3-7-2 で terminal/TerminalTabs.tsx に載った。ここは変わっていない
 * ── タブは「パネルの中身」であって、パネルの出し分けの話ではないため。
 */
export function TerminalPanel(): JSX.Element {
  const { status, workspace, busy, openFolder } = useWorkspaceFolder()
  const { t } = useI18n()

  if (status === 'loading') {
    return <div className="fx-terminal" />
  }

  if (workspace === null) {
    return (
      <div className="fx-terminal fx-terminal--notice">
        <p className="fx-terminal__message">{t('workspace.noWorkspaceOpen')}</p>
        <button type="button" className="fx-terminal__action" onClick={openFolder} disabled={busy}>
          {t('workspace.openFolder')}
        </button>
      </div>
    )
  }

  return <TerminalView />
}
