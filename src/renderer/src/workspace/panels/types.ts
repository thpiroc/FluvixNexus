import type { JSX } from 'react'

/**
 * パネルの契約。
 *
 * Workspace Shell（配置・タブ・サイズ）と Panel（中身）の責務を分けるための境界であり、
 * この型に現れない情報はパネル側に渡さない。
 * パネルが「自分がどの領域に置かれているか」を知ると、Dock で自由に動かせなくなるため。
 */

/**
 * パネルの識別子。
 *
 * レイアウトの保存・復元でそのまま永続化されるため、一度決めた値は変更しない。
 * 追加するときは、この union と registry.ts の両方に足す（片方だけだと型エラーになる）。
 * 予定しているもの: github / debug / search / problems など（DESIGN.md §3）。
 */
export type PanelId = 'files' | 'editor' | 'terminal' | 'git' | 'debug' | 'agent'

/**
 * パネルの識別色（DESIGN.md §3）。
 *
 * 「自由に配置を変えても、どのパネルかが直感的に分かる」ための薄い色付け。
 * 実際の色は styles/theme.css が持ち、ここでは役割名だけを扱う。
 */
export type PanelAccent = 'neutral' | 'blue' | 'green' | 'orange'

/**
 * パネル本体のコンポーネント。
 *
 * props を取らないのは意図的。配置・可視状態・サイズは Shell 側の情報であり、
 * パネルが必要とするデータ（開いているファイル、Terminal のセッションなど）は
 * 後続セッションでドメインごとの Context / hooks 経由で受け取る。
 */
export type PanelComponent = () => JSX.Element

/** Panel Registry に登録される1パネル分の定義。 */
export interface PanelDefinition {
  readonly id: PanelId
  /** タブや見出しに出す表示名。 */
  readonly title: string
  readonly accent: PanelAccent
  readonly Component: PanelComponent
}
