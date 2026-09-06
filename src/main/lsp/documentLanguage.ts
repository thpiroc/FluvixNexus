import type { LanguageServerId } from './languageServerCatalog'

/**
 * 開いた文書を、どのサーバへ、どの言語として渡すか（依存なし・テスト対象）。
 *
 * ## 「どのサーバへ送るか」を Renderer に言わせない、その実体がここにある
 *
 * Renderer が渡すのは相対位置だけで、そこから先はこの表が決める
 * （shared/ipc/contracts/lsp.ts）。**サーバを名指しする欄が無い**ので、
 * 「Renderer からの要求で任意のサーバが起動する」という形は作られない
 * ── 起動のきっかけは常に「開いた文書の言語」になる（DESIGN.md の STEP 5 引き継ぎ）。
 *
 * ## Monaco の言語 id とは別の表
 *
 * renderer/src/editor/monaco/language.ts が同じ「拡張子 → 言語」を持っているが、
 * **答えの集合が違う**。
 *
 * ```
 * Monaco 側 … 色を付けるための id。`.md` も `.json` も答えを持つ
 * ここ      … LSP の languageId と、担当するサーバ。`.md` は答えを持たない（null）
 * ```
 *
 * 加えて LSP は `.tsx` を `typescriptreact` として区別する（Monaco は
 * `typescript` 1つで、JSX を読むかは TypeScript サービスの設定が決める）。
 * 同じ表を両方から使い回すと、どちらかの都合がもう一方へ滲む。
 *
 * ## 答えを持たない拡張子は、同期しない
 *
 * `.md` / `.json` / `.txt` / 拡張子なし、はどれも null になる。
 * **開けないのではなく、Language Server が要らない**というだけで、
 * 編集も保存も検索も今までどおり動く（Monaco の色も付く）。
 *
 * v1 で正式対応するのは JavaScript / TypeScript・Python・C#（DESIGN.md §4）で、
 * この表はその3つに対応する行だけを持つ。
 */

/**
 * LSP の `languageId`（`textDocument/didOpen` に載る文字列）。
 *
 * 値は LSP 仕様の一覧に載っているものをそのまま使う。サーバはこれを見て
 * 解析の仕方を変えるため、独自の名前を作らない。
 */
export type LspLanguageId =
  'typescript' | 'typescriptreact' | 'javascript' | 'javascriptreact' | 'python' | 'csharp'

/** 1つの文書の行き先。 */
export interface LspDocumentLanguage {
  /** 担当する Language Server（main/lsp/languageServerCatalog.ts の行）。 */
  readonly serverId: LanguageServerId
  readonly languageId: LspLanguageId
}

/**
 * 拡張子（小数点なし・小文字）から行き先への対応。
 *
 * TypeScript のサーバが JavaScript も担当する（1本で両方を見る）ため、
 * `serverId` が同じで `languageId` だけが違う行が並ぶ。
 */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, LspDocumentLanguage>> = {
  ts: { serverId: 'typescript', languageId: 'typescript' },
  mts: { serverId: 'typescript', languageId: 'typescript' },
  cts: { serverId: 'typescript', languageId: 'typescript' },
  tsx: { serverId: 'typescript', languageId: 'typescriptreact' },

  js: { serverId: 'typescript', languageId: 'javascript' },
  mjs: { serverId: 'typescript', languageId: 'javascript' },
  cjs: { serverId: 'typescript', languageId: 'javascript' },
  jsx: { serverId: 'typescript', languageId: 'javascriptreact' },

  py: { serverId: 'python', languageId: 'python' },
  pyi: { serverId: 'python', languageId: 'python' },
  pyw: { serverId: 'python', languageId: 'python' },

  cs: { serverId: 'csharp', languageId: 'csharp' },
  csx: { serverId: 'csharp', languageId: 'csharp' }
}

/**
 * 相対位置から行き先を決める。対応するサーバが無ければ null。
 *
 * 拡張子の取り出し方は Monaco 側（renderer/src/editor/monaco/language.ts）と
 * 同じにしてある ── 先頭のドット（`.gitignore`）は拡張子ではない。
 * **同じファイルについて2つの層が違う答えを出さない**ことが要点で、
 * 表そのものは別でも、名前の読み方は揃えておく必要がある。
 */
export function resolveLspDocumentLanguage(relativePath: string): LspDocumentLanguage | null {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')

  if (dot <= 0) {
    return null
  }

  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null
}
