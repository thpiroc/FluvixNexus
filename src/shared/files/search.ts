/**
 * プロジェクト全体検索（Session 3-6-4）の上限と、名前の照合の規則。
 *
 * ## なぜ shared に置くか
 *
 * 上限は契約の一部にあたる。Main が「500 件で打ち切った」と答えたときに、
 * Renderer がその 500 を別の値だと思っていると、案内の文言が実際と食い違う。
 * 打ち切りの有無は応答（truncated / limit）で分かるが、**具体的な数を画面に出すのは
 * Renderer** なので、数そのものは双方が同じものを見る必要がある。
 *
 * 照合の規則（大文字 / 小文字を区別しない部分一致）を置いているのは、
 * fileName.ts の名前の規則・copyName.ts のコピー名の規則と同じ理由 ──
 * **Main が「一致した」と判断した根拠と、Renderer が印を付ける範囲が
 * 同じ規則から出ている必要がある**ため。2箇所に書くと、
 * 一致しているのに印の付かない結果・印の位置がずれた結果が生まれる。
 *
 * ここに実装があるのは shared 層のルールの例外にあたる（fileName.ts と同じ扱い）。
 * 置いているのは純粋な文字列の判断だけで、fs にも Electron にも触れない。
 *
 * ## 全文検索（Session 3-6-5）はここに載せない
 *
 * このファイルが扱うのは**名前**の照合だけ。ファイルの中身に対する照合は
 * 「1件ずつ読む」という別の性質を持ち、上限も別のもの（1ファイルの大きさ・
 * 1ファイルあたりのヒット数）になる ── Session 3-6-5 で足した値と型は
 * すべて contentSearch.ts にあり、**このファイルの値は1つも変えていない**。
 *
 * ただし走査そのものの上限（深さ FILE_SEARCH_MAX_DEPTH・
 * 走査数 FILE_SEARCH_MAX_SCANNED_ENTRIES）は全文検索も同じものを見る。
 * 潜り方が同じである以上、そこだけ別の数を持つ理由が無いため
 * （main/files/searchWorkspaceFileContents.ts）。
 */

/* ------------------------------------------------------------------ 上限 */

/**
 * 検索語の長さの上限。
 *
 * 境界の外（Renderer）から来た値をそのまま走査に使わないための歯止め。
 * 名前そのものの上限（FILE_NAME_MAX_LENGTH = 255）より短くしていないのは、
 * 「長い名前を丸ごと貼り付けて探す」が普通に起きるため。
 */
export const FILE_SEARCH_QUERY_MAX_LENGTH = 255

/**
 * 1回の検索で返す結果の上限。
 *
 * 列挙（FILES_DIRECTORY_MAX_ENTRIES = 5000）より小さくしてある。
 * 列挙は「そのフォルダにあるものを全部見せる」ための数で、
 * こちらは「探しているものが見つかる」ための数 ── 500 件を超えて出しても
 * 利用者は目で追えず、絞り込む方が早い。打ち切ったことは truncated で伝える。
 */
export const FILE_SEARCH_MAX_RESULTS = 500

/**
 * 潜る深さの上限（Workspace root が 0）。
 *
 * 深さは実質的に無制限になりうる（生成物・キャッシュ・リンクの入れ子）。
 * 12 段は、一般的なプロジェクトの構造（src/main/files/... で 3〜5 段）に対して
 * 十分な余裕がある一方、事故のような深さでは止まる。
 */
export const FILE_SEARCH_MAX_DEPTH = 12

/**
 * 1回の検索で見るエントリ数の上限。
 *
 * `.git` / `node_modules` を外していても、生成物を含むプロジェクトでは
 * 数万件に届く。**無制限に列挙しない**ための主要な歯止めがこれにあたる。
 */
export const FILE_SEARCH_MAX_SCANNED_ENTRIES = 50_000

/**
 * 1回の検索に使ってよい時間（ミリ秒）。
 *
 * 件数の上限だけでは足りない ── ネットワークドライブや外付けディスクでは、
 * 少ない件数でも1件あたりが桁違いに遅くなる。「いつ終わるか分からない検索」を
 * 作らないため、時間そのものにも上限を置く。
 */
export const FILE_SEARCH_TIME_BUDGET_MS = 4_000

/**
 * 検索の識別子の長さの上限。
 *
 * 識別子は Renderer が作り、取り消しの要求で同じものを送り返す
 * （shared/ipc/contracts/files.ts）。境界の外から来る文字列なので上限を持たせる。
 */
export const FILE_SEARCH_ID_MAX_LENGTH = 64

/* ------------------------------------------------------------------ 結末 */

/**
 * 検索が終わった理由。
 *
 * 取り消しを失敗にしないのは、**利用者が意図して止めた**か、
 * 新しい検索に置き換わったかのどちらかで、要求が成立しなかったわけではないため
 * （保存の 'stale' と同じ扱い）。
 */
export type FileSearchStatus = 'completed' | 'cancelled'

/**
 * 全部は見ずに打ち切った理由。
 *
 * どれも失敗ではなく「ここまでしか見ていない」という事実で、
 * 利用者の次の一手（絞り込む / 場所を指定する）は理由によって変わる。
 *   results … 結果が多すぎる。語を足せば済む
 *   scanned … 対象のファイルが多すぎる。範囲の指定が要る
 *   time    … 時間が掛かりすぎた。もう一度試すと通ることもある
 *   depth   … 深すぎる場所は見ていない。そこに在るなら見つからない
 */
export type FileSearchLimit = 'results' | 'scanned' | 'time' | 'depth'

/* -------------------------------------------------------------- 名前の照合 */

/** 名前の中で一致した範囲（印を付けるために使う）。 */
export interface FileNameMatch {
  /** 一致の開始位置（名前の先頭からの文字数）。 */
  readonly start: number
  /** 一致した長さ。 */
  readonly length: number
}

/**
 * 大文字 / 小文字を区別しない部分一致。
 *
 * **一致するかを決めるのはこの関数だけ**（Main の走査が呼ぶ）。
 * 空の検索語では常に false を返す ── `''` を含む文字列はすべて一致してしまい、
 * 「Workspace の全ファイルを列挙する」のと同じことになるため。
 */
export function matchesFileNameQuery(name: string, query: string): boolean {
  if (query === '') {
    return false
  }

  return name.toLowerCase().includes(query.toLowerCase())
}

/**
 * 一致した範囲（Renderer が印を付けるために使う）。
 *
 * 一致していても範囲を返さないことがある。小文字へ畳むと**長さが変わる文字**
 * （`İ` は2文字になる）が名前に含まれていると、畳んだ側で求めた位置が
 * 元の名前の位置とずれるため。ずれた位置に印を付けるくらいなら付けない方がよい
 * （一致していること自体は matchesFileNameQuery が答える）。
 */
export function findFileNameMatch(name: string, query: string): FileNameMatch | null {
  if (query === '') {
    return null
  }

  const foldedName = name.toLowerCase()
  const foldedQuery = query.toLowerCase()
  const start = foldedName.indexOf(foldedQuery)

  if (start < 0) {
    return null
  }

  // 畳んだ結果の長さが変わっていれば、位置は元の名前と対応しない。
  if (foldedName.length !== name.length || foldedQuery.length !== query.length) {
    return null
  }

  return { start, length: foldedQuery.length }
}
