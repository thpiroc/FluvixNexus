import * as monaco from 'monaco-editor'
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker'
import EditorWorker from 'monaco-editor/editor/common/services/editorWebWorkerMain.js?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker'
import type { ThemeId } from '@shared/theme'
import { monacoThemeBase, readThemeTokens, toMonacoThemeColors } from '../../theme/themeTokens'

/**
 * Monaco Editor をこのアプリの前提に合わせる、唯一の場所。
 *
 * **Monaco の実体を import してよいのは、このファイルと MonacoEditor.tsx /
 * MonacoDiffEditor.tsx / markers.ts だけ**（documentStore.ts は型としてしか見ない）。
 * 言語判定（language.ts）を Monaco から切り離してあるのと同じ理由で、
 * 「Monaco だから決まること」と「このアプリが決めること」を混ぜない。
 *
 * ---
 *
 * ## 1. Worker（CSP を緩めないための本題）
 *
 * Monaco は自分で Web Worker を起動する。既定の経路は Renderer に対して**2つ**あり、
 * 片方は CSP に触れる。
 *
 * | 経路                              | 既定の作られ方                                  | CSP        |
 * | --------------------------------- | ----------------------------------------------- | ---------- |
 * | 言語ごとの Worker（ts / json 等） | `new Worker(new URL('…', import.meta.url))`     | 問題なし   |
 * | Editor 本体の Worker              | **`URL.createObjectURL(new Blob([…]))`**        | blob: が要る |
 *
 * 後者（`platform/webWorker/browser/webWorkerServiceImpl.js` の `getWorkerBootstrapUrl`）は
 * NLS の埋め込みのために起動用スクリプトを blob として作る。これをそのまま使うと
 * `worker-src 'self'` では起動できず、CSP に `blob:` を足すことになる。
 *
 * **`MonacoEnvironment.getWorker` を定義すると、その経路は丸ごと迂回される**
 * （`standalone/browser/services/standaloneWebWorkerService.js` が
 * blob を作る前にこちらを呼ぶ）。ここで返しているのは Vite が
 * `?worker` として**アプリにバンドルした Worker** で、外部 CDN も blob も経由しない。
 *
 * したがって STEP 1 の CSP（`worker-src 'self'`）は**そのまま**でよい。
 * これは「今は動く」ではなく構造として決まる ── 迂回している以上、
 * blob を作る側のコードには到達しない。
 *
 * ### undefined を返さないこと
 *
 * `getWorker` が `undefined` を返すと、Monaco は「用意が無かった」とみなして
 * blob の経路へ落ちる。知らない label（Monaco 側の追加・将来のバージョン）も
 * Editor 本体の Worker として扱い、**必ず Worker を返す**。
 *
 * ---
 *
 * ## 2. 言語サービスは「Monaco 標準で得られる範囲」に留める
 *
 * TypeScript の**意味解析（semantic）を切ってある**のが要点。
 * Monaco が内蔵する TypeScript は tsconfig も node_modules も見ないため、
 * 実際のプロジェクトを開くと `Cannot find module './foo'` のような
 * **本当ではない赤線**でファイル全体が埋まる。
 *
 * 構文解析（syntax）は残す。こちらは1ファイルの中だけで完結し、
 * 出る指摘は常に正しい。
 *
 * 型に基づく指摘・定義へ移動・Rename は LSP の担当（DESIGN.md §4）。
 * ここで中途半端に出すと、LSP を入れたときに
 * 「どちらの結果を見ているか」が分からない状態になる。
 *
 * ---
 *
 * ## 3. 外部へ通信しない
 *
 * JSON の `enableSchemaRequest` を明示的に false にしてある。
 * true だと `$schema` の URL を Renderer から直接取りに行く。
 * CSP（`connect-src 'self'`）が止めるとはいえ、**止められる前提の実装を残さない**
 * （ARCHITECTURE.md §5「通信が必要になっても Renderer から直接叩かず Main 経由」）。
 */

/* ------------------------------------------------------------------ Worker */

/**
 * Monaco が要求する Worker を返す。
 *
 * label は Editor 本体なら `'editorWorkerService'`、言語サービスなら言語 id。
 */
function createMonacoWorker(label: string): Worker {
  switch (label) {
    case 'typescript':
    case 'javascript':
      return new TsWorker()

    case 'json':
      return new JsonWorker()

    case 'css':
    case 'scss':
    case 'less':
      return new CssWorker()

    case 'html':
    case 'handlebars':
    case 'razor':
      return new HtmlWorker()

    default:
      // 'editorWorkerService' と、知らない label。blob の経路へ落とさない（上のコメント）。
      return new EditorWorker()
  }
}

/* ------------------------------------------------------------------- テーマ */

/**
 * このアプリのテーマ（Session 4-4 で Theme に追従するようになった）。
 *
 * Monaco は CSS 変数を読まず、色を JavaScript の値として要求する。
 * Session 4-3B までは**そのために `theme.css` と同じ 16進数をここへ書き写して**
 * いて、「片方を変えるときは両方を直すこと」という注意書きが付いていた ──
 * Theme が2つになれば写しは倍になり、直し忘れは「Light にしたのに
 * エディタの中だけ黒い」という形で出る。
 *
 * 今は `theme/themeTokens.ts` が `theme.css` の変数を読んで組み立てる。
 * **このファイルに色は1つも無い。**
 *
 * 名前を Theme ごとに分けないのは、Monaco のテーマが**その id で
 * 上書き定義できる**ため（`defineTheme` は同じ id なら差し替えになる）。
 * 分けると、切り替えのたびに使われない定義が積み上がる。
 *
 * 継承元（`vs` / `vs-dark`）だけは Theme によって変わる。トークンの色
 * （構文ハイライト）を自前で持たないための土台で、その対応は themeTokens.ts が持つ。
 */
const FLUVIX_THEME_ID = 'fluvix'

/**
 * 今の Theme を Monaco へ当てる。
 *
 * **Monaco のテーマはアプリに1つ**（`setTheme` はグローバル）なので、
 * 通常のエディタと Compare の差分エディタのどちらから呼んでも同じ結果になる。
 * 何度呼んでも構わない。
 *
 * 呼ばれる時点で `<html>` の `data-fx-theme` は既に新しい値になっている
 * （theme/ThemeProvider.tsx が描画の中で当てる ── effect にしない理由はそちら）。
 */
export function applyMonacoTheme(theme: ThemeId): void {
  monaco.editor.defineTheme(FLUVIX_THEME_ID, {
    base: monacoThemeBase(theme),
    inherit: true,
    rules: [],
    colors: toMonacoThemeColors(readThemeTokens())
  })

  monaco.editor.setTheme(FLUVIX_THEME_ID)
}

/* ------------------------------------------- 内蔵の検査（Session 5-3） */

/**
 * TypeScript / JavaScript の内蔵検査を止めているか。
 *
 * 止めるのは**本物の Language Server が指摘を出している間だけ**。
 * 判断そのものは持たず、受け取った値を Monaco へ当てるだけになる
 * （決めるのは renderer/src/editor/lsp/useDiagnostics.ts）。
 */
let builtInValidationSuppressed = false
let builtInCompletionSuppressed = true
let builtInHoverSuppressed = true

/**
 * 今の設定を Monaco へ当てる。
 *
 * 意味解析（`noSemanticValidation`）は**常に切ったまま**にする ── tsconfig も
 * node_modules も見えない状態で出る型エラーは、ほぼすべてが本当ではない指摘に
 * なる（このファイルの冒頭 2）。切り替わるのは構文の検査だけ。
 */
function applyBuiltInValidation(): void {
  const options: monaco.typescript.DiagnosticsOptions = {
    noSemanticValidation: true,
    noSyntaxValidation: builtInValidationSuppressed,
    noSuggestionDiagnostics: true
  }

  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(options)
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(options)
}

/**
 * TypeScript / JavaScript の内蔵検査を止める / 戻す。
 *
 * ## なぜ owner を分けるだけでは足りないか
 *
 * marker の owner は分けてある（monaco/markers.ts）ので、内蔵と LSP の指摘は
 * 互いを消さない。**消さないからこそ、同じ構文誤りが2本の線として出る。**
 * `,` を1つ忘れただけで、Monaco と tsserver が別々に赤を引く。
 *
 * そこで、本物のサーバが答えている間は内蔵の側を黙らせる。
 *
 * ## アプリ全体に効く（文書ごとではない）
 *
 * `typescriptDefaults` はアプリに1つで、Model ごとに設定を変える手段が
 * Monaco の側に無い。したがって「TypeScript の文書を1つでもサーバが見ているか」
 * で決まる ── 同じ Workspace の中で、あるファイルだけサーバが見ていない、
 * という状態は起きないので実害にならない。
 *
 * ## 止めっぱなしにしない
 *
 * サーバが落ちた・終わった・Workspace が切り替わったときは戻す。
 * 戻さないと、**Language Server が居ないのに内蔵の指摘も出ない**という、
 * STEP 4 までより悪い状態が残る（DESIGN.md §4）。
 *
 * 何度呼んでも構わない（同じ値なら Monaco に触れない）。
 */
export function setBuiltInValidationSuppressed(suppressed: boolean): void {
  if (builtInValidationSuppressed === suppressed) {
    return
  }

  builtInValidationSuppressed = suppressed

  // まだ setupMonaco が走っていなければ、初期化のときに今の値が当たる。
  if (initialized) {
    applyBuiltInValidation()
  }
}

function applyBuiltInModeConfiguration(): void {
  const configuration: monaco.typescript.ModeConfiguration = {
    completionItems: !builtInCompletionSuppressed,
    hovers: !builtInHoverSuppressed,
    documentSymbols: true,
    definitions: true,
    references: true,
    documentHighlights: true,
    rename: true,
    diagnostics: true,
    documentRangeFormattingEdits: true,
    signatureHelp: true,
    onTypeFormattingEdits: true,
    codeActions: true,
    inlayHints: true
  }

  monaco.typescript.typescriptDefaults.setModeConfiguration(configuration)
  monaco.typescript.javascriptDefaults.setModeConfiguration(configuration)
}

export function setBuiltInCompletionSuppressed(suppressed: boolean): void {
  if (builtInCompletionSuppressed === suppressed) {
    return
  }

  builtInCompletionSuppressed = suppressed

  if (initialized) {
    applyBuiltInModeConfiguration()
  }
}

export function setBuiltInHoverSuppressed(suppressed: boolean): void {
  if (builtInHoverSuppressed === suppressed) {
    return
  }

  builtInHoverSuppressed = suppressed

  if (initialized) {
    applyBuiltInModeConfiguration()
  }
}

/* ------------------------------------------------------------------- 初期化 */

let initialized = false

/**
 * Monaco をこのアプリの前提に合わせる。
 *
 * 何度呼んでも1回しか効かない。Editor パネルは閉じたり開いたりできる（§7.7）ため、
 * 「最初にエディタを作るとき」という呼び出し側の事情に依存させない。
 *
 * **テーマはここで当てない**（Session 4-4）。1回しか効かないここに置くと、
 * 後から Theme を切り替えたときに当たらない ── テーマは
 * `applyMonacoTheme` を Theme が変わるたびに呼ぶ形にしてあり、
 * 最初の1回もそこが受け持つ（MonacoEditor.tsx / MonacoDiffEditor.tsx）。
 */
export function setupMonaco(): void {
  if (initialized) {
    return
  }

  initialized = true

  /*
    MonacoEnvironment はグローバル。Monaco 自身が `globalThis.MonacoEnvironment` を
    読むため、モジュールの値として持つことはできない。
  */
  self.MonacoEnvironment = {
    getWorker: (_workerId, label) => createMonacoWorker(label)
  }

  /*
    TypeScript / JavaScript。

    JSX を Preserve にしてあるのは、Monaco に出力を作らせないため
    （必要なのは .tsx / .jsx を構文として読めることだけ）。
  */
  const typeScriptCompilerOptions: monaco.typescript.CompilerOptions = {
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.Preserve,
    allowJs: true,
    allowNonTsExtensions: true
  }

  monaco.typescript.typescriptDefaults.setCompilerOptions(typeScriptCompilerOptions)
  monaco.typescript.javascriptDefaults.setCompilerOptions(typeScriptCompilerOptions)

  // 内蔵の検査は既定（構文だけ）から始める。切り替えの理由は下記。
  applyBuiltInValidation()
  applyBuiltInModeConfiguration()

  // JSON。構文の検査は1ファイルで完結するので残し、外部スキーマの取得だけを止める。
  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    enableSchemaRequest: false,
    schemas: []
  })
}

/**
 * すべてのエディタで共通の表示設定。
 *
 * ここに並べるのは「アプリとして決めたこと」だけに留め、それ以外は Monaco の既定に任せる。
 * 設定 UI（DESIGN.md §9）が入るまでは、この値が唯一の決定になる。
 */
export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  /*
    パネルは Dock / Split / リサイズで常に大きさが変わる（ARCHITECTURE.md §7.6）。
    Shell 側からエディタへ「今の大きさ」を伝える経路を作らずに済むよう、
    Monaco 自身に監視させる。
  */
  automaticLayout: true,
  // タブ列・ツリーと同じ等幅フォント（editor.css / files.css と揃える）。
  fontFamily: "Consolas, 'Courier New', monospace",
  fontSize: 13,
  /*
    折り返さない。ソースコードの見え方を折り返しで変えないため
    （Session 3-3 の暫定表示と同じ判断）。
  */
  wordWrap: 'off',
  // 末尾で1画面ぶん余白が空くと、狭いパネルでは「まだ続きがある」ように見える。
  scrollBeyondLastLine: false,
  /*
    インデント幅はファイルの中身から推定させる（Monaco の既定）。
    プロジェクトごとに違うものを、アプリ側の設定で上書きしない。
  */
  detectIndentation: true
}

/**
 * Compare（Conflict の差分表示）の設定。
 *
 * `EDITOR_OPTIONS` を土台にして、差分ならではの3つだけを変える。
 *
 * - **読み取り専用。** 直すのは元のエディタで行う（MonacoDiffEditor.tsx）。
 *   ここを編集可能にすると保存の入口が2つになる
 * - **左右に並べる。** 「ディスク側」と「Editor 側」という2つの中身を比べる画面なので、
 *   inline（1つの中に混ぜる）だと、どちらがどちらか分からなくなる
 * - **行番号を出す。** 元のエディタで直すときに、位置を突き合わせる手掛かりになる
 *
 * 差分の計算は Editor 本体の Worker が行う。CSP まわりの前提は
 * 通常のエディタとまったく同じで、追加の Worker も外部通信も増えない。
 */
export const DIFF_EDITOR_OPTIONS: monaco.editor.IStandaloneDiffEditorConstructionOptions = {
  ...EDITOR_OPTIONS,
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  // 狭いパネルでは左右に並べられないので、その場合だけ Monaco に畳ませる。
  renderSideBySideInlineBreakpoint: 600,
  enableSplitViewResizing: true
}

export { monaco }
