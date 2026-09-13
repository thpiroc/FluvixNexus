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
 * Session 4-7B で `'git'` / `'files'` が増えた（`'terminal'` はまだ ──
 * 端末の打鍵は `terminal/terminalDisplay.ts` が `event.key` で受けており、
 * registry へ移すには日本語配列の `=` / `_` の読み替えごと設計し直すことになる）。
 */
export type CommandCategory =
  'workspace' | 'editor' | 'view' | 'settings' | 'debug' | 'git' | 'files'

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
   * 画面に出す名前。
   *
   * **Session 4-7C で全件が持つようになった**（`commands/registry.ts`）。
   * 4-7A / 4-7B が見送っていたのは「読む相手がまだ居ない」ためで、
   * Settings の Keyboard Shortcuts 一覧ができたことでその理由は消えている。
   *
   * 予告どおり**全件を一度に**入れてある ── 一部だけ埋めると `commandTitle()` が
   * 「翻訳されるものとされないもの」の混ざった一覧を返し、その半端さを
   * 画面を作る側が引き継ぐ。key は `command.<CommandId>` に1対1で対応する。
   *
   * 型は任意のままにしてある。埋まっていることは型ではなく実数で確かめており
   * （commands/commandLocalization.test.ts）、必須にすると
   * `commandTitle()` の「無ければ `title`」という分岐が死んで、
   * 翻訳を持たない descriptor をテストで組み立てられなくなる。
   */
  readonly titleKey?: TranslationKey
}

/**
 * 画面に出す名前を決める。
 *
 * `titleKey` があれば翻訳、無ければ `title`（英語の識別名）。
 * **呼び出し側がこの分岐を書かない**ように1箇所へ寄せてあり、Session 4-7C で
 * `titleKey` が埋まった結果、ここを通る表示はすべて同時に翻訳へ切り替わった
 * （`keybindings/shortcutRows.ts` に渡す `title` がその唯一の経路になる）。
 */
export function commandTitle(
  descriptor: CommandDescriptor,
  t: (key: TranslationKey) => string
): string {
  return descriptor.titleKey === undefined ? descriptor.title : t(descriptor.titleKey)
}
