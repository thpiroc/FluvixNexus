/**
 * `initialize` の応答に載っていた「そのサーバができること」を読む
 * （依存なし・テスト対象。Session 5-10）。
 *
 * ## Session 5-9 までは読んでいなかった
 *
 * languageServers.ts の `initializeServer` には
 * 「応答の `capabilities` は読まない」と書いてあった。読まなくて済んでいたのは、
 * 対象が **typescript-language-server 1本だけ**で、その1本が
 * 補完・Hover・定義・参照・整形・Rename のすべてを出すためにほかならない。
 *
 * Python（Pyright）を足すとそれが崩れる。
 *
 * ```
 * typescript-language-server … completion / hover / definition / references
 *                              / documentFormatting / rename(prepare)
 * pyright-langserver         … completion / hover / definition / references
 *                              / rename(prepare)      ← documentFormatting が無い
 * ```
 *
 * Pyright へ `textDocument/formatting` を送ると
 * `-32601 Unhandled method textDocument/formatting` が返る。**答えは返ってくる
 * ので壊れはしない**が、返ってこないと分かっているものを毎回送るのは、
 * 「応じられないものを受け付けると言わない」（initializeParams.ts）の裏返しに
 * あたる ── こちらも、出さないと言われたものを要求しない。
 *
 * ## 読めなければ、送る（＝ Session 5-9 までと同じ）
 *
 * `capabilities` が object として読めないサーバでは**すべて true** にする。
 * 申告を読めないことは機能を止める理由にならない、という扱いは
 * 設定が読めないときに既定へ落とすのと同じ線
 * （shared/lsp/serverSettings.ts の「読めなければ、使う」）。
 *
 * 読める場合はそのまま信じる。仕様上、欄が無い＝出さない、であり、
 * ここで「無いけれど試してみる」をやると**申告を読む意味が無くなる。**
 *
 * ## Renderer へは渡らない
 *
 * ここで作る値は Main の中だけで使う。Renderer が知るのは今までどおり
 * 「その言語の機能が今使えるか」までで（shared/lsp/serverStatus.ts）、
 * どのサーバが何を出すかという表は境界を越えない。
 */

/** このアプリが実際に要求する LSP の機能。ここに無いものは送らない。 */
export type LanguageServerFeature =
  'completion' | 'hover' | 'definition' | 'references' | 'formatting' | 'rename' | 'prepare-rename'

/** サーバ1本ができること。 */
export type LanguageServerCapabilities = Readonly<Record<LanguageServerFeature, boolean>>

/** 申告が読めなかったときの値（Session 5-9 までと同じ振る舞い）。 */
export const PERMISSIVE_LANGUAGE_SERVER_CAPABILITIES: LanguageServerCapabilities = {
  completion: true,
  hover: true,
  definition: true,
  references: true,
  formatting: true,
  rename: true,
  'prepare-rename': true
}

/**
 * `initialize` の応答から、上の7つを読む。
 *
 * 引数は応答そのもの（`{ capabilities, serverInfo }`）で、`capabilities` の
 * 中身ではない ── 応答の形そのものが読めない場合も、ここ1箇所で既定へ落とす。
 */
export function parseLanguageServerCapabilities(result: unknown): LanguageServerCapabilities {
  if (typeof result !== 'object' || result === null) {
    return PERMISSIVE_LANGUAGE_SERVER_CAPABILITIES
  }

  const { capabilities } = result as { readonly capabilities: unknown }

  if (typeof capabilities !== 'object' || capabilities === null) {
    return PERMISSIVE_LANGUAGE_SERVER_CAPABILITIES
  }

  const raw = capabilities as {
    readonly completionProvider: unknown
    readonly hoverProvider: unknown
    readonly definitionProvider: unknown
    readonly referencesProvider: unknown
    readonly documentFormattingProvider: unknown
    readonly renameProvider: unknown
  }

  return {
    completion: isProvided(raw.completionProvider),
    hover: isProvided(raw.hoverProvider),
    definition: isProvided(raw.definitionProvider),
    references: isProvided(raw.referencesProvider),
    formatting: isProvided(raw.documentFormattingProvider),
    rename: isProvided(raw.renameProvider),
    'prepare-rename': hasPrepareProvider(raw.renameProvider)
  }
}

/**
 * 申告の欄1つを読む。
 *
 * LSP の provider 欄は `boolean | Options | undefined` の3通りで、
 * **object であること自体が「出す」を意味する**（中の `workDoneProgress` などは
 * 出すかどうかとは関係が無い）。`false` を明示するサーバは実在するため
 * （typescript-language-server の `linkedEditingRangeProvider: false`）、
 * 「欄がある」ではなく「欄が false でない」で見る。
 */
function isProvided(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  return typeof value === 'object' && value !== null
}

/**
 * `renameProvider.prepareProvider`。
 *
 * `renameProvider: true`（options を持たない形）は「Rename は出すが
 * `prepareRename` は出さない」を意味する ── 素の boolean のときに
 * true を返さないのはそのため。送ってしまうと `-32601` が返り、
 * Renderer は内蔵の Rename へ落ちる（main/lsp/rename.ts）。
 */
function hasPrepareProvider(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return (value as { readonly prepareProvider: unknown }).prepareProvider === true
}
