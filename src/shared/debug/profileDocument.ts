import type { DebugProfile } from './profile'

/**
 * Debug Profile の永続化フォーマット（Session 6-10）。
 *
 * shared/debug/breakpointDocument.ts と同じ立ち位置で、**ディスクに置かれる JSON の形の
 * 唯一の定義**になる。
 *
 * ## Workspace の絶対パスが key として載る
 *
 * docs/ARCHITECTURE.md §20.5 の決めどおり、ファイルの中は Workspace root の
 * 絶対パス（realpath で正規化）で引く。**この key が Renderer へ出ることは無い**
 * （応答に載るのは profile の配列だけ）。
 *
 * 保存先は userData 配下の `debug-profiles.json` で、**Workspace の中（`.vscode/` や
 * `.fluvix/`）には置かない** ── 置いた瞬間、リポジトリを clone しただけで
 * 「このプロジェクトではこれが起動する」が手元に入ってくる。
 *
 * breakpoint とは別のファイルにする。一方は「何を起動するか」、もう一方は
 * 「どこで止めるか」で、壊れたときに巻き添えにする理由が無い。
 *
 * 検証は main/store/debugProfilesDocument.ts（Electron 非依存・テスト対象）。
 */

/** 形を変えたら必ず上げる。読めない版は、その Workspace の profile を空として起動する。 */
export const DEBUG_PROFILES_SCHEMA_VERSION = 1

/**
 * 保存データの上限（おおよそのバイト数）。
 *
 * 1件は上限まで詰めても数十 KB で、実際の profile は数百バイトに収まる。
 * 桁違いに大きい内容は、破損か想定外の使われ方として扱う。
 */
export const DEBUG_PROFILES_DOCUMENT_MAX_BYTES = 1024 * 1024

/** 覚えておく Workspace の数（溢れたら、今の Workspace 以外で最も古いものから落とす）。 */
export const DEBUG_PROFILES_MAX_WORKSPACES = 50

/** 保存形式での Workspace 1つぶん。profile は Renderer に返す形と同じ7欄。 */
export interface StoredDebugProfileWorkspace {
  readonly updatedAt: number
  readonly profiles: readonly DebugProfile[]
}

/** 保存ファイル全体。key は Workspace root の realpath。 */
export interface DebugProfilesDocument {
  readonly schemaVersion: number
  readonly workspaces: Readonly<Record<string, StoredDebugProfileWorkspace>>
}
