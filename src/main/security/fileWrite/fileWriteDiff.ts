/**
 * 行の差分を作る（Security Core v1 の STEP7。Electron にも fs にも依存しない）。
 *
 * **Diff を作るのは Main だけ。** Agent や Renderer が作った Diff を受け取って見せる形に
 * しないのは、「画面に出た変更」と「実際に書かれる変更」が別々の計算から生まれると、
 * 一致を確かめる術が無くなるため（DESIGN.md §6.4）。
 *
 * ```
 * 既存ファイル   今ディスクにある中身  vs  提案された中身
 * 新しいファイル 空                    vs  提案された中身
 * ```
 *
 * ## Diff は表示のためだけの値
 *
 * ここが返すのは**画面に出す行の並び**で、書く中身の Source of Truth ではない。
 * 書くのは Main が持つ exact な提案本文で、承認の binding（STEP6 の fingerprint）も
 * そちらから作る。Diff を作れなかった場合は書き込みを拒否する（`diff-failed`）が、
 * それは「利用者が内容を確かめられないまま承認させない」ためであって、
 * Diff が Security の判断材料だからではない。
 *
 * ## 行の切り方
 *
 * 区切るのは `\n` だけで、**行末の `\r` は落とさない。** CRLF のファイルへ LF の本文を
 * 提案したとき、落としてしまうと「1行も変わっていない」ように見えるのに、書いた後の
 * ファイルは全行が変わっている、という食い違いが生まれる。見た目に出ない違いは
 * safeFileWriteDiff.ts が目に見える印へ置き換える。
 *
 * ## 大きさで諦める
 *
 * 行数が上限を超えるものは、LCS を諦めて「全部消して全部足す」形にする。
 * 行数 × 行数 の表を作るため、大きなファイルでそのまま動かすと現実的な時間で
 * 終わらない。**諦めた場合も内容は落とさない**（見にくくはなるが、変更の全体は出る）。
 */

/** 差分の行1つ（Mask 前・切る前の生の行）。 */
export interface DiffLine {
  readonly kind: 'context' | 'added' | 'removed'
  readonly oldLine: number | null
  readonly newLine: number | null
  readonly text: string
}

/**
 * LCS を計算する上限（行数）。
 *
 * 超えたら「全部消して全部足す」へ倒す。2000 × 2000 の表で 400 万要素になり、
 * 承認の画面を出すまでの間に収まる範囲として置いてある。
 */
export const DIFF_LCS_MAX_LINES = 2000

/**
 * 変更前と変更後の本文から、行の差分を作る。
 *
 * どちらも文字列であること。**例外を投げない**（呼び出し側は `null` を
 * `diff-failed` として拒否する）。
 */
export function createLineDiff(before: unknown, after: unknown): readonly DiffLine[] | null {
  if (typeof before !== 'string' || typeof after !== 'string') {
    return null
  }

  try {
    const oldLines = splitLines(before)
    const newLines = splitLines(after)

    if (oldLines.length > DIFF_LCS_MAX_LINES || newLines.length > DIFF_LCS_MAX_LINES) {
      return Object.freeze(replaceAll(oldLines, newLines))
    }

    return Object.freeze(walk(oldLines, newLines, longestCommonSubsequence(oldLines, newLines)))
  } catch {
    return null
  }
}

/**
 * 本文を行へ分ける。
 *
 * 空文字は「行が1つも無い」（新しいファイルの変更前）。末尾の改行は最後の空行を
 * 作らない ── `a\n` と `a` を同じに見せると、改行の有無の変更が Diff に出ない、
 * の逆で、**出しすぎる**方を避ける（どのエディタも末尾の改行を1行としては数えない）。
 *
 * **Diff と Mask は同じ切り方を使う**（safeFileWriteDiff.ts が本文全体に対して
 * 見つけた Secret を行へ割り当てるため）。切り方が2つあると、行番号がずれる。
 */
export function splitLines(text: string): readonly string[] {
  if (text === '') {
    return []
  }

  const lines = text.split('\n')

  // `a\n` → ['a', ''] の最後を落とす。`a\n\n` → ['a', ''] は残す。
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines
}

/** 全部消して全部足す（LCS を諦めたとき）。 */
function replaceAll(oldLines: readonly string[], newLines: readonly string[]): DiffLine[] {
  const lines: DiffLine[] = []

  oldLines.forEach((text, index) => {
    lines.push(line('removed', index + 1, null, text))
  })

  newLines.forEach((text, index) => {
    lines.push(line('added', null, index + 1, text))
  })

  return lines
}

/**
 * 最長共通部分列の長さの表。
 *
 * `table[i][j]` は「変更前の i 行目以降」と「変更後の j 行目以降」で一致させられる
 * 最大の行数。後ろから埋めると、前から辿るだけで並びが決まる。
 */
function longestCommonSubsequence(
  oldLines: readonly string[],
  newLines: readonly string[]
): readonly (readonly number[])[] {
  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0)
  )

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  return table
}

/**
 * 表を前から辿って行を並べる。
 *
 * 一致しないときに**消す側を先**に出すのは、同じ位置の変更が
 * 「消した行 → 足した行」の順に並ぶ方が読みやすいため（git と同じ並び）。
 */
function walk(
  oldLines: readonly string[],
  newLines: readonly string[],
  table: readonly (readonly number[])[]
): DiffLine[] {
  const lines: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      lines.push(line('context', i + 1, j + 1, oldLines[i]))
      i += 1
      j += 1
      continue
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(line('removed', i + 1, null, oldLines[i]))
      i += 1
      continue
    }

    lines.push(line('added', null, j + 1, newLines[j]))
    j += 1
  }

  while (i < oldLines.length) {
    lines.push(line('removed', i + 1, null, oldLines[i]))
    i += 1
  }

  while (j < newLines.length) {
    lines.push(line('added', null, j + 1, newLines[j]))
    j += 1
  }

  return lines
}

function line(
  kind: DiffLine['kind'],
  oldLine: number | null,
  newLine: number | null,
  text: string
): DiffLine {
  return Object.freeze({ kind, oldLine, newLine, text })
}
