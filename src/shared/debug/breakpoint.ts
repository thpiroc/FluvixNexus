/**
 * Breakpoint の domain model（Session 6-3）。
 *
 * shared 層のルールどおり、ここに置くのは**型と定数と純粋な判断**だけになる
 * （shared/lsp/document.ts と同じ立ち位置）。プロセスも fs も DAP の電文も
 * 出てこない ── それらは Main の持ち物で、main/debug/ に閉じている。
 *
 * ## この型に無いもの
 *
 * ```
 * 絶対パス / file URI     … 無い（組み立てるのは main/debug/breakpointSource.ts）
 * adapter の実行ファイル  … 無い（表は main/debug/adapterCatalog.ts）
 * DAP の Source / id      … 無い（Renderer は DAP を1語も知らない）
 * adapter が返した文言    … 無い（Main の中だけ。docs/ARCHITECTURE.md §20.12）
 * ```
 *
 * Renderer が扱えるのは `relativePath` / `line` / `enabled` / `verified` の4欄で、
 * このうち Renderer が**決められる**のは「どの相対位置の何行目を入れ替えるか」だけに
 * なる（`enabled` も `verified` も返ってくる値であって、渡す欄ではない）。
 *
 * ## 行は1起点
 *
 * Monaco も DAP も1起点で数える。0起点なのは LSP だけで（shared/lsp/document.ts）、
 * その変換は Main の中で閉じている ── **この型では一度も 0 起点にならない。**
 */

/** 行番号の下限（1起点）。 */
export const DEBUG_BREAKPOINT_MIN_LINE = 1

/**
 * 行番号の上限。
 *
 * Renderer から届く数をそのまま持たないための桁の歯止めで、
 * 「そのファイルに実際にある行か」は見ない（開いていないファイルの行数を
 * Main は知らないし、adapter が verified で答える話にほかならない）。
 */
export const DEBUG_BREAKPOINT_MAX_LINE = 1_000_000

/**
 * 1つの Workspace が持てる breakpoint の数。
 *
 * 保存されるのは Main の userData 配下の JSON 1つ（docs/ARCHITECTURE.md §20.5）で、
 * 桁違いに増えると起動のたびに読む対象が膨らむ。上限に当たった追加は黙って
 * 捨てるのではなく `limit-reached` として断る（main/debug/breakpointModel.ts）。
 */
export const DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE = 500

/**
 * Renderer が受け取る breakpoint 1件。
 *
 * `verified` が3値なのは、**「adapter がまだ何も言っていない」と「adapter が
 * 置けないと言った」が別のこと**だからにほかならない。Debug Session が
 * 動いていない間はいつも null で、その状態で赤い丸を「置けない印」に
 * 変えてしまうと、走らせる前から失敗しているように見える。
 */
export interface DebugBreakpoint {
  /** Workspace root からの相対位置（区切りは `/`）。 */
  readonly relativePath: string
  /** 1起点の行番号。 */
  readonly line: number
  /**
   * 有効か。
   *
   * v1 の UI は追加 / 削除しかしないので常に true になるが、**無効なものは
   * adapter へ送らない**という扱いは実装済みにしてある
   * （main/debug/breakpointSource.ts）── 後から入れ替えの口が増えても、
   * 保存形式も送る側も変わらない。
   */
  readonly enabled: boolean
  /**
   * adapter が「そこで止められる」と答えたか。
   *
   * ```
   * null   … Debug Session が無い / まだ答えが来ていない
   * true   … 置けた
   * false  … adapter が置けないと答えた
   * ```
   */
  readonly verified: boolean | null
}

/** 行番号として受け取れる値か。 */
export function isDebugBreakpointLine(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= DEBUG_BREAKPOINT_MIN_LINE &&
    value <= DEBUG_BREAKPOINT_MAX_LINE
  )
}

/** 同じ場所を指しているか（同一性は相対位置と行の組で決まる）。 */
export function isSameDebugBreakpointLocation(
  a: { readonly relativePath: string; readonly line: number },
  b: { readonly relativePath: string; readonly line: number }
): boolean {
  return a.relativePath === b.relativePath && a.line === b.line
}

/**
 * 並び順。相対位置 → 行の順で並べる。
 *
 * 保存も、Renderer へ返す一覧も、adapter へ送る行の並びも、すべてこの順に揃える
 * ── 同じ内容が呼ぶたびに違う順で出ると、React の再描画も差分の比較も無駄に動く。
 */
export function compareDebugBreakpoints(
  a: { readonly relativePath: string; readonly line: number },
  b: { readonly relativePath: string; readonly line: number }
): number {
  if (a.relativePath !== b.relativePath) {
    return a.relativePath < b.relativePath ? -1 : 1
  }

  return a.line - b.line
}

/** その相対位置のぶんだけを取り出す（Monaco の decoration を組み立てる側が使う）。 */
export function filterDebugBreakpointsForPath(
  breakpoints: readonly DebugBreakpoint[],
  relativePath: string
): readonly DebugBreakpoint[] {
  return breakpoints.filter((breakpoint) => breakpoint.relativePath === relativePath)
}

/** その位置に breakpoint があるか。 */
export function findDebugBreakpointAt(
  breakpoints: readonly DebugBreakpoint[],
  relativePath: string,
  line: number
): DebugBreakpoint | null {
  return (
    breakpoints.find((breakpoint) =>
      isSameDebugBreakpointLocation(breakpoint, { relativePath, line })
    ) ?? null
  )
}
