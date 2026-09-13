import type { JSX } from 'react'
import { useI18n } from '../i18n/context'
import { debugStatusDetailKey, debugStatusKey } from './debugStatusLabels'
import { useDebugSessionStatus } from './useDebugSessionStatus'

/**
 * ステータスバーに出す Debug の状態（Session 6-9）。
 *
 * lsp/LanguageServerStatusItem.tsx と同じ置き方にしてある。
 *
 * ## 押せない
 *
 * ボタンにしていない。ここからセッションを始める / 止めることはできない ──
 * ステータスバーは状態を出す場所で、操作の入口は Debug パネル（とこの先の
 * キー割り当て）になる。
 *
 * ## まとめる関数が無い
 *
 * LSP はサーバ3本を1語へ畳む必要があったが、Debug Session は**同時に1本だけ**
 * （docs/ARCHITECTURE.md §20.11）なので、届いた1語をそのまま出せば足りる。
 *
 * ## 出るものに、パスは1つも無い
 *
 * 出せるのは6つの状態の言い回しと、その1行の説明だけ。adapter の名前も、
 * 起動できなかった理由も届いていない（shared/debug/status.ts）。
 */
export function DebugStatusItem(): JSX.Element {
  const { t } = useI18n()
  const status = useDebugSessionStatus()

  return (
    <span
      className="fx-statusbar__item fx-statusbar__debug"
      data-testid="statusbar-debug"
      data-debug-status={status ?? undefined}
      title={status === null ? undefined : t(debugStatusDetailKey(status))}
    >
      {status === null ? '' : t(debugStatusKey(status))}
    </span>
  )
}
