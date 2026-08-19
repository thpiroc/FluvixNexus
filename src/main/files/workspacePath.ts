import { isAbsolute, parse, resolve, sep } from 'path'
import { FILES_RELATIVE_PATH_MAX_LENGTH } from '@shared/files'
import { isWindows } from '../platform'

/**
 * Workspace の中を指す相対位置の扱い（パス文字列に対する判断だけ）。
 *
 * workspaceFolder/folderPath.ts と同じ立ち位置で、Electron にも fs にも依存しない
 * 純粋な関数だけを持つ（＝テストできる形にしておく）。実際にディスクを見るのは
 * files/readWorkspaceDirectory.ts。
 *
 * ## ここが Workspace の境界そのもの
 *
 * Renderer に公開しているのは「Workspace の中の相対位置」だけだが、その文字列は
 * 境界の外から来る。`..` を混ぜる、絶対パスを渡す、ドライブ相対（`C:foo`）を渡す、
 * といった手で外へ出られないことを、**ここで文字列として**確かめる。
 *
 * 文字列だけでは足りないものが1つある。**symlink / ジャンクション**は、
 * 正しい相対位置のまま指し先が外にあるため、パスを見るだけでは分からない。
 * これは実際に解決してみる必要があるので readWorkspaceDirectory.ts が
 * realpath を取ってから isInsideWorkspace() を通す。文字列の検査と実体の検査は
 * どちらか一方では足りず、両方を通して初めて「外へ出られない」と言える。
 *
 * OS 依存の判定（区切り文字・ドライブレター）は node の path に委ねる。
 */

/**
 * Renderer から届いた相対位置を、扱ってよい形へ正規化する。
 *
 * 受け付けないものは null を返す（呼び出し側が INVALID_REQUEST として扱う）。
 *   - 文字列でない / 桁違いに長い / NUL を含む
 *   - 絶対パス（`/foo` `C:\foo` `\\server\share`）
 *   - ドライブ相対（`C:foo`）や代替データストリーム（`name:stream`）── `:` を含むもの
 *   - `..` を含む
 *
 * 戻り値の区切りは常に `/`。空文字は Workspace root を指す。
 *
 * **`..` を「解決して外に出ていなければ許す」形にしていない。** `a/../b` は
 * resolve すれば内側に収まるが、受け付ける理由が無い。判断を単純に保つほど、
 * 後から穴が空きにくい。
 *
 * ## 判定に使う文字列と、実際に指されている名前を混ぜない
 *
 * **相対位置そのものを trim しない。** 前後に空白を含む名前（`notes.txt `）は
 * ディスク上に実在しうる ── Windows のエクスプローラからは作れなくても、
 * 他の OS で作られたものを持ち込めばツリーに普通に並ぶ。ここで空白を落とすと、
 * **利用者が指した `notes.txt ` が別のファイル `notes.txt` に化ける。**
 * 削除や改名のような戻せない操作でそれが起きると、結末は「操作が失敗する」では済まない。
 *
 * trim を使うのは**判定のためだけ**にする（下の `probe`）。
 *
 *   - 空白だけの入力は「位置を言っていない」＝ root と読む
 *   - 空白で囲めば絶対パスの検査をすり抜けられる、という抜け道を作らない
 *
 * 判定は trim した写しに対して行い、**戻り値は必ず生の文字列から組み立てる。**
 * こうすると弾く範囲は広いまま（trim した方が絶対パスと見なす形は多い）、
 * fs へ渡す名前だけが手つかずで残る。
 */
export function normalizeWorkspaceRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  if (raw.length > FILES_RELATIVE_PATH_MAX_LENGTH || raw.includes('\0')) {
    return null
  }

  /*
    判定のためだけの写し。ここから戻り値を作らない
    （作った瞬間に「利用者が指した名前」と「検証用の文字列」が混ざる）。
  */
  const probe = raw.trim()

  if (probe.length === 0) {
    return ''
  }

  // 絶対パスは相対位置として解釈しない（黙って root からの相対に読み替えると、
  // 「弾いたつもりが別の場所を指していた」という一番危ない読み替えになる）。
  // ` C:\Windows` のように空白で囲まれた形も同じ扱いにするため、写しの側で見る。
  if (isAbsolute(probe) || parse(probe).root !== '' || isAbsolute(raw) || parse(raw).root !== '') {
    return null
  }

  // 区切るのは生の文字列。要素の中にある空白は名前の一部として残す。
  const segments = raw.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.')

  // `:` は POSIX 上では isAbsolute にも parse().root にも掛からないため、ここで弾く
  // （Windows でドライブ相対や代替データストリームになる形を、OS を問わず受け付けない）。
  if (segments.some((segment) => isNavigationSegment(segment) || segment.includes(':'))) {
    return null
  }

  return segments.join('/')
}

/**
 * その要素が「名前」ではなく「位置の指定」にあたるか。
 *
 * `..` そのものに加えて、**末尾のドット / 空白を落とすと `.` `..` になる形**も同じ扱いにする
 * （`.. ` `..` + 空白、` ..`、`...`、`. ` など）。
 *
 * Windows は本来この落とし方をするため、`root\.. ` が root の親を指しうる。
 * 実際には node が拡張表記でファイルシステムを叩くので、この環境では
 * `.. ` という名前の要素として扱われ外へは出ない ── が、**境界の判断を
 * その細かさに依存させない。** 実体側の検証（realpath → isInsideWorkspace）も
 * 効いているので二重になるが、ここで弾いておく方が判断が単純に保てる。
 *
 * 落としきると空になる要素（`   ` や `...`）も同じく受け付けない。
 * どのみち Windows では指せない名前で、通す理由が無い。
 *
 * 落とした結果が空でなければ**生の要素をそのまま使う**。`notes.txt ` は
 * `notes.txt` に化けるのではなく、`notes.txt ` のまま通る。
 */
function isNavigationSegment(segment: string): boolean {
  return segment.replace(/[. ]+$/, '') === ''
}

/**
 * Workspace root と相対位置から、実際に触ってよい絶対パスを作る。
 *
 * 正規化済みの相対位置を渡すこと（normalizeWorkspaceRelativePath の戻り値）。
 * それでも結果を isInsideWorkspace で確かめてから返すのは、
 * 「検証した文字列」と「実際に fs へ渡すパス」が同じ手順から出てきたことを
 * この関数の中で閉じるため。外に出るなら null を返す。
 */
export function resolveWorkspacePath(rootPath: string, relativePath: string): string | null {
  const absolute = relativePath === '' ? resolve(rootPath) : resolve(rootPath, relativePath)

  return isInsideWorkspace(rootPath, absolute) ? absolute : null
}

/**
 * その絶対パスが Workspace root の中（root 自身を含む）にあるか。
 *
 * 境界の判定はすべてこれを通る。中身は一般の「配下か」の判定（isAtOrUnderPath）で、
 * **名前を分けてあるのは呼ぶ側の意図が違うため** ── ここは Workspace の境界を
 * 越えていないかを訊いており、移動先が移動するもの自身の中にないかを訊く場面
 * （mutateWorkspaceEntry.ts）とは、同じ計算でも意味が別になる。
 */
export function isInsideWorkspace(rootPath: string, absolutePath: string): boolean {
  return isAtOrUnderPath(rootPath, absolutePath)
}

/**
 * `absolutePath` が `ancestorPath` そのものか、その配下にあるか。
 *
 * 前方一致で見るときは**区切り文字まで含めて**比べる。`D:\proj` と `D:\project` のように、
 * 文字列としては前方一致でも別のフォルダであるものを通してしまわないため。
 *
 * 渡すのは realpath まで解決したパス。文字列としての判定しかしないため、
 * symlink / ジャンクションを混ぜたまま渡すと「配下ではない」と答えてしまう。
 */
export function isAtOrUnderPath(ancestorPath: string, absolutePath: string): boolean {
  const ancestor = normalizeForComparison(ancestorPath)
  const target = normalizeForComparison(absolutePath)

  if (target === ancestor) {
    return true
  }

  return target.startsWith(`${ancestor}${sep}`)
}

/**
 * 2つの絶対パスが同じ場所を指すか。
 *
 * 「移動先が今いるフォルダと同じ」（＝何もしなくてよい）を判断するのに使う。
 * 相対位置の文字列どうしで比べないのは、**別の相対位置が同じ実体を指しうる**ため
 * （途中にジャンクションを挟めば `link/x` と `real/x` は同じ場所になる）。
 */
export function isSamePath(a: string, b: string): boolean {
  return normalizeForComparison(a) === normalizeForComparison(b)
}

/**
 * 比較のための表記に揃える。
 *
 * Windows では大文字小文字を区別しない。realpath は実際のディスク上の表記
 * （ドライブレターの大小を含む）を返すため、区別すると同じ場所を別物と判定してしまう。
 */
function normalizeForComparison(value: string): string {
  const resolved = stripTrailingSeparator(resolve(value))

  return isWindows ? resolved.toLowerCase() : resolved
}

/** ドライブ直下（`D:\`）のように区切りで終わるパスを、比較できる形に揃える。 */
function stripTrailingSeparator(value: string): string {
  return value.length > 1 && value.endsWith(sep) ? value.slice(0, -1) : value
}
