import { lazy, Suspense, type JSX } from 'react'
import { useTerminal } from './context'
import { TerminalCloseConfirm } from './TerminalCloseConfirm'
import { TerminalTabs } from './TerminalTabs'
import { useTerminalCloseGuard } from './useTerminalCloseGuard'
import './terminal.css'

/**
 * xterm はここから**遅延して読み込む**（このファイルの唯一の値としての依存）。
 * 理由は TerminalSurface.tsx の冒頭。
 */
const TerminalSurface = lazy(async () => {
  const module = await import('./TerminalSurface')

  return { default: module.TerminalSurface }
})

/**
 * Terminal パネルの中身。
 *
 * ここが決めるのは**何を出す状態か**だけで、端末を描くのは xterm
 * （TerminalSurface.tsx）、並びを描くのは TerminalTabs.tsx。
 * FilesPanel と files/、EditorPanel と editor/ の分担と同じ形にしてある。
 *
 * | 手前のタブの状態      | 出すもの                                   |
 * | --------------------- | ------------------------------------------ |
 * | `idle` / `starting`   | 画面（起動中も器は出しておく）             |
 * | `running`             | 画面                                       |
 * | `exited`              | 画面と、終了コード＋立て直す入口           |
 * | `failed`              | 画面と、理由＋もう一度試す入口             |
 * | タブが1枚も無い       | 開く入口だけ                               |
 *
 * ## 終わっても画面を消さない
 *
 * `exit` と打った後もそれまでの出力は残す。最後に出たエラーを読むのは
 * まさに終わった後で、消してしまうと**読むために立て直す**ことになる。
 * ファイルツリーが失敗を1行として扱う（ARCHITECTURE.md §9.7）のと同じで、
 * 「終わったのに何も無い」を作らない。
 *
 * **失敗したときも器は出したまま**にしてある（Session 3-7-1 では案内だけに
 * 差し替えていた）。理由は2つ。立て直すには大きさが要るが、器が無いと測れない。
 * そして複数タブでは、失敗したタブのために**パネル全体が案内に変わってしまう**
 * ── 隣で動いているタブがあるのに、切り替えるまでそれが見えなくなる。
 *
 * ## 立て直しは利用者が選ぶ
 *
 * 終了を検知して自動で立て直さない。`exit` と打つのは終わらせる意思表示で、
 * 勝手に戻ってくるとその意思が通らない（`Ctrl+C` を押しても止まらない
 * プロセスと同じ苛立ちになる）。
 *
 * ## 閉じる前の確認はここに置く（Session 3-7-4）
 *
 * タブ1枚ぶんの確認（useTerminalCloseGuard.ts）は、Editor が
 * EditorWorkArea.tsx で TabCloseConfirm を出しているのと同じ形で、
 * **タブ列と同じ場所**に置く。器の外（App.tsx）へ出さないのは、
 * 答える単位がこのパネルの中のタブ1枚だからで、
 * アプリの終了のように**パネルの外から起きる**操作は
 * 共通の器（unsaved/）が受け持つ。
 */
export function TerminalView(): JSX.Element {
  const controller = useTerminal()

  const {
    tabs,
    activeTabId,
    workspaceId,
    shells,
    canOpen,
    screens,
    display,
    setFontSize,
    setScrollback,
    openTab,
    activateTab,
    refreshShells,
    restart
  } = controller

  const closeGuard = useTerminalCloseGuard(controller)

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null

  /*
    立て直すには大きさが要る。器はまだ生きているので、そこから測り直したものを
    使う（測れなければ、器が測れるようになった時点で ensureStarted が拾う）。
  */
  const restartActive = (): void => {
    if (activeTab === null) {
      return
    }

    const size = screens.peek(activeTab.id)?.fit() ?? null

    if (size !== null) {
      restart(activeTab.id, size)
    }
  }

  return (
    <div className="fx-terminal">
      <TerminalTabs
        tabs={tabs}
        activeTabId={activeTabId}
        workspaceId={workspaceId}
        shells={shells}
        canOpen={canOpen}
        onActivate={activateTab}
        onClose={closeGuard.requestClose}
        closingTabId={closeGuard.checkingTabId}
        onOpen={openTab}
        onShellMenuOpen={refreshShells}
        display={display}
        onFontSizeChange={setFontSize}
        onScrollbackChange={setScrollback}
      />

      {activeTab !== null && (activeTab.status === 'exited' || activeTab.status === 'failed') && (
        <div className="fx-terminal__notice">
          <span className="fx-terminal__message">
            {activeTab.status === 'failed'
              ? activeTab.error
              : `終了しました（コード ${activeTab.exitCode}）`}
          </span>
          <button className="fx-terminal__action" type="button" onClick={restartActive}>
            {activeTab.status === 'failed' ? 'もう一度試す' : '新しいターミナル'}
          </button>
        </div>
      )}

      {activeTab === null ? (
        /*
          最後の1枚を閉じた状態。パネルを空のままにせず、次の一手だけを出す
          （`+` はタブ列に残っているので、案内は文だけでよい）。
        */
        <div className="fx-terminal__empty">
          <p className="fx-terminal__message">
            ターミナルは開かれていません。＋ から新しく開けます。
          </p>
        </div>
      ) : (
        <Suspense fallback={<p className="fx-terminal__message">ターミナルを準備しています…</p>}>
          {/*
            器は1つで、中身を手前のタブに合わせて付け替える。`key` を渡さないのは
            **器そのものを作り直させないため**（作り直すと ResizeObserver が
            張り直され、切り替えのたびに測り直しが1往復増える）。
            付け替えは TerminalSurface の effect が terminalId を見て行う。
          */}
          <TerminalSurface terminalId={activeTab.id} />
        </Suspense>
      )}

      {/*
        実行中のタブを閉じようとしている（useTerminalCloseGuard.ts）。
        聞いている最中は器を出さない ── 0.4 秒ほどのことに待ちの画面を挟むと、
        閉じるたびに一瞬ちらつく。押せないことはタブの × 側に出してある。
      */}
      {closeGuard.target !== null && (
        <TerminalCloseConfirm
          tab={closeGuard.target}
          onConfirm={closeGuard.confirm}
          onCancel={closeGuard.cancel}
        />
      )}
    </div>
  )
}
