import type { FileEntry, FileEntryType } from '@shared/files'

/**
 * ファイル・フォルダの種類から、どのアイコンを出すかを決める（Session 3-6-6）。
 *
 * ## 表示層の判断であり、データは変えない
 *
 * `FileEntry`（shared/files/entry.ts）にアイコンの欄を足していない。種類は名前から
 * その場で分かるもので、Main が運ぶ必要が無い ── 運ぶと「ディスクにあるものの写し」
 * だったはずの型が、表示の都合を持ち始める（ARCHITECTURE.md §9.2）。
 *
 * ## 描くことと分けてある
 *
 * ここが答えるのは `FileIconId` までで、SVG は FileTreeIcons.tsx が持つ。
 * `fileTreeModel.ts`（並び）と `FileTree.tsx`（描画）を分けてあるのと同じ分担で、
 * **判定だけを React にも DOM にも依存しない形で残す**ためにこうしてある
 * （editor/monaco/language.ts が Monaco を import しないのと同じ理由）。
 *
 * ## ツリーと検索で同じ判定を使う
 *
 * 呼ぶのはツリー（FileTree.tsx）・ファイル名検索（FileNameSearch.tsx）・
 * 全文検索（FileContentSearch.tsx）の3箇所。判定を書くのはここ1箇所だけで、
 * 2箇所に書くと「ツリーでは TypeScript なのに検索結果では無地」という食い違いが
 * 入口ごとに生まれる。
 *
 * 全文検索の結果は `FileEntry` を持たず名前しか無い（fileContentSearchModel.ts）ため、
 * **入口は名前1つ**にしてある。`FileEntry.extension` から引く形にすると、
 * extension を持たない呼び出し側がそこで判定を自作することになる。
 *
 * ## 表を2つに分ける
 *
 * 拡張子で決まるもの（`.ts`）と、名前そのものに意味があるもの（`package.json`・
 * `Dockerfile`）は別の表にする。混ぜると `README.md` を「md の例外」として
 * 拡張子の表に書くことになり、`.md` の行を読んでも何が起きるか分からなくなる。
 *
 * **名前の表が先に効く。** `package.json` は JSON でもあるが、そのプロジェクトでの
 * 意味は「パッケージの定義」の側にある。逆順にすると名前の表は一度も効かない。
 */

/**
 * アイコンの種類。
 *
 * 増やすときは、この型 → 下の表 → FileTreeIcons.tsx の `FILE_ICON_SHAPES` の順に足す
 * （どれかが漏れると型エラーになる）。フォルダ名ごとの専用アイコン（`src`・
 * `node_modules`）はまだ持たない ── 足すなら3つめの表（フォルダ名 → アイコン）になる。
 */
export type FileIconId =
  | 'folder'
  | 'folder-open'
  | 'typescript'
  | 'typescript-react'
  | 'javascript'
  | 'javascript-react'
  | 'json'
  | 'html'
  | 'css'
  | 'markdown'
  | 'python'
  | 'csharp'
  | 'image'
  | 'text'
  | 'package'
  | 'git'
  | 'docker'
  | 'readme'
  | 'file'

/** 種類が分からないファイル。**「開けない」ではない**ので、無地のアイコンを出す。 */
export const FALLBACK_FILE_ICON_ID: FileIconId = 'file'

/**
 * 名前そのもの（小文字）から引く表。
 *
 * 完全一致だけを見る。`Dockerfile.dev` のような派生形まで拾おうとすると、
 * 「前方一致か / 区切りはどこか」を決める規則がここに増える ── その規則は
 * 拾えなかった名前が出てくるたびに揺れるので、まずは字義どおりに揃えておく。
 */
const FILE_ICON_BY_FILENAME: Readonly<Record<string, FileIconId>> = {
  'package.json': 'package',
  'package-lock.json': 'package',

  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',

  dockerfile: 'docker',
  '.dockerignore': 'docker',

  'readme.md': 'readme'
}

/**
 * 拡張子（小数点なし・小文字）から引く表。
 *
 * 並びは editor/monaco/language.ts（拡張子 → 言語 id）と揃えてある。**同じ表に
 * まとめていない**のは、答える相手が違うため ── あちらは「Monaco が何として
 * 解釈するか」で、`.tsx` と `.ts` はどちらも `typescript` になる。こちらは
 * 「利用者が一覧の中でどう見分けるか」なので、その2つは別のアイコンになる。
 */
const FILE_ICON_BY_EXTENSION: Readonly<Record<string, FileIconId>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript-react',

  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript-react',

  json: 'json',
  jsonc: 'json',

  html: 'html',
  htm: 'html',

  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',

  md: 'markdown',
  markdown: 'markdown',

  py: 'python',
  pyw: 'python',
  pyi: 'python',

  cs: 'csharp',
  csx: 'csharp',

  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  bmp: 'image',
  webp: 'image',
  avif: 'image',
  ico: 'image',
  svg: 'image',

  txt: 'text',
  log: 'text'
}

/**
 * 名前から拡張子（小数点なし・小文字）を取り出す。無ければ null。
 *
 * **先頭のドットは拡張子ではない**（`.gitignore` の拡張子は `gitignore` ではない）。
 * 複数のドットを含む名前（`app.test.ts`）は最後のドットから後ろだけを見る。
 * language.ts が同じ規則を持っているが、あちらは relativePath を受ける
 * ── 共有していないのは、この2行のために表示層から Editor の内部を参照させないため。
 */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')

  if (dot <= 0 || dot === name.length - 1) {
    return null
  }

  return name.slice(dot + 1).toLowerCase()
}

/**
 * ファイル1件のアイコン。
 *
 * 順番は **名前の表 → 拡張子の表 → 無地**。大文字小文字は区別しない
 * （`Main.TS` も `README.MD` も同じものとして扱う）。
 */
export function resolveFileIconId(name: string): FileIconId {
  const byName = FILE_ICON_BY_FILENAME[name.toLowerCase()]

  if (byName !== undefined) {
    return byName
  }

  const extension = extensionOf(name)

  if (extension === null) {
    return FALLBACK_FILE_ICON_ID
  }

  return FILE_ICON_BY_EXTENSION[extension] ?? FALLBACK_FILE_ICON_ID
}

/**
 * フォルダのアイコン。
 *
 * 開いているかどうかだけで決める。フォルダ名は見ない ── 見ると
 * `Dockerfile` という名前のフォルダにクジラが付く（種類の表はファイルのためのもの）。
 */
export function resolveDirectoryIconId(expanded: boolean): FileIconId {
  return expanded ? 'folder-open' : 'folder'
}

/**
 * ツリー・検索結果の1行のアイコン。
 *
 * `expanded` を持たない場所（検索結果）からは省略できる ──
 * 検索結果のフォルダは開いている / いないという状態を持たない。
 */
export function resolveEntryIconId(
  entry: Pick<FileEntry, 'name'> & { readonly type: FileEntryType },
  expanded = false
): FileIconId {
  return entry.type === 'directory'
    ? resolveDirectoryIconId(expanded)
    : resolveFileIconId(entry.name)
}
