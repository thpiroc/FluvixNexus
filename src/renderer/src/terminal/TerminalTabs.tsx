import type { JSX } from 'react'
import { TERMINAL_DEFAULT_SHELL_ID, type TerminalShellChoice } from '@shared/terminal'
import { DropdownMenu, type DropdownMenuItem } from '../ui/DropdownMenu'
import type { TerminalDisplaySettings } from './terminalSettings'
import { TerminalSettingsMenu } from './TerminalSettingsMenu'
import type { TerminalTab, TerminalStatus } from './terminalTabsModel'

/**
 * Terminal のタブ列（Session 3-7-2）。
 *
 * Workspace Shell の PanelGroup が持つタブ（どのパネルを手前に出すか）とも、
 * Editor のタブ列（開いているファイル）とも別物で、こちらは**Terminal パネルの
 * 中身**が持つタブ。見た目を揃えつつクラス名を分けているのは Editor と同じ理由で、
 * パネルを Dock で動かしてもこのタブ列は Terminal に付いて回る、という関係を
 * 混同しないため。
 *
 * ## 開く入口は2つに分ける
 *
 * ```
 * +   … 既定のシェルをそのまま1枚開く（押すだけで開く）
 * ⌄   … 何を開くかを選ぶ（Node / Claude Code）
 * ⚙   … 表示設定（文字の大きさ・さかのぼれる行数。Session 3-7-5）
 * ```
 *
 * `+` を押すと必ずメニューが出る形にしない ── 開くターミナルのほとんどは
 * 既定のシェルで、そのたびに1項目のメニューを挟むのは手数が1つ増えるだけになる。
 * かといって `+` だけにすると選べる場所が無い。VS Code と同じ分け方にあたる。
 *
 * ## 起動できないシェルは並べない
 *
 * Node も Claude Code も入っていない PC はふつうにある。**押せない項目を
 * 並べて無効にするのではなく、出さない**（files/FileContextMenu.tsx と同じ線）
 * ── 灰色で並んでいると、条件次第で選べるように見える。
 * 何が入っているかを調べるのは Main（main/terminal/shellCommand.ts）で、
 * ここはその答えを並べるだけになる。
 *
 * ## タブの状態は文字で出す
 *
 * Editor は未保存の印を色付きの丸で出しているが（名前が省略されても消えない
 * 位置に置くため）、こちらは名前の後ろに短い文字で足す。印で表したいものが
 * 「未保存かどうか」の1つではなく、**起動中 / 終了（コード付き）/ 失敗**と
 * 中身のある区別だからで、色の丸3つでは何がどれか分からない。
 *
 * ## 別のフォルダで動いているタブを黙って並べない（Session 3-7-3）
 *
 * Workspace を切り替えても、動いているターミナルはそのまま残る
 * （useTerminalTabs.ts）。シェルの作業ディレクトリは起動時に決まるので、
 * そのタブは**今 Files に見えているフォルダとは別の場所**に居ることになる。
 *
 * 見た目が同じままだと、そこで `npm run build` と打った結果が
 * 「どちらのプロジェクトのものか」分からない。名前の前に印を1つ足して、
 * 全体は `title` で読めるようにしてある。**どのフォルダかまでは出さない**
 * ── Renderer はパスも表示名も持っていない（shared/terminal/session.ts）。
 */

interface TerminalTabsProps {
  readonly tabs: readonly TerminalTab[]
  readonly activeTabId: string | null
  /** 今開いている Workspace。タブの起動元と食い違う場合に印を出す。 */
  readonly workspaceId: string | null
  readonly shells: readonly TerminalShellChoice[]
  readonly canOpen: boolean
  readonly onActivate: (terminalId: string) => void
  readonly onClose: (terminalId: string) => void
  /**
   * 閉じてよいかを確かめている最中のタブ（Session 3-7-4）。
   *
   * 実行中かどうかは Main に聞く（useTerminalCloseGuard.ts）ため、
   * × を押してから閉じるまでに一往復ぶんの間が空く。その間は押しても
   * 何も起きないので、**押せないことが見えている**方にする
   * （`+` を上限で止めるのと同じ考え方）。
   */
  readonly closingTabId: string | null
  readonly onOpen: (shellId: TerminalShellChoice['id']) => void
  /** メニューを開いた（選択肢を取り直すきっかけ）。 */
  readonly onShellMenuOpen: () => void
  /**
   * 端末の見え方（Session 3-7-5）。
   *
   * 設定の正本はパネルの外（TerminalProvider）にある ── パネルは動かせるので、
   * ここに持つと置き場所を変えただけで文字の大きさが戻る。
   */
  readonly display: TerminalDisplaySettings
  readonly onFontSizeChange: (fontSize: number) => void
  readonly onScrollbackChange: (scrollback: number) => void
}

export function TerminalTabs({
  tabs,
  activeTabId,
  workspaceId,
  shells,
  canOpen,
  onActivate,
  onClose,
  closingTabId,
  onOpen,
  onShellMenuOpen,
  display,
  onFontSizeChange,
  onScrollbackChange
}: TerminalTabsProps): JSX.Element {
  const available = shells.filter((shell) => shell.available)

  const shellItems: readonly DropdownMenuItem[] = available.map((shell) => ({
    key: shell.id,
    label: shell.name,
    onSelect: () => onOpen(shell.id)
  }))

  return (
    <div className="fx-terminal__bar">
      <div className="fx-terminal-tabs" role="tablist" aria-label="開いているターミナル">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const name = tab.shellName ?? 'ターミナル'
          const note = describeStatus(tab.status, tab.exitCode)
          /*
            起動したフォルダが、今開いているフォルダと違う。
            Workspace が未選択のときは出さない ── 比べる相手が無い状態で
            「別のフォルダ」と言っても、どちらのことか分からない。
          */
          const foreign =
            workspaceId !== null && tab.workspaceId !== null && tab.workspaceId !== workspaceId

          return (
            <div
              key={tab.id}
              className="fx-terminal-tab"
              role="tab"
              aria-selected={active}
              data-active={active}
              data-status={tab.status}
              data-foreign={foreign}
              data-terminal-id={tab.id}
              title={describeTabTitle(name, note, foreign)}
            >
              <button
                type="button"
                className="fx-terminal-tab__label"
                onClick={() => onActivate(tab.id)}
              >
                {foreign && (
                  <span className="fx-terminal-tab__origin" aria-hidden="true">
                    ⌂
                  </span>
                )}
                {name}
                {note !== null && <span className="fx-terminal-tab__note">{note}</span>}
              </button>

              <button
                type="button"
                className="fx-terminal-tab__close"
                aria-label={`${name} を閉じる`}
                disabled={tab.id === closingTabId}
                onClick={() => onClose(tab.id)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {/*
        上限に達したら押せなくする。断るのは Main の側だが（UI は迂回されうる）、
        押せてしまって失敗だけが返るより、押せないことが見えている方が早い。
      */}
      <button
        type="button"
        className="fx-terminal-tabs__button"
        aria-label="新しいターミナル"
        title="新しいターミナル"
        disabled={!canOpen}
        onClick={() => onOpen(TERMINAL_DEFAULT_SHELL_ID)}
      >
        ＋
      </button>

      {/*
        選択肢が既定の1つしか無いなら、選ぶ入口を出さない
        （出しても、押した先に `+` と同じ項目が1つ並ぶだけになる）。
      */}
      {available.length > 1 && canOpen && (
        <DropdownMenu
          label="⌄"
          buttonLabel="開くシェルを選ぶ"
          buttonClassName="fx-terminal-tabs__button"
          items={shellItems}
          onOpen={onShellMenuOpen}
        />
      )}

      {/*
        表示設定（Session 3-7-5）。タブが1枚も無くても出しておく ── 文字の大きさは
        これから開くターミナルにも効くもので、開いてからでないと変えられない
        理由が無い。
      */}
      <TerminalSettingsMenu
        display={display}
        onFontSizeChange={onFontSizeChange}
        onScrollbackChange={onScrollbackChange}
      />
    </div>
  )
}

/**
 * タブに載せきれないことを `title` で読めるようにする。
 *
 * 印（⌂）だけでは何のことか分からないので、言葉はここで足す。
 * どのフォルダかまでは書けない ── Renderer はパスを持っていない。
 */
function describeTabTitle(name: string, note: string | null, foreign: boolean): string {
  const notes = [note, foreign ? '別のフォルダで起動' : null].filter(
    (item): item is string => item !== null
  )

  return notes.length === 0 ? name : `${name}（${notes.join('・')}）`
}

/**
 * タブに添える短い文言。
 *
 * `running` に何も添えないのは、それが**普通の状態**だから。
 * 普通であることを毎回書くと、書いてある方が目に入らなくなる。
 */
function describeStatus(status: TerminalStatus, exitCode: number | null): string | null {
  switch (status) {
    case 'idle':
    case 'running':
      return null

    case 'starting':
      return '起動中'

    case 'exited':
      return exitCode === null ? '終了' : `終了 ${exitCode}`

    case 'failed':
      return '失敗'
  }
}
