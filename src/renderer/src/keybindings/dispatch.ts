import type { CommandId } from '../commands/commandIds'
import { chordToken, type KeyChord } from './chord'
import type { ResolvedKeybinding } from './resolve'
import { matchesWhen, type WhenContext } from './when'

/**
 * 打鍵から command を選ぶ（Session 4-7A）。
 *
 * React にも DOM にも依存しない純粋な関数。**状態を集めるのも、
 * `preventDefault()` を呼ぶのも、ここではない**（KeybindingProvider.tsx）。
 * この分け方のおかげで、focus の切り替えや確認ダイアログの裏での振る舞いを
 * DOM 無しで試せる。
 *
 * ## 確認ダイアログが出ている間は、原則として何も走らない
 *
 * `modalOpen` は他の条件と扱いが違い、**rule ごとではなく全体に掛かる**。
 *
 * 失われるものがある操作の確認（`unsaved/UnsavedChangesDialog.tsx`・
 * ファイルの削除・Git の破棄 …）が出ている間、その裏でショートカットが
 * 走ると「何を訊かれているのか」と「今アプリが何をしたか」が食い違う。
 * 条件を書き忘れた rule が裏で走る形にしないため、既定を「走らない」にしてある。
 *
 * 裏でも走ってよい command は `when` に `'modalOpen'` を**明示的に**書く。
 * Session 4-7A では1つも無い。
 *
 * これは移設前の `ctrl+s` からの唯一の振る舞いの変化にあたる ── 以前は
 * 確認ダイアログの裏でも保存が走っていた。
 */

/**
 * その打鍵で実行すべき command。無ければ null。
 *
 * 同じ打鍵に複数の rule が当たる場合は**後ろにあるものが勝つ**
 * （`resolveKeybindings` が優先順のまま並べているため。User が Default を
 * 上書きするのは、この規則と「後ろに連結する」ことの組み合わせで出る）。
 */
export function dispatchKeybinding(
  chord: KeyChord,
  context: WhenContext,
  entries: readonly ResolvedKeybinding[]
): CommandId | null {
  const token = chordToken(chord)
  let found: CommandId | null = null

  for (const entry of entries) {
    if (entry.token !== token) {
      continue
    }

    // 確認ダイアログの裏では、明示的に許した rule だけを通す（このファイルの冒頭）。
    if (context.modalOpen && !entry.when.includes('modalOpen')) {
      continue
    }

    if (!matchesWhen(entry.when, context)) {
      continue
    }

    found = entry.commandId
  }

  return found
}
