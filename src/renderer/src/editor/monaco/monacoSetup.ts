import * as monaco from 'monaco-editor'
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker'
import EditorWorker from 'monaco-editor/editor/common/services/editorWebWorkerMain.js?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker'

/**
 * Monaco Editor をこのアプリの前提に合わせる、唯一の場所。
 *
 * **Monaco を import してよいのはこのファイルと documentStore.ts / MonacoEditor.tsx だけ。**
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
 * Fluvix Nexus のダークテーマ。
 *
 * 値を直接書いてよいのは styles/theme.css だけ、という約束の例外にあたる。
 * Monaco は CSS 変数を読まず、色を JavaScript の値として要求するため。
 * **theme.css と同じ値を書き写している**ので、片方を変えるときは両方を直すこと。
 *
 * `vs-dark` を継承しているのは、トークンの色（構文ハイライト）を自前で持たないため。
 * 独自の配色を決めるのは、色の設計をひととおり終えてからでよい。
 */
const FLUVIX_DARK_THEME_ID = 'fluvix-dark'

const fluvixDarkTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1e1e', // --fx-color-surface
    'editor.foreground': '#d4d4d4', // --fx-color-text
    'editorLineNumber.foreground': '#6a6a6a', // --fx-color-text-faint
    'editorLineNumber.activeForeground': '#d4d4d4', // --fx-color-text
    'editorCursor.foreground': '#d4d4d4',
    'editor.lineHighlightBorder': '#2d2d2d', // --fx-color-surface-hover
    'editorWidget.background': '#252526', // --fx-color-surface-raised
    'editorWidget.border': '#3c3c3c', // --fx-color-border-strong
    'editorSuggestWidget.background': '#252526',
    'editorSuggestWidget.border': '#3c3c3c',
    'input.background': '#1e1e1e',
    'input.border': '#3c3c3c'
  }
}

/* ------------------------------------------------------------------- 初期化 */

let initialized = false

/**
 * Monaco をこのアプリの前提に合わせる。
 *
 * 何度呼んでも1回しか効かない。Editor パネルは閉じたり開いたりできる（§7.7）ため、
 * 「最初にエディタを作るとき」という呼び出し側の事情に依存させない。
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

  monaco.editor.defineTheme(FLUVIX_DARK_THEME_ID, fluvixDarkTheme)
  monaco.editor.setTheme(FLUVIX_DARK_THEME_ID)

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

  /*
    意味解析を切る理由は冒頭の 2。tsconfig も node_modules も見えない状態で
    出る型エラーは、ほぼすべてが「本当ではない指摘」になる。
  */
  const typeScriptDiagnosticsOptions: monaco.typescript.DiagnosticsOptions = {
    noSemanticValidation: true,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: true
  }

  monaco.typescript.typescriptDefaults.setCompilerOptions(typeScriptCompilerOptions)
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(typeScriptDiagnosticsOptions)
  monaco.typescript.javascriptDefaults.setCompilerOptions(typeScriptCompilerOptions)
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(typeScriptDiagnosticsOptions)

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
