/**
 * Breakpoint の永続化フォーマット（Session 6-3）。
 *
 * `shared/workspace/layoutDocument.ts` と同じ立ち位置で、**ディスクに置かれる
 * JSON の形の唯一の定義**になる。実行時のモデル（main/debug/breakpointModel.ts の
 * `DebugBreakpointRecord`）とは意図的に別の型にしてあり、理由も同じ。
 *
 *   1. 保存形式は後方互換を守る対象で、実行時モデルは自由に変えてよい
 *   2. adapter が答えた `verified` / `message` は**保存しない** ──
 *      あれは「今動いている adapter がどう答えたか」であって breakpoint の性質ではない
 *
 * ## Workspace の絶対パスが key として載る
 *
 * docs/ARCHITECTURE.md §20.5 の決めどおり、ファイルの中は Workspace の絶対パスで引く。
 * **この key が Renderer へ出ることは無い**（応答に載るのは breakpoint の配列だけ）。
 * 保存先は userData 配下で、**Workspace の中（`.vscode/` や `.fluvix/`）には置かない**
 * ── 置いた瞬間、リポジトリを clone しただけで他人の印が手元に入ってくる。
 *
 * この形は shared 層のルールどおり型と定数だけを持つ。検証は
 * main/store/debugBreakpointsDocument.ts（Electron 非依存・テスト対象）。
 */

/**
 * 保存データの構造バージョン。
 *
 * 形を変えたら必ずこの値を上げること。読めない版のファイルは、その Workspace の
 * breakpoint を空として起動する（レイアウトと同じ扱い）。
 */
export const DEBUG_BREAKPOINTS_SCHEMA_VERSION = 1

/**
 * 保存データの上限（おおよそのバイト数）。
 *
 * 1件あたり数十バイトで、1 Workspace の上限は 500 件
 * （`DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE`）。Workspace が増えても
 * 数百 KB を超えることは通常あり得ない。
 */
export const DEBUG_BREAKPOINTS_DOCUMENT_MAX_BYTES = 512 * 1024

/**
 * 覚えておく Workspace の数。
 *
 * 上限を置くのは、**開いたことのある Workspace が増え続けても保存ファイルが
 * 太らないようにする**ため。溢れたときに落とすのは、今開いている Workspace 以外で
 * 最も古いもの（main/debug/breakpoints.ts）。
 */
export const DEBUG_BREAKPOINTS_MAX_WORKSPACES = 50

/** 保存形式での breakpoint 1件。 */
export interface StoredDebugBreakpointEntry {
  /** Workspace root からの相対位置（区切りは `/`）。 */
  readonly relativePath: string
  /** 1起点の行番号。 */
  readonly line: number
  readonly enabled: boolean
}

/** 保存形式での Workspace 1つぶん。 */
export interface StoredDebugBreakpointWorkspace {
  /** 最後にこの Workspace を書いた時刻（溢れたときに落とす順を決める）。 */
  readonly updatedAt: number
  readonly breakpoints: readonly StoredDebugBreakpointEntry[]
}

/** 保存ファイル全体。key は Workspace root の絶対パス。 */
export interface DebugBreakpointsDocument {
  readonly schemaVersion: number
  readonly workspaces: Readonly<Record<string, StoredDebugBreakpointWorkspace>>
}
