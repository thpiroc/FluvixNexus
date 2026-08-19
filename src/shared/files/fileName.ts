/**
 * ファイル / フォルダ名として受け付ける形。
 *
 * ## なぜ shared に置くか
 *
 * 判断の正本は Main 側にある（Renderer から届いた名前をそのまま fs へ渡さない）。
 * それでも Renderer は、入力中にその場で「この名前は使えない」を出せる必要がある
 * ── 1文字打つたびに IPC を往復させるわけにはいかないため。
 *
 * 2箇所に同じ規則を書くと、片方だけ直された時点で「UI は通すのに Main が弾く」
 * （あるいはその逆）というずれが生まれる。規則そのものは OS にも DOM にも依存しない
 * 純粋な文字列の判断なので、shared に1つだけ置いて両者が同じ答えを見る形にする
 * （ipc/result.ts の ipcSuccess / ipcFailure と同じ立ち位置）。
 *
 * **Renderer が通した ＝ 許可された、ではない。** Main は Renderer を信じず、
 * 受け取った名前を必ずこの関数へ通してから fs を触る
 * （main/files/mutateWorkspaceEntry.ts）。ここにあるのは共有された規則であって、
 * 検査を Renderer へ委譲したわけではない。
 *
 * ## Windows の規則を全 OS で適用する
 *
 * v1 の対象は Windows だが、判断を OS で分岐させない。分岐させると、Mac で作った
 * `aux.ts` を Windows で開いた瞬間に扱えないファイルが現れる。**どの OS でも作れる名前**
 * だけを受け付ける方が、プロジェクトを持ち歩く道具として素直に振る舞う。
 *
 * ## 「作れる名前か」と「指せる名前か」は別
 *
 * 上の規則は**これから付ける名前**に対するもので、そのまま既存のものへ適用してはいけない。
 * `aux.ts` を作らせないことと、既にそこに在る `aux.ts` を消させないことは別の話で、
 * 後者は守るものが何も無いのに手が出せないファイルを作るだけになる
 * （Mac で作られた `aux.ts` を含むリポジトリを clone すれば実際に起きる）。
 *
 *   findFileNameProblem      … これから付ける名前（作成 / 改名の新しい名前）
 *   findExistingNameProblem  … 既に在るものを指す名前（削除 / 改名の元）
 *
 * 後者は「1階層ぶんの名前として成立しているか」だけを見る。
 */

/**
 * 名前の長さの上限。
 *
 * NTFS / ext4 / APFS のいずれも 255。パス全体の上限
 * （FILES_RELATIVE_PATH_MAX_LENGTH）はそれとは別に効く。
 */
export const FILE_NAME_MAX_LENGTH = 255

/**
 * 受け付けない理由。
 *
 * 「使えない」だけでは直しようがないため、何が引っかかったかを区別して返す。
 * 文言は Renderer 側が決める（renderer/src/files/filesError.ts）。
 */
export type FileNameProblem =
  /** 空、または空白だけ。 */
  | 'empty'
  /** 255 文字を超える。 */
  | 'too-long'
  /** 記号（`\ / : * ? " < > |`）または制御文字を含む。 */
  | 'invalid-characters'
  /** `.` / `..`。フォルダの位置を指す記号であって名前ではない。 */
  | 'dot-name'
  /** 末尾が `.` か空白（Windows では作れても意図した名前にならない）。 */
  | 'trailing-character'
  /** Windows の予約デバイス名（CON / PRN / AUX / NUL / COM1-9 / LPT1-9）。 */
  | 'reserved'

/**
 * Windows の予約デバイス名。
 *
 * 拡張子を付けても予約は解けない（`con.txt` も作れない）ため、
 * 最初のドットより前の部分だけを見て突き合わせる。
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

/**
 * 名前に使えない記号。
 *
 * 区切り文字（`/` `\`）を含めてあるため、この検査が「名前は必ず1階層ぶん」の
 * 担保にもなる。`..` だけを弾く形にすると `sub/name` のような入力が通り、
 * 作成先が呼び出し側の思っている場所とずれる。
 */
const INVALID_SYMBOLS = '\\/:*?"<>|'

/** 制御文字（NUL・DEL を含む）はファイル名として扱わない。 */
function isControlCharacter(codePoint: number): boolean {
  return codePoint < 0x20 || codePoint === 0x7f
}

function hasInvalidCharacter(name: string): boolean {
  for (const character of name) {
    if (INVALID_SYMBOLS.includes(character)) {
      return true
    }

    const codePoint = character.codePointAt(0)

    if (codePoint !== undefined && isControlCharacter(codePoint)) {
      return true
    }
  }

  return false
}

/**
 * **既に在るもの**を1階層ぶんの名前として指せるか（問題が無ければ null）。
 *
 * 見るのは「その文字列が名前として成立しているか」だけ。
 *
 *   - 空でない
 *   - 長さが上限に収まる
 *   - 区切り文字・記号・制御文字を含まない ── これが「必ず1階層ぶん」の担保
 *   - `.` / `..` ではない ── 位置を指す記号であって名前ではない
 *
 * **これから作れる名前かどうかは見ない。** 予約デバイス名や末尾のドット / 空白は、
 * 「新しく付ける名前としては避けたい」だけで、**ディスク上に実在してはいけない
 * わけではない**（`aux.ts` は Mac / Linux で普通に作れるし、Windows でも
 * 拡張された表記なら作れる）。実在するものを消せない・改名できないのは、
 * ツリーに並んでいるのに手が出せないものが残るということで、
 * 名前の規則が守ろうとしていたものとは無関係な不便になる。
 *
 * 削除の対象を指すときはこちらを使う（main/files/mutateWorkspaceEntry.ts）。
 */
export function findExistingNameProblem(name: string): FileNameProblem | null {
  if (name.length === 0) {
    return 'empty'
  }

  if (name.length > FILE_NAME_MAX_LENGTH) {
    return 'too-long'
  }

  if (hasInvalidCharacter(name)) {
    return 'invalid-characters'
  }

  if (name === '.' || name === '..') {
    return 'dot-name'
  }

  return null
}

/**
 * **これから付ける名前**として受け付けられない理由を返す（問題が無ければ null）。
 *
 * 作成と改名（新しい名前の側）が使う。名前として成立しているか
 * （findExistingNameProblem）に加えて、「どの OS でも作れる形か」まで見る。
 *
 * 前後の空白は呼び出し側が落としてから渡すこと（normalizeFileName）。
 * ここでは受け取った文字列をそのまま見る。
 */
export function findFileNameProblem(name: string): FileNameProblem | null {
  const problem = findExistingNameProblem(name)

  if (problem !== null) {
    return problem
  }

  /*
    末尾のドット・空白は Windows が黙って落とすため、「付けたつもりの名前」と
    ディスク上の名前がずれる。ずれるくらいなら受け付けない。
  */
  if (name.endsWith('.') || name.endsWith(' ')) {
    return 'trailing-character'
  }

  const base = name.split('.')[0] ?? name

  if (RESERVED_NAMES.has(base.toLowerCase())) {
    return 'reserved'
  }

  return null
}

/**
 * 入力欄から受け取った名前を、判定に掛ける形へ揃える。
 *
 * 落とすのは前後の空白だけ。中の空白は正当な名前の一部（`my file.txt`）のため残す。
 */
export function normalizeFileName(raw: string): string {
  return raw.trim()
}
