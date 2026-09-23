import type { SafeDiffLine, SafeFileWriteDiff } from '@shared/security'
import { createLineDiff, type DiffLine } from './fileWriteDiff'
import { maskSecretLines } from './secretLineMask'

/**
 * 差分を、Renderer へ送ってよい形にする（Security Core v1 の STEP7。Electron にも fs にも依存しない）。
 *
 * **ここが Diff 専用の Sanitize 境界にあたる。** Renderer へ渡る前に必ず通り、
 *
 * ```
 * 1. 1行ずつ STEP3 の maskSecretText を通す（Secret の値を画面へ出さない）
 * 2. 制御文字を目に見える印へ置き換える（ANSI・CR・行区切りで表示を組み替えさせない）
 * 3. 1行の長さで切る
 * 4. 行数で切る
 * ```
 *
 * を行う。**Secret ファイル自体は、ここへ来る前に Gate が拒否している**
 * （STEP3 の名前の判定。`.env` の Diff は作らない）。ここで伏せるのは、普通のファイルの
 * 中身に混ざった Secret にあたる。
 *
 * ## 実際に書く中身は伏せない
 *
 * 伏せるのは**表示用の Diff だけ。** 書く中身を Mask 済みのものへ置き換えると、
 * 「承認した変更」と「書かれた変更」が別物になり、Secret のある行を Agent が
 * `***REDACTED***` で上書きしてしまう。Gate は exact な提案本文を別に持ち、
 * 承認の binding もそちらから作る（DESIGN.md §6.4）。
 *
 * ## Secret は本文全体で探す
 *
 * 伏せるのは行単位だが、**探すのは本文全体**にあたる（secretLineMask.ts）。
 * 1行ずつ検査すると、複数行にまたがる Secret（Private Key block）が素通りする ──
 * 鍵の本体だけの行は、単独で見れば「Base64 らしき文字列」でしかない。
 * かといって本文をまとめて伏せると、block 全体が伏せ字1つに畳まれて**行数が変わり**、
 * Diff の行番号と対応が取れなくなる。
 */

/** 画面に出す行数の上限。 */
export const SAFE_DIFF_MAX_LINES = 400

/** 1行の長さの上限（文字数）。 */
export const SAFE_DIFF_LINE_MAX_LENGTH = 300

/** 切ったことを示す印。 */
export const SAFE_DIFF_TRUNCATION_MARK = '…'

/**
 * 制御文字の置き換え先。
 *
 * 消すのではなく**印を残す** ── 消すと「見えない文字が入っている行」と
 * 「普通の行」が画面で同じに見え、Diff を読んで承認する意味が薄れる。
 */
export const SAFE_DIFF_CONTROL_MARK = '␀'

/**
 * 変更前と変更後の本文から、Renderer へ送ってよい Diff を作る。
 *
 * 作れなければ `null`（呼び出し側は `diff-failed` として拒否する）。**例外を投げない。**
 */
export function createSafeFileWriteDiff(before: unknown, after: unknown): SafeFileWriteDiff | null {
  const diff = createLineDiff(before, after)

  if (diff === null || typeof before !== 'string' || typeof after !== 'string') {
    return null
  }

  try {
    return build(diff, maskSecretLines(before), maskSecretLines(after))
  } catch {
    return null
  }
}

function build(
  diff: readonly DiffLine[],
  maskedBefore: { readonly lines: readonly string[]; readonly masked: boolean },
  maskedAfter: { readonly lines: readonly string[]; readonly masked: boolean }
): SafeFileWriteDiff {
  let addedCount = 0
  let removedCount = 0

  for (const line of diff) {
    if (line.kind === 'added') {
      addedCount += 1
    } else if (line.kind === 'removed') {
      removedCount += 1
    }
  }

  const kept = diff.slice(0, SAFE_DIFF_MAX_LINES)
  const lines: SafeDiffLine[] = []

  for (const line of kept) {
    lines.push(
      Object.freeze({
        kind: line.kind,
        oldLine: line.oldLine,
        newLine: line.newLine,
        text: safeLine(maskedTextOf(line, maskedBefore.lines, maskedAfter.lines))
      })
    )
  }

  return Object.freeze({
    lines: Object.freeze(lines),
    addedCount,
    removedCount,
    truncated: diff.length > kept.length,
    secretMasked: maskedBefore.masked || maskedAfter.masked
  })
}

/**
 * 行1つに対応する、伏せた後の文字列。
 *
 * 消された行は**変更前**から、足された行と変わらない行は**変更後**から採る。
 * 対応する行が無ければ伏せ字（行の対応が崩れているときに、伏せていない文字を
 * 出さないため）。
 */
function maskedTextOf(line: DiffLine, before: readonly string[], after: readonly string[]): string {
  const source = line.kind === 'removed' ? before : after
  const number = line.kind === 'removed' ? line.oldLine : line.newLine

  if (number === null || number < 1 || number > source.length) {
    return SAFE_DIFF_TRUNCATION_MARK
  }

  return source[number - 1]
}

/**
 * 行1つを、画面に出してよい文字列にする。
 *
 * **伏せるのは済んでいる**（secretLineMask.ts）。ここでするのは、制御文字を潰して
 * 長さで切るところまで。順番が逆にならないのが要点で、先に切ると切れ目をまたいだ
 * Secret の前半が残る（auditRecord.ts と同じ順）。
 */
function safeLine(text: string): string {
  const visible = replaceControlCharacters(text)

  if (visible.length <= SAFE_DIFF_LINE_MAX_LENGTH) {
    return visible
  }

  // 切った端で文字が割れないよう、コードポイントの単位で数える。
  const kept = [...visible]
    .slice(0, SAFE_DIFF_LINE_MAX_LENGTH - SAFE_DIFF_TRUNCATION_MARK.length)
    .join('')

  return `${kept}${SAFE_DIFF_TRUNCATION_MARK}`
}

/**
 * 制御文字を印へ置き換える。
 *
 * 対象は C0（タブを除く）・DEL・行区切り（U+2028 / U+2029）・双方向の上書き
 * （U+202A〜U+202E・U+2066〜U+2069）。**Diff の中身で画面の並びを組み替えさせない**
 * ための措置にあたる ── CR で行頭へ戻す、ESC で色や位置を変える、双方向の制御で
 * 見た目の順序を入れ替える、のどれも「承認した内容と違うものを見せる」ことに使える。
 *
 * タブだけは残す（インデントを潰すと、Diff がそもそも読めなくなる）。
 */
function replaceControlCharacters(text: string): string {
  let result = ''

  for (const character of text) {
    result += isDangerousCharacter(character) ? SAFE_DIFF_CONTROL_MARK : character
  }

  return result
}

/**
 * その文字が、画面の並びを組み替えるのに使えるか。
 *
 * 文字の集合を**コードポイントの数**で書いてある。正規表現の文字クラスに
 * U+2028 / U+2029 をそのまま入れると、**ソースの行がそこで終わったことになる**
 * （JavaScript の行終端にあたる）。数で比べる形なら、その危険が無い。
 */
function isDangerousCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0

  // タブだけは残す（インデントを潰すと Diff が読めなくなる）。
  if (code === 0x09) {
    return false
  }

  return (
    code <= 0x1f ||
    code === 0x7f ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}
