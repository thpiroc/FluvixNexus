import { StringDecoder } from 'string_decoder'
import type { SafeTerminalOutputDisplay } from '@shared/security'
import { maskSecretText, SECRET_SCAN_MAX_CHARS } from '../secret/secretMasking'
import type { SecretCategory } from '../secret/secretPatterns'

/**
 * コマンドの出力を集め、Secret を伏せてから渡せる形にする（Security Core v1 の STEP8。
 * Electron にも fs にも依存しない）。
 *
 * **Secret Masking を最優先する**（2026-09-23 確定）。出力は Agent にも画面にも渡るが、
 * どちらへも**伏せた後のもの**しか出さない。Audit へは出力を1文字も渡さない。
 *
 * ```
 * 集める     stdout と stderr を届いた順に1本へ。先頭から 1,000,000 文字まで
 * 整える     端末の制御（色・カーソル移動）と見えない文字を取り除く
 * 伏せる     まとめて maskSecretText（STEP3）
 * 切る       画面へは、伏せた後の末尾 200 行・1行 300 文字まで
 * ```
 *
 * ## 集めるのは「先頭から」（末尾からではない）
 *
 * 長い出力の末尾だけを残すと、切れ目が Private Key block の途中に来たとき
 * `-----BEGIN … PRIVATE KEY-----` の行が落ち、**鍵の本体だけが残って検出をすり抜ける**
 * （本体の行は単独では Base64 らしき文字列でしかない）。先頭から集めれば、BEGIN を
 * 見た block は END が切れていても「そこから末尾まで」伏せられる（STEP3 の規則）。
 * 上限は STEP3 の `SECRET_SCAN_MAX_CHARS` と同じ値で、**検査できる範囲を超えて
 * 集めない**（超えた分は読み捨て、`truncated` で知らせる）。
 *
 * ## 切れ目の語は落としてから伏せる
 *
 * 上限で切った場合、最後の語は途中で切れている。`ghp_…` の token が半分だけ残ると
 * 形が合わずに検出されず、**前半だけが平文で出る。** Audit（STEP4）と同じく、
 * 切れ目にかかった語（最後の空白より後ろ）は落としてから伏せる。
 *
 * ## 整えてから伏せる
 *
 * 色の制御（`ESC[31m`）やゼロ幅の文字が token の途中に挟まると、検出の形が崩れる。
 * **取り除いてから**検査する（置き換えて残すと、その印が token を分断する）。
 *
 * ## 画面へ出すのは、伏せた後に切ったもの
 *
 * 切るのは必ず伏せた後（STEP4 と同じ順）。行を切った端で伏せ字が割れても、
 * 元の値が戻ることはない。
 *
 * ## 分からなければ出さない
 *
 * 検査が落ちた（`unscanned`）・想定外の例外、はどれも**出力を丸ごと渡さない**
 * （`withheld`）。未検査の文字を「たぶん大丈夫」で出す経路は無い。
 */

/** 集める上限（文字数）。STEP3 の検査上限と同じ。 */
export const TERMINAL_OUTPUT_MAX_CHARS = SECRET_SCAN_MAX_CHARS

/** 画面に出す行数の上限（末尾から）。 */
export const TERMINAL_OUTPUT_DISPLAY_MAX_LINES = 200

/** 画面に出す1行の上限（文字数）。STEP7 の Diff と同じ。 */
export const TERMINAL_OUTPUT_DISPLAY_MAX_LINE_LENGTH = 300

/** 切ったことを示す印。 */
const TRUNCATION_MARK = '…'

/** 集めた出力（まだ伏せていない）。**この module の外へは出さない。** */
export interface CapturedTerminalOutput {
  readonly text: string
  /** 上限を超えて、後ろを読み捨てたか。 */
  readonly truncated: boolean
}

/** 伏せた後の出力。Agent へ返してよいのはこれだけ。 */
export interface SafeTerminalOutput {
  /** 伏せた後の全文（`withheld` なら空）。 */
  readonly text: string
  /** 集める上限で後ろを読み捨てたか。 */
  readonly truncated: boolean
  /** Secret を1つ以上伏せたか。 */
  readonly secretMasked: boolean
  readonly maskedCount: number
  readonly categories: readonly SecretCategory[]
  /** 検査できなかったため、出力を丸ごと渡さなかったか。 */
  readonly withheld: boolean
}

export interface TerminalOutputCollector {
  readonly append: (stream: 'stdout' | 'stderr', chunk: Buffer) => void
  readonly finish: () => CapturedTerminalOutput
}

/**
 * 出力を集める。
 *
 * stdout / stderr は**別々に** UTF-8 として読む（1つの decoder を共有すると、
 * 片方の途中で切れた多バイト文字にもう片方のバイトが混ざる）。
 */
export function createTerminalOutputCollector(
  maxChars: number = TERMINAL_OUTPUT_MAX_CHARS
): TerminalOutputCollector {
  const decoders = {
    stdout: new StringDecoder('utf8'),
    stderr: new StringDecoder('utf8')
  }
  let text = ''
  let truncated = false

  function push(value: string): void {
    if (value.length === 0) {
      return
    }

    if (truncated) {
      return
    }

    const room = maxChars - text.length

    if (value.length <= room) {
      text += value
      return
    }

    text += sliceWholeCharacters(value, room)
    truncated = true
  }

  return {
    append(stream, chunk) {
      push(decoders[stream].write(chunk))
    },
    finish() {
      push(decoders.stdout.end())
      push(decoders.stderr.end())

      return Object.freeze({ text, truncated })
    }
  }
}

/** 集めた出力を、伏せた形にする。**例外を投げない。** */
export function sanitizeTerminalOutput(captured: CapturedTerminalOutput): SafeTerminalOutput {
  try {
    let text = normalizeTerminalText(captured.text)

    if (captured.truncated) {
      text = dropTrailingPartialWord(text)
    }

    const masked = maskSecretText(text)

    if (masked.categories.includes('unscanned') || masked.truncated) {
      return withheld(captured.truncated)
    }

    return Object.freeze({
      text: masked.text,
      truncated: captured.truncated,
      secretMasked: masked.secretsFound,
      maskedCount: masked.maskedCount,
      categories: Object.freeze([...masked.categories]),
      withheld: false
    })
  } catch {
    return withheld(captured.truncated)
  }
}

/** 画面に出す形（伏せた後の末尾を、行数と1行の長さで切る）。**例外を投げない。** */
export function terminalOutputDisplay(output: SafeTerminalOutput): SafeTerminalOutputDisplay {
  if (output.withheld) {
    return Object.freeze({
      lines: Object.freeze([]),
      truncated: output.truncated,
      secretMasked: output.secretMasked,
      withheld: true
    })
  }

  const all = output.text.split('\n')

  // 末尾の改行でできた空の1行は数えない。
  if (all.length > 0 && all[all.length - 1] === '') {
    all.pop()
  }

  const dropped = all.length > TERMINAL_OUTPUT_DISPLAY_MAX_LINES
  const tail = dropped ? all.slice(-TERMINAL_OUTPUT_DISPLAY_MAX_LINES) : all
  let cut = false
  const lines = tail.map((line) => {
    const characters = [...line]

    if (characters.length <= TERMINAL_OUTPUT_DISPLAY_MAX_LINE_LENGTH) {
      return line
    }

    cut = true

    return `${characters.slice(0, TERMINAL_OUTPUT_DISPLAY_MAX_LINE_LENGTH - 1).join('')}${TRUNCATION_MARK}`
  })

  return Object.freeze({
    lines: Object.freeze(lines),
    truncated: output.truncated || dropped || cut,
    secretMasked: output.secretMasked,
    withheld: false
  })
}

/**
 * 端末の制御と見えない文字を取り除く。
 *
 * ```
 * ESC [ … 文字      色・カーソル移動（CSI）
 * ESC ] … BEL/ST    タイトルの変更・リンク（OSC）
 * ESC 1文字         その他のエスケープ
 * \r\n / \r         改行へ揃える（進捗表示の上書きも1行ずつ残る）
 * 制御文字・書式文字・行 / 段落の区切り   取り除く（改行とタブだけ残す）
 * ```
 */
export function normalizeTerminalText(text: string): string {
  return text
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(OTHER_ESCAPE, '')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE_CHARACTER, '')
}

const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]?/g
/** ESC ＋ 中間の文字（`(` など）＋ 終わりの1文字（文字集合の切り替え `ESC ( B` など）。 */
const OTHER_ESCAPE = /\u001b[ -/]*[0-~]?/g
const INVISIBLE_CHARACTER = /(?![\n\t])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu

/** 最後の空白より後ろ（切れ目にかかった語）を落とす。空白が無ければ全部落とす。 */
function dropTrailingPartialWord(text: string): string {
  const match = /\s(?=\S*$)/.exec(text)

  return match === null ? '' : text.slice(0, match.index + 1)
}

/** 文字の途中（サロゲートの片割れ）で切らない。 */
function sliceWholeCharacters(value: string, length: number): string {
  if (length <= 0) {
    return ''
  }

  const code = value.charCodeAt(length - 1)

  // 上位サロゲートで終わるなら、その1つ手前で切る。
  return code >= 0xd800 && code <= 0xdbff ? value.slice(0, length - 1) : value.slice(0, length)
}

function withheld(truncated: boolean): SafeTerminalOutput {
  return Object.freeze({
    text: '',
    truncated,
    secretMasked: false,
    maskedCount: 0,
    categories: Object.freeze([]),
    withheld: true
  })
}
