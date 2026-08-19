import { FILE_NAME_MAX_LENGTH } from './fileName'
import type { FileEntryType } from './entry'

/**
 * 同じフォルダの中でぶつからない「コピーの名前」の作り方。
 *
 * ```
 * example.txt → example copy.txt → example copy 2.txt → example copy 3.txt
 * src         → src copy         → src copy 2         → src copy 3
 * ```
 *
 * ## なぜ shared に置くか
 *
 * fileName.ts / relativePath.ts と同じ立ち位置で、**OS にも fs にも DOM にも依存しない
 * 純粋な文字列の規則**であり、Main と Renderer が同じ答えを見る必要がある。
 *
 *   Main     … 実際にその名前で作る（衝突したら次の候補へ進む）
 *   Renderer … 何ができるのかを利用者に説明する（貼り付けの案内・将来の複製 / Cut）
 *
 * 2箇所に書くと、片方だけ直された時点で「案内された名前と、実際にできた名前が違う」
 * というずれが生まれる。**Renderer が呼べる ＝ Renderer が決めている、ではない。**
 * どの候補が実際に使われるかは、ディスクに訊ける Main だけが決められる
 * （main/files/mutateWorkspaceEntry.ts の copyWorkspaceEntry）。
 *
 * shared 層のルールに対する例外にあたるが、fileName.ts と同じ理由による
 * （そのファイルの冒頭を参照）。
 *
 * ## 上書きしないための規則であって、上書きしてよいかの判断ではない
 *
 * 同名のものがあったときに**中身を消して置き換えない**のは、作成・改名・移動と揃えた
 * 方針（ARCHITECTURE.md §10.2「上書きしない」）。違うのは、コピーだけは
 * **利用者に名前を訊き直さずに済ませてよい**点で、複製は「同じものをもう1つ」という
 * 操作であり、名前そのものに意味が無いためこの規則が成立する。
 *
 * ## 連番は「見つかった順」ではなく候補の番号
 *
 * `attempt` を受け取るだけで、ディスクを見ない。呼ぶ側が 0 から順に試し、
 * 作れたところで止める（下の COPY_NAME_MAX_ATTEMPTS）。
 * **先に一覧を読んで空き番号を探す形にしない** ── 読んでから作るまでの隙間に
 * 同名のものが現れると、そこで上書きが起きる。「排他で作ってみて、
 * 既にあったら次の候補へ」なら、その隙間が無い。
 *
 * ## 既にある " copy" を数え直さない
 *
 * `example copy.txt` を複製すると `example copy copy.txt` になる。
 * 末尾の " copy" を見て系列の続き（`example copy 2.txt`）にすることもできるが、
 * **利用者が最初からその名前を付けたファイル**と区別が付かない。
 * 付いている名前を勝手に読み替えるより、常に足す方が結果が予測できる。
 */

/** コピーであることを表す語。連番はこの後ろに付く。 */
const COPY_WORD = 'copy'

/**
 * 候補を何番まで試すか。
 *
 * 上限そのものに意味は無く、**作れないまま回り続けないための歯止め**。
 * ここまで埋まっているフォルダは、名前を整理してもらう方が早い
 * （呼ぶ側は already-exists として返す）。
 */
export const COPY_NAME_MAX_ATTEMPTS = 100

/**
 * 名前を「拡張子より前」と「拡張子（先頭のドットを含む）」に分ける。
 *
 * フォルダは分けない ── `my.folder` は `my copy.folder` ではなく
 * `my.folder copy` になってほしい（フォルダ名のドットは拡張子ではない）。
 *
 * ファイルの分け方は fileEntry.ts の deriveExtension と揃える。
 * 先頭のドットだけの名前（`.gitignore`）は拡張子を持たず、
 * 末尾がドットの名前（`notes.`）も分けない。
 */
function splitExtension(
  name: string,
  type: FileEntryType
): { readonly base: string; readonly extension: string } {
  if (type === 'directory') {
    return { base: name, extension: '' }
  }

  const dot = name.lastIndexOf('.')

  if (dot <= 0 || dot === name.length - 1) {
    return { base: name, extension: '' }
  }

  return { base: name.slice(0, dot), extension: name.slice(dot) }
}

/**
 * 末尾を落として、指定した長さ（コードポイント数ではなく文字数）に収める。
 *
 * 落とすのはコードポイント単位。`slice` で切ると絵文字などのサロゲートペアが
 * 途中で割れ、名前として壊れた文字が残る。
 */
function truncateToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  let result = ''

  for (const character of value) {
    if (result.length + character.length > maxLength) {
      break
    }

    result += character
  }

  return result
}

/**
 * `attempt` 番目の候補名。作れなければ（長さに収まらなければ）null。
 *
 * ```
 * attempt 0 … 元の名前そのまま（衝突していなければこれで済む）
 * attempt 1 … "<base> copy<ext>"
 * attempt n … "<base> copy n<ext>"   (n >= 2)
 * ```
 *
 * 長さが上限（FILE_NAME_MAX_LENGTH）を超える場合は**元の名前の方を削る。**
 * 連番を削ると衝突を避けられなくなり、拡張子を削ると別の種類のファイルになる。
 * 削っても収まらない（拡張子と連番だけで上限に達する）場合だけ null を返す。
 *
 * 生成した名前を findFileNameProblem に通す必要は無い。区切り文字や制御文字は
 * 元の名前に無く（既にディスク上に在るものの名前）、足すのは半角空白と英数字だけ。
 * 予約デバイス名にもならない（最初のドットより前が必ず " copy" で終わる）。
 */
export function copyCandidateName(
  name: string,
  type: FileEntryType,
  attempt: number
): string | null {
  if (attempt <= 0) {
    return name.length <= FILE_NAME_MAX_LENGTH ? name : null
  }

  const { base, extension } = splitExtension(name, type)
  const suffix = attempt === 1 ? ` ${COPY_WORD}` : ` ${COPY_WORD} ${attempt}`
  const room = FILE_NAME_MAX_LENGTH - suffix.length - extension.length

  // 拡張子と連番だけで上限に達する。元の名前を1文字も残せないので候補を作れない。
  if (room < 1) {
    return null
  }

  return `${truncateToLength(base, room)}${suffix}${extension}`
}
