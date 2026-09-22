import { normalizeWorkspaceRelativePath } from '../../files/workspacePath'

/**
 * Agent から届いたパス文字列の検査（Security Core v1 の STEP2。fs にも Electron にも依存しない）。
 *
 * ## 既存の検査に**足す**だけ
 *
 * 文字列としての Workspace 境界は files/workspacePath.ts の
 * normalizeWorkspaceRelativePath() が持っている（`..`・絶対パス・`C:foo`・`name:stream`・
 * NUL・長さの上限・末尾のドット / 空白で `..` になる要素）。Editor の Files と Agent で
 * 判断を二重に持たないため、ここはそれを**必ず先に通し**、その上で Agent にだけ課す
 * 条件を足す。弾く範囲は既存より広くなることはあっても、狭くなることは無い。
 *
 * ## Agent にだけ足す条件
 *
 * Agent の出すパスは利用者がツリーから選んだものではなく、LLM が組み立てた文字列になる。
 * 実在しうる名前を通す必要が薄い一方、**Windows が別の意味に読み替えうる形**を
 * 1つでも通すと境界の判断がその読み替えに依存してしまう。そこで次を OS を問わず拒む。
 *
 *   - 先頭が `/` か `\`（UNC `\\server\share`・デバイス `\\?\` `\\.\`・ルート相対 `\foo`）
 *     ── POSIX では path.parse が root と見なさないため、既存の検査だけでは
 *     `\\server\share` が `server/share` という相対位置として通る
 *   - Windows がファイル名に使えない文字（`< > " | ? *`）と制御文字
 *     ── `?` `*` はワイルドカード、`\\?\` の `?` でもある
 *   - 末尾がドットか空白の要素（`.env.`・`.env `）
 *     ── Win32 の通常の経路はこれを落として `.env` と読む。Node は拡張表記で
 *     叩くので別の名前になるが、「同じファイルを別の綴りで指せる」形は Secret の判定
 *     （STEP3）を名前の綴りに依存させる
 *   - 予約デバイス名（`CON`・`NUL`・`COM1`・`nul.txt` など）
 *     ── ファイルではなくデバイスを指しうる。読むと止まる・書くと消えるものがある
 *
 * `:` を含む要素（ドライブ相対・代替データストリーム）は既存の検査が弾く。
 *
 * ## ここで保証しないもの
 *
 * 文字列が正しくても、symlink / ジャンクションで外を指すことはできる。
 * それは実体を見る workspaceBoundary.ts が確かめる。この関数を通ったことは
 * 「Workspace の中」を意味しない。
 */

/** Windows がファイル名に使えない文字と制御文字（`:` `\` `/` は別の場所で扱う）。 */
const FORBIDDEN_CHARACTERS = /[<>"|?*\u0000-\u001f]/

/**
 * Windows の予約デバイス名。拡張子が付いても（`nul.txt`）、名前の後ろに空白があっても
 * （`con .txt`）デバイスとして読まれうる。
 * 数字の付くものは上付きの ¹²³ も同じ扱いになる。
 */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)$/i

/**
 * Agent から届いた相対位置を、Boundary が扱ってよい形へ正規化する。
 *
 * 受け付けないものは null。戻り値の区切りは常に `/`、空文字は Workspace root を指す
 * （normalizeWorkspaceRelativePath と同じ形）。
 */
export function normalizeAgentRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  // 空白で囲んでも抜けられないよう、判定は trim した写しでも行う（既存の検査と同じ考え方）。
  if (startsFromRoot(raw) || startsFromRoot(raw.trim())) {
    return null
  }

  const relativePath = normalizeWorkspaceRelativePath(raw)

  if (relativePath === null) {
    return null
  }

  if (relativePath === '') {
    return ''
  }

  return relativePath.split('/').every(isAcceptableAgentSegment) ? relativePath : null
}

function startsFromRoot(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\')
}

function isAcceptableAgentSegment(segment: string): boolean {
  if (FORBIDDEN_CHARACTERS.test(segment)) {
    return false
  }

  if (/[. ]$/.test(segment)) {
    return false
  }

  return !isReservedDeviceName(segment)
}

/** 最初のドットより前（後ろの空白は落とす）が予約デバイス名か。 */
function isReservedDeviceName(segment: string): boolean {
  const stem = segment.split('.')[0].replace(/ +$/, '')

  return RESERVED_DEVICE_NAME.test(stem)
}
