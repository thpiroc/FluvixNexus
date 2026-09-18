import {
  DIAGNOSTICS_ERROR_MESSAGE_MAX_LENGTH,
  DIAGNOSTICS_ERROR_NAME_MAX_LENGTH,
  DIAGNOSTICS_ERROR_STACK_LINE_MAX_LENGTH,
  DIAGNOSTICS_ERROR_STACK_MAX_LINES,
  type DiagnosticsErrorKind,
  type DiagnosticsErrorRecord,
  type DiagnosticsErrorSeverity
} from '@shared/diagnostics'
import { redactLogText, sanitizeLogText } from '../logger/logRedaction'

/**
 * エラー記録を伏せる（Electron / fs 非依存・テスト対象）。
 *
 * 診断情報は利用者の手を離れて誰かに渡る前提のもの。ログファイル（logger/logRedaction.ts）と
 * 同じ伏せ方を土台にし、そこへ2つ足す。
 *
 * ```
 * message の "…" / `…` の中身 → <text>   JSON の読み損ねなどで、ファイルの中身の断片が入るため
 * stack のパス               → ファイル名:行:桁   ユーザー名のフォルダを残さず、どこで起きたかだけ残す
 * ```
 *
 * `'…'` は伏せない ── V8 の message では識別子（`reading 'foo'`）や字句（`Unexpected token 'a'`）
 * に使われ、原因を読むのに要る。**伏せすぎは許し、伏せ漏れは許さない**側へ倒すのは
 * logRedaction.ts と同じ方針で、ここに無い形で中身が入る message は長さの上限で抑える。
 *
 * stack は V8 の `at …` の行だけを残す。先頭の `Name: message` の行は message と重複し、
 * しかも伏せる前の message をそのまま持っているため捨てる。
 */

export const REDACTED_ERROR_TEXT = '<text>'

const DOUBLE_QUOTED_PATTERN = /"[^"\r\n]*"/g
const BACKTICK_QUOTED_PATTERN = /`[^`\r\n]*`/g

/** `at fn (LOCATION)` の形。 */
const FRAME_WITH_FUNCTION_PATTERN = /^(at .*?\()(.*)(\))$/
/** `at LOCATION` の形。 */
const FRAME_WITHOUT_FUNCTION_PATTERN = /^(at )(.*)$/
/** 場所の末尾の `:行:桁`。 */
const LINE_COLUMN_PATTERN = /^(.*?)((?::\d+){1,2})$/
/** 絶対パスとして読むもの（file URI・ドライブ・UNC・POSIX）。 */
const ABSOLUTE_LOCATION_PATTERN = /^(?:file:\/\/|[A-Za-z]:[\\/]|\\\\|\/)/i

export interface ErrorRecordInput {
  readonly kind: DiagnosticsErrorKind
  readonly severity: DiagnosticsErrorSeverity
  readonly occurredAt: number
  readonly appVersion: string
  readonly name: unknown
  readonly message: unknown
  readonly stack: unknown
}

/** 伏せ済みの記録を作る。どんな値が来ても投げない。 */
export function createErrorRecord(input: ErrorRecordInput): DiagnosticsErrorRecord {
  return {
    kind: input.kind,
    severity: input.severity,
    occurredAt: Number.isFinite(input.occurredAt) ? input.occurredAt : 0,
    appVersion: sanitizeErrorName(input.appVersion),
    name: sanitizeErrorName(input.name),
    message: sanitizeErrorMessage(input.message),
    stack: sanitizeErrorStack(input.stack)
  }
}

/** 捕まえた値（Error とは限らない）を、名前・message・stack に分ける。 */
export function describeThrown(value: unknown): {
  readonly name: string
  readonly message: string
  readonly stack: string
} {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: typeof value.stack === 'string' ? value.stack : ''
    }
  }

  switch (typeof value) {
    case 'string':
      return { name: 'NonError', message: value, stack: '' }
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return { name: 'NonError', message: String(value), stack: '' }
    default:
      // object の中身は辿らない（logRedaction.ts の details と同じ扱い）。
      return { name: 'NonError', message: value === null ? 'null' : '[object]', stack: '' }
  }
}

export function sanitizeErrorName(raw: unknown): string {
  const text = typeof raw === 'string' && raw.length > 0 ? raw : 'Error'

  return truncate(sanitizeLogText(text), DIAGNOSTICS_ERROR_NAME_MAX_LENGTH)
}

export function sanitizeErrorMessage(raw: unknown): string {
  if (typeof raw !== 'string') {
    return ''
  }

  const withoutQuoted = raw
    .replace(DOUBLE_QUOTED_PATTERN, `"${REDACTED_ERROR_TEXT}"`)
    .replace(BACKTICK_QUOTED_PATTERN, `\`${REDACTED_ERROR_TEXT}\``)

  return truncate(sanitizeLogText(withoutQuoted), DIAGNOSTICS_ERROR_MESSAGE_MAX_LENGTH)
}

export function sanitizeErrorStack(raw: unknown): readonly string[] {
  if (typeof raw !== 'string' || raw.length === 0) {
    return []
  }

  const frames: string[] = []

  // 巨大な stack を丸ごと分けない（行数の上限の数倍だけ読む）。
  for (const line of raw.slice(0, 64_000).split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed.startsWith('at ')) {
      continue
    }

    frames.push(
      truncate(
        sanitizeLogText(sanitizeStackFrame(trimmed)),
        DIAGNOSTICS_ERROR_STACK_LINE_MAX_LENGTH
      )
    )

    if (frames.length >= DIAGNOSTICS_ERROR_STACK_MAX_LINES) {
      break
    }
  }

  return frames
}

/** `at fn (C:\Users\taro\app\out\main\index.js:10:5)` → `at fn (index.js:10:5)`。 */
export function sanitizeStackFrame(frame: string): string {
  const withFunction = FRAME_WITH_FUNCTION_PATTERN.exec(frame)

  if (withFunction !== null) {
    return `${withFunction[1]}${shortenLocation(withFunction[2])}${withFunction[3]}`
  }

  const withoutFunction = FRAME_WITHOUT_FUNCTION_PATTERN.exec(frame)

  if (withoutFunction !== null) {
    return `${withoutFunction[1]}${shortenLocation(withoutFunction[2])}`
  }

  return redactLogText(frame)
}

function shortenLocation(location: string): string {
  const lineColumn = LINE_COLUMN_PATTERN.exec(location)
  const path = lineColumn === null ? location : lineColumn[1]
  const suffix = lineColumn === null ? '' : lineColumn[2]

  if (!ABSOLUTE_LOCATION_PATTERN.test(path)) {
    // `node:internal/…`・`<anonymous>`・`native`・開発時の http URL はそのまま（伏せは後段で掛かる）。
    return location
  }

  const withoutQuery = path.replace(/[?#].*$/, '')
  const segments = withoutQuery.split(/[\\/]/)
  const fileName = segments[segments.length - 1] ?? ''

  return fileName.length > 0 ? `${fileName}${suffix}` : `<path>${suffix}`
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
}
