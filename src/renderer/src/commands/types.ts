import type { TranslationKey } from '../i18n/messages'
import type { CommandId } from './commandIds'

/**
 * Command の静的な定義（Session 4-7A）。
 *
 * **handler を持たない**のが要点。`CommandDescriptor` は「そういう操作がある」
 * ことだけを述べ、実際に何が起きるかは所有者が実行時に登録する
 * （commands/useCommand.ts）。分けてある理由は構造上の必然にあたる ──
 * Git の操作は `useGitRepository()` が持ち、それが生きているのは Git パネルが
 * 開いている間だけで、**静的な表に handler を書くことがそもそもできない。**
 *
 * この形にしておくと、
 *
 *   - 一覧（将来の Settings / Command Palette）は所有者の生死に関係なく作れる
 *   - 所有者が居ない command は「今は実行できない」として自然に落ちる
 *   - descriptor は React にも DOM にも依存しない（テストが素で書ける）
 *
 * となる。VS Code の `contributes.commands` と `CommandRegistry` の分担と同じ。
 */

/**
 * command の所属。
 *
 * `CommandId` の先頭の語と対応させてある（`view.togglePanel.files` → `'view'`）。
 * registry.test.ts がその対応を実数で確かめるので、片方だけ足すと落ちる。
 *
 * Session 4-7B で `'git'` / `'files'` / `'terminal'` が増える。
 */
export type CommandCategory = 'workspace' | 'editor' | 'view' | 'settings'

/** command が実行されたときに走るもの。引数も戻り値も持たない。 */
export type CommandHandler = () => void

export interface CommandDescriptor {
  readonly id: CommandId
  readonly category: CommandCategory
  /**
   * 開発上の識別名（英語・固定）。
   *
   * **画面に出すための文字列ではない。** ログ・テスト・`titleKey` が入るまでの
   * 仮の表示に使う。
   */
  readonly title: string
  /**
   * 画面に出す名前（Session 4-7B で入る）。
   *
   * **Session 4-7A では、どの command もこれを持たない。** 翻訳キーを足すには
   * `i18n/locales/en.ts` / `ja.ts` を変えることになり、Session 4-5C（Git の
   * Localization）が並行して同じ2ファイルを触っているため、今回は接続だけを
   * 用意して値は入れない。
   *
   * 任意にしてあるので、4-7B で足すのは**この表に1行ずつ `titleKey` を書く**だけ
   * ── 型も `commandTitle()` も変わらない。
   */
  readonly titleKey?: TranslationKey
}

/**
 * 画面に出す名前を決める。
 *
 * `titleKey` があれば翻訳、無ければ `title`（英語の識別名）。
 * Session 4-7A では常に後者になる。**呼び出し側がこの分岐を書かない**ように
 * 1箇所へ寄せてあり、4-7B で `titleKey` が埋まれば、ここを通る全ての表示が
 * 同時に翻訳へ切り替わる。
 */
export function commandTitle(
  descriptor: CommandDescriptor,
  t: (key: TranslationKey) => string
): string {
  return descriptor.titleKey === undefined ? descriptor.title : t(descriptor.titleKey)
}
