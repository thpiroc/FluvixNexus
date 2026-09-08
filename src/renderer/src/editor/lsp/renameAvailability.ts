import type { LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'
import { isLanguageServerReadyFor } from './serverAvailability'

/**
 * その文書で LSP の Rename を使うか（Session 5-9 / 5-10）。
 *
 * 判断の中身は補完 / Hover / 定義 / 参照とまったく同じで、
 * **その言語のサーバが ready** の1つだけを見る（serverAvailability.ts）。
 * OFF・未インストール・起動中・失敗・停止のどれでも false になる。
 *
 * false のときの落とし先は言語で変わる。
 *
 * ```
 * TypeScript / JavaScript … Monaco 内蔵の Rename（TypeScript worker）
 * Python                  … 無い。Rename そのものが出ない
 * ```
 *
 * 後者に内蔵の Rename を当てないのは、`.py` を TypeScript として
 * 解析した結果でコードが書き換わるためにほかならない
 * （renderer/src/editor/monaco/lspRename.ts）。
 */
export function shouldUseLspRename(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  return isLanguageServerReadyFor(languageId, statuses)
}
