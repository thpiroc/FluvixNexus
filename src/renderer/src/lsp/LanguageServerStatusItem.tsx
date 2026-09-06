import { useMemo, type JSX } from 'react'
import { summarizeLanguageServerStatuses } from '@shared/lsp'
import { useI18n } from '../i18n/context'
import {
  languageServerNameKey,
  languageServerStatusKey,
  languageServerSummaryKey
} from './languageServerLabels'
import { useLanguageServerStatus } from './useLanguageServerStatus'

/**
 * ステータスバーに出す Language Server の状態（Session 5-4）。
 *
 * ## 1つにまとめて出す
 *
 * 3本ぶんを並べない。ステータスバーは**今の状況が一目で分かる場所**で、
 * 常に3つ置くと、そのうち2つは「使っていない言語」の話になる
 * （Git のブランチ名の隣に、開いていないリポジトリの状態を並べないのと同じ）。
 *
 * まとめ方（1本でも答えていれば Ready）は shared/lsp/serverStatus.ts が持つ。
 * 内訳は `title`（マウスを載せたときの説明）で読める ── **見えている必要は
 * 無いが、確かめられる必要はある**という置き方にしてある。
 *
 * ## 押せない
 *
 * ボタンにしていない。ここから止める / 立て直すことはできず、
 * 使うかどうかを変えるのは Settings の1箇所だけに保つ ── ステータスバーは
 * 状態を出す場所であって、操作の入口ではない（Workspace のパスと同じ扱い）。
 *
 * ## 出るものに、パスは1つも無い
 *
 * 出せるのは表の行の名前（TypeScript / Python / C#）と、6つの状態の言い回しだけ。
 * 実行ファイルの場所も、なぜ立たなかったのかの詳細も届いていない
 * （shared/lsp/serverStatus.ts）。
 */
export function LanguageServerStatusItem(): JSX.Element {
  const { t } = useI18n()
  const servers = useLanguageServerStatus()

  const summary = useMemo(() => summarizeLanguageServerStatuses(servers), [servers])

  /*
    内訳（`TypeScript / JavaScript: Ready` の3行）。まとめた1語だけでは
    「どれが答えているのか」が分からないため、確かめる道をここに置く。
  */
  const detail = useMemo(
    () =>
      servers
        .map(
          (entry) =>
            `${t(languageServerNameKey(entry.serverId))}: ${t(languageServerStatusKey(entry.status))}`
        )
        .join('\n'),
    [servers, t]
  )

  return (
    <span
      className="fx-statusbar__item fx-statusbar__lsp"
      data-testid="statusbar-lsp"
      data-lsp-status={summary}
      title={detail === '' ? undefined : detail}
    >
      {t(languageServerSummaryKey(summary))}
    </span>
  )
}
