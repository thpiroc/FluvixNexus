import type { LanguageServerId, LanguageServerStatus } from '@shared/lsp'
import type { EditorLanguageId } from '../monaco/language'

/**
 * その文書で LSP を使えるか（Session 5-10 / 5-11）。
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
 * csharp                  … csharp サーバ（csharp-ls。Session 5-11）
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
 * そこは両方の表が `typescript` / `python` / `csharp` を返すことで揃っている。
 *
 * ## C# が載った（Session 5-11）
 *
 * `.cs` / `.csx` は Main の表では前から `csharp` サーバへ向いていた
 * （main/lsp/documentLanguage.ts）が、この表に無い間は Renderer 側の
 * provider がそもそも LSP を呼ばなかった。ここへ1行足したことで、
 * `.cs` を開くと他の2言語とまったく同じ経路を通る
 * ── **C# のためだけの分岐は、この下にも provider にも1つも無い。**
 */

/** Monaco の言語 id から、担当する Language Server へ。 */
const SERVER_BY_EDITOR_LANGUAGE: Readonly<Record<string, LanguageServerId>> = {
  typescript: 'typescript',
  javascript: 'typescript',
  python: 'python',
  csharp: 'csharp'
}

/**
 * Monaco の provider を登録する言語の一覧（上の表の見出しそのもの）。
 *
 * Session 5-10 までは、5つの provider が
 * `'typescript'` / `'javascript'` / `'python'` を**それぞれ書き並べていた**。
 * 上の表に「言語を増やすときに触るのはこの表だけ」と書いてありながら、
 * 実際には登録の並びが5箇所に散っていて、C# を足すには5箇所を直す必要があった。
 *
 * 一覧をここから配ることで、その言い分が実際にそうなる
 * ── 表に行を足せば、5つの provider が同時にその言語へ付く。
 *
 * 整形だけはこの一覧を使わない。担当サーバが整形を出さない言語があるためで、
 * 判断は formattingAvailability.ts が別に持つ。
 */
export const LSP_EDITOR_LANGUAGE_IDS: readonly string[] = Object.keys(SERVER_BY_EDITOR_LANGUAGE)

/**
 * Monaco が内蔵の TypeScript サービス（worker）で答えられる言語か。
 *
 * LSP が使えないときの落とし先を決めるのに要る。**Python にも C# にもこれは無い**
 * ── Monaco は `.py` / `.cs` の色を付けるだけで、補完も定義も持たない
 * （renderer/src/editor/monaco/monacoSetup.ts の worker の表）。
 *
 * したがって Python / C# で LSP が使えないときの答えは「何も無い」になる。
 * 無い fallback を作らないのが Session 5-10 の決めごとで、Session 5-11 でも
 * 変えていない ── 内蔵の TypeScript worker へ `.py` / `.cs` を渡すことは
 * 決してしない。渡せば C# の綴りを TypeScript として解析した答えが返る。
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
