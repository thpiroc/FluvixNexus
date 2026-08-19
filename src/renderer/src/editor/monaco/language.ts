/**
 * 開いたファイルを Monaco のどの言語として扱うか。
 *
 * ## monaco を import しない
 *
 * 返すのは Monaco の言語 id（`'typescript'` など）だが、この判断自体に Monaco は要らない。
 * 分けてあるのは2つの理由による。
 *
 *   - **テストできる形にしておく。** 判定は「拡張子 → 文字列」の対応でしかなく、
 *     Monaco（DOM とワーカーを要求する）を読み込ませる理由が無い
 *     （main/files/workspacePath.ts を fs から切り離してあるのと同じ分担）。
 *   - **判定の入口を1つに保つ。** アイコンの出し分け・LSP サーバの選択も
 *     同じ「このファイルは何か」から始まる。Monaco に紐づけてしまうと、
 *     Monaco を使わない場所から同じ判断を引けなくなる。
 *
 * ## 拡張子だけで決める
 *
 * ファイル名そのものを見る規則（`Dockerfile`・`.gitignore`）はまだ持たない。
 * 引数を relativePath にしてあるのは、そこへ足すときに呼び出し側を変えずに済むため。
 *
 * ## 知らない拡張子は Plain Text
 *
 * 「開けない」にはしない。テキストとして読める以上、色が付かないだけで
 * 編集も検索も保存もできる方がよい（DESIGN.md の「必要な機能を高品質に絞り込む」）。
 *
 * v1 で正式対応する言語は JavaScript / TypeScript・Python・C#（DESIGN.md §4）。
 * ここに並んでいるそれ以外（JSON / HTML / CSS / Markdown）は、
 * 設定ファイルや README として**必ず同じプロジェクトの中にある**もの。
 */

/** Monaco の言語 id。ここに無いものは扱わない（＝ Plain Text になる）。 */
export type EditorLanguageId =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'html'
  | 'css'
  | 'markdown'
  | 'python'
  | 'csharp'
  | 'plaintext'

/** 知らない拡張子の行き先。 */
export const FALLBACK_EDITOR_LANGUAGE_ID: EditorLanguageId = 'plaintext'

/**
 * 拡張子（小数点なし・小文字）から言語 id への対応。
 *
 * TSX / JSX に別の id が無いのは Monaco の作りによる。`.tsx` は `typescript`、
 * `.jsx` は `javascript` として扱い、JSX 構文を解釈するかどうかは
 * TypeScript サービスの設定（monacoSetup.ts の `jsx`）が決める。
 */
const LANGUAGE_ID_BY_EXTENSION: Readonly<Record<string, EditorLanguageId>> = {
  // TypeScript（.tsx を含む）
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',

  // JavaScript（.jsx を含む）
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',

  json: 'json',
  // tsconfig.json などコメント付き JSON。Monaco は同じ言語として扱える。
  jsonc: 'json',

  html: 'html',
  htm: 'html',

  css: 'css',

  md: 'markdown',
  markdown: 'markdown',

  py: 'python',
  pyw: 'python',
  pyi: 'python',

  cs: 'csharp',
  csx: 'csharp',

  txt: 'plaintext'
}

/**
 * 拡張子（小数点なし。大文字小文字は問わない）から言語 id を決める。
 *
 * `FileEntry.extension` をそのまま渡せる形にしてある（拡張子の無いファイルは null）。
 */
export function resolveEditorLanguageIdByExtension(extension: string | null): EditorLanguageId {
  if (extension === null || extension === '') {
    return FALLBACK_EDITOR_LANGUAGE_ID
  }

  return LANGUAGE_ID_BY_EXTENSION[extension.toLowerCase()] ?? FALLBACK_EDITOR_LANGUAGE_ID
}

/**
 * Workspace 内の相対位置から言語 id を決める。
 *
 * 拡張子の取り出しをここに閉じてあるのは、`.gitignore` のように
 * **先頭のドットが拡張子ではない**形を1箇所で扱うため。
 */
export function resolveEditorLanguageId(relativePath: string): EditorLanguageId {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')

  // 先頭のドット（`.gitignore`）は拡張子ではない。ドットが無い場合も同じ扱い。
  if (dot <= 0) {
    return FALLBACK_EDITOR_LANGUAGE_ID
  }

  return resolveEditorLanguageIdByExtension(name.slice(dot + 1))
}
