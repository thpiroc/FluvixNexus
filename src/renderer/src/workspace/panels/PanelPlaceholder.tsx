import type { JSX } from 'react'

/**
 * 仮パネルの共通表示。
 *
 * Session 2-1 の目的は Workspace Shell が正しく描画・分割できることの確認であり、
 * 各パネルの中身は後続セッションで実装する。
 * 中身が空だと「描画されているのに見えない」状態と区別できないため、
 * どのパネルがどこに配置されているかが分かる最小限の表示だけを置く。
 */

interface PanelPlaceholderProps {
  /** このパネルが最終的に担う役割の要約。 */
  readonly summary: string
  /** 後続セッションで実装する内容。 */
  readonly upcoming: readonly string[]
}

export function PanelPlaceholder({ summary, upcoming }: PanelPlaceholderProps): JSX.Element {
  return (
    <div className="fx-placeholder">
      <p className="fx-placeholder__summary">{summary}</p>
      <p className="fx-placeholder__caption">後続セッションで実装</p>
      <ul className="fx-placeholder__list">
        {upcoming.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
