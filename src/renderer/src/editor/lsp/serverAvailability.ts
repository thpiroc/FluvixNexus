import type { LanguageServerId, LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'

/**
 * その文書で LSP を使えるか（Session 5-10）。
 *
 * ## Session 5-9 までは「TypeScript か」で足りていた
 *
 * 補完・Hover・定義 / 参照・整形・Rename の5つは、どれも
 * 「languageId が typescript / javascript」かつ「typescript サーバが ready」を
 * 見ていた。答えるサーバが1本しか無かったので、**言語とサーバの対応を
 * 書く必要が無かった**にほかならない。
 *
 * Python を足すと、その対応が要る。
 *
 * ```
 * typescript / javascript … typescript サーバ（1本で両方を見る）
 * python                  … python サーバ（Pyright）
 * ```
 *
 * 対応をここ1つに置いてあるので、言語を増やすときに触るのはこの表だけになる
 * ── Main 側で同じ役目を持つのは main/lsp/documentLanguage.ts で、
 * あちらは拡張子から、こちらは Monaco の言語 id から引く。
 *
 * ## 2つの表が別なのは、答えの集合が違うため
 *
 * Main の表は拡張子（`.tsx` → `typescriptreact`）を見て、LSP の `languageId` まで
 * 決める。ここが見るのは Monaco が付けた言語 id で、`.tsx` も `.ts` も同じ
 * `typescript` になる（renderer/src/editor/monaco/language.ts）。
 * **同じファイルについて行き先のサーバが食い違わない**ことだけが要点で、
 * そこは両方の表が `typescript` / `python` を返すことで揃っている。
 *
 * ## C# はまだ載せない
 *
 * `LANGUAGE_SERVER_IDS` には `csharp` があるが、この表には無い。
 * 載せると `.cs` を開いた時点で Monaco の provider が LSP を呼び始めるためで、
 * それは Session 5-11 の範囲になる。**表に無い言語は今までどおり
 * 内蔵の振る舞いへ落ちる。**
 */

/** Monaco の言語 id から、担当する Language Server へ。 */
const SERVER_BY_EDITOR_LANGUAGE: Readonly<Record<string, LanguageServerId>> = {
  typescript: 'typescript',
  javascript: 'typescript',
  python: 'python'
}

/**
 * Monaco が内蔵の TypeScript サービス（worker）で答えられる言語か。
 *
 * LSP が使えないときの落とし先を決めるのに要る。**Python にこれは無い**
 * ── Monaco は Python の色を付けるだけで、補完も定義も持たない
 * （renderer/src/editor/monaco/monacoSetup.ts の worker の表）。
 *
 * したがって Python で LSP が使えないときの答えは「何も無い」になる。
 * 無い fallback を作らないのが Session 5-10 の決めごとで、
 * 内蔵の TypeScript worker へ Python の文書を渡すことは決してしない
 * ── 渡せば .py を TypeScript として解析した答えが返る。
 */
export function isTypeScriptWorkerLanguage(
  languageId: EditorLanguageId | string
): languageId is 'typescript' | 'javascript' {
  return languageId === 'typescript' || languageId === 'javascript'
}

/** その言語を担当する Language Server。担当が無ければ null。 */
export function resolveLanguageServerIdFor(
  languageId: EditorLanguageId | string
): LanguageServerId | null {
  return SERVER_BY_EDITOR_LANGUAGE[languageId] ?? null
}

/**
 * その言語の Language Server が今答えられるか。
 *
 * OFF・未インストール・起動中・失敗・停止のどれでも false。
 * `ready` 以外を1つも通さないのは、**答えられない相手へ要求を出しても
 * 返ってくるのは `unavailable` だけ**であるため（main/lsp/documentRequest.ts）
 * ── その往復を待つぶん、内蔵へ落ちるのが遅れる。
 */
export function isLanguageServerReadyFor(
  languageId: EditorLanguageId | string,
  statuses: readonly LanguageServerStatus[]
): boolean {
  const serverId = resolveLanguageServerIdFor(languageId)

  if (serverId === null) {
    return false
  }

  return statuses.some((entry) => entry.serverId === serverId && entry.status === 'ready')
}
