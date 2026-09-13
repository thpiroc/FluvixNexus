import { isAbsolute, relative, resolve } from 'path'
import {
  DEBUG_STOP_TEXT_MAX_LENGTH,
  isDebugExceptionBreakMode,
  type DebugExceptionBreakMode,
  type DebugStopInfo,
  type DebugStopReason
} from '@shared/debug'
import { isInsideWorkspace, normalizeWorkspaceRelativePath } from '../files/workspacePath'
import { fileUriToPath } from '../lsp/documentUri'

/**
 * DAP `stopped` event / `exceptionInfo` を「なぜ止まったか」へ畳む（Session 6-13。純粋・テスト対象）。
 *
 * ```
 * stopped event body ──┐
 *                      ├─→ toDebugStopInfo(rootPath, …) ─→ DebugStopInfo（shared/debug/stop.ts）
 * exceptionInfo body ──┘      閉じた集合の理由 / 表示用の型名・メッセージ（パスを伏せたもの）
 * ```
 *
 * 前2つ（`parseDapStoppedEvent` / `parseDapExceptionInfoResponse`）は **Main の中だけの形**で、
 * 文字列はまだパスを伏せていない。Renderer へ出る形にするのは `toDebugStopInfo` だけになる。
 *
 * ## adapter ごとの違いを持たない
 *
 * 見ているのは DAP の仕様にある欄（`reason` / `description` / `text` /
 * `exceptionId` / `breakMode` / `details.typeName` / `details.message`）だけで、
 * debugpy 固有の欄は読まない。実 debugpy 1.8.21 では `text` が型名・`description` が
 * メッセージだった（DAP の仕様どおり）。
 */

/** `stopped` event から読んだもの（Main の中だけの形。文字列はパスを伏せていない）。 */
export interface DapStoppedEventSummary {
  readonly reason: DebugStopReason
  /** DAP の `description`。例外ではメッセージが入ることが多い。 */
  readonly description: string | null
  /** DAP の `text`。例外では型名が入る（仕様の例）。 */
  readonly text: string | null
}

/** `exceptionInfo` 応答から読んだもの（Main の中だけの形）。 */
export interface DapExceptionInfoSummary {
  readonly exceptionId: string
  readonly description: string | null
  readonly breakMode: DebugExceptionBreakMode | null
  readonly typeName: string | null
  readonly message: string | null
}

export interface DapExceptionInfoArguments {
  readonly threadId: number
}

export const UNKNOWN_DAP_STOPPED_EVENT: DapStoppedEventSummary = {
  reason: 'unknown',
  description: null,
  text: null
}

/** 伏せたパスの代わりに入れる語。 */
export const REDACTED_DEBUG_PATH = '<path>'

/** 1つの文字列として読む上限（伏せる前）。これより先は正規表現に渡さない。 */
const RAW_TEXT_READ_LIMIT = 4_000

export function parseDapStoppedEvent(body: unknown): DapStoppedEventSummary {
  if (!isRecord(body)) {
    return UNKNOWN_DAP_STOPPED_EVENT
  }

  return {
    reason: toDebugStopReason(body.reason),
    description: readRawText(body.description),
    text: readRawText(body.text)
  }
}

/**
 * DAP の `reason` → 閉じた集合。
 *
 * breakpoint の種類違い（function / data / instruction）は「breakpoint で止まった」と
 * 読めば足りる。`goto` はこの版に入口が無く、ほかの任意の文字列と同じく `unknown`。
 */
export function toDebugStopReason(raw: unknown): DebugStopReason {
  switch (raw) {
    case 'breakpoint':
    case 'function breakpoint':
    case 'data breakpoint':
    case 'instruction breakpoint':
      return 'breakpoint'
    case 'step':
      return 'step'
    case 'pause':
      return 'pause'
    case 'entry':
      return 'entry'
    case 'exception':
      return 'exception'
    default:
      return 'unknown'
  }
}

/** `initialize` の応答で `supportsExceptionInfoRequest` を名乗ったか。 */
export function readSupportsExceptionInfoRequest(capabilities: unknown): boolean {
  return isRecord(capabilities) && capabilities.supportsExceptionInfoRequest === true
}

export function createExceptionInfoArguments(threadId: number): DapExceptionInfoArguments {
  return { threadId }
}

/**
 * `exceptionInfo` 応答を読む。`exceptionId`（仕様で必須）が文字列でなければ壊れた応答として null。
 *
 * `details.stackTrace` / `details.source` / `details.evaluateName` / `details.fullTypeName` /
 * `details.innerException` は**読まない**（実 debugpy では stackTrace と source が絶対パス）。
 */
export function parseDapExceptionInfoResponse(body: unknown): DapExceptionInfoSummary | null {
  if (!isRecord(body) || typeof body.exceptionId !== 'string') {
    return null
  }

  const details = isRecord(body.details) ? body.details : null

  return {
    exceptionId: body.exceptionId,
    description: readRawText(body.description),
    breakMode: isDebugExceptionBreakMode(body.breakMode) ? body.breakMode : null,
    typeName: readRawText(details?.typeName),
    message: readRawText(details?.message)
  }
}

export interface ToDebugStopInfoInput {
  /** 今の Workspace root。伏せるときに Workspace の中のパスを相対位置へ直すのに使う。 */
  readonly rootPath: string
  readonly sequence: number
  readonly stopped: DapStoppedEventSummary
  /** 読めた `exceptionInfo`。送っていない / 断られた / 壊れていたら null。 */
  readonly exceptionInfo: DapExceptionInfoSummary | null
}

/**
 * Renderer へ出す形にする。
 *
 * 例外の型名は `exceptionInfo` の `details.typeName` → `exceptionId` → stopped の `text`、
 * メッセージは `details.message` → `description` → stopped の `description` の順に採る
 * ── `exceptionInfo` を名乗らない adapter でも、stopped event だけで型名とメッセージが出る。
 */
export function toDebugStopInfo(input: ToDebugStopInfoInput): DebugStopInfo {
  const { rootPath, sequence, stopped, exceptionInfo } = input

  if (stopped.reason !== 'exception') {
    return { sequence, reason: stopped.reason, exception: null }
  }

  return {
    sequence,
    reason: 'exception',
    exception: {
      typeName: sanitizeDebugStopText(
        rootPath,
        firstText(exceptionInfo?.typeName, exceptionInfo?.exceptionId, stopped.text)
      ),
      message: sanitizeDebugStopText(
        rootPath,
        firstText(exceptionInfo?.message, exceptionInfo?.description, stopped.description)
      ),
      breakMode: exceptionInfo?.breakMode ?? null
    }
  }
}

/**
 * 表示用の1行にする: 絶対パス / file URI を伏せる → 制御文字と空白を1つに畳む → 上限で切る。
 *
 * メッセージは利用者のプログラムが作った文字列で、`FileNotFoundError` のように**絶対パスを
 * そのまま含む**ことがある。Debug Console の出力（§20.9 の例外）と違ってこの欄は
 * Main が組み立てた構造化データとして Renderer へ渡るため、伏せてから載せる。
 */
export function sanitizeDebugStopText(rootPath: string, raw: string | null): string | null {
  if (raw === null) {
    return null
  }

  const collapsed = redactDebugPaths(rootPath, raw)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (collapsed.length === 0) {
    return null
  }

  return collapsed.length <= DEBUG_STOP_TEXT_MAX_LENGTH
    ? collapsed
    : `${collapsed.slice(0, DEBUG_STOP_TEXT_MAX_LENGTH)}…`
}

/*
  パスの候補。区切りの直後に空白があっても、その先にもう1段の区切りが続く間は
  1つのパスとして読む（`C:\Program Files\app\main.py` を途中で切って後半を残さない）。
*/
const PATH_SEGMENT = String.raw`(?:[^\s'"<>|*?]|\s(?=[^\s'"<>|*?]*[\\/]))*`
const FILE_URI_PATTERN = /\bfile:\/\/[^\s'"<>]*/gi
const WINDOWS_DRIVE_PATH_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]${PATH_SEGMENT}`,
  'g'
)
const WINDOWS_UNC_PATH_PATTERN = new RegExp(String.raw`\\\\[^\\/\s'"<>|]+[\\/]${PATH_SEGMENT}`, 'g')
const POSIX_ABSOLUTE_PATH_PATTERN = /(?<=^|[\s'"(=:,[])\/(?:[^\s'"<>|/]+\/)+[^\s'"<>|]*/g

/**
 * 文字列の中の絶対パス / file URI を伏せる。
 *
 * Workspace の中を指すものは相対位置へ直し（利用者が読める情報は残す）、外を指すもの・
 * 読めないものは `<path>` にする。**伏せすぎは許し、伏せ漏れは許さない**側へ倒してある
 * ── パスの後ろに続く語まで巻き込んで伏せることはあるが、パスの先頭（ドライブ・UNC の
 * サーバ名・ユーザー名のフォルダ）を残すことは無い。
 */
export function redactDebugPaths(rootPath: string, raw: string): string {
  const text = raw.length <= RAW_TEXT_READ_LIMIT ? raw : raw.slice(0, RAW_TEXT_READ_LIMIT)

  /*
    ドライブ文字のパスを UNC より**先に**伏せる。Python の例外メッセージはパスを repr で入れるため
    区切りが2つ重なる（`'C:\\Users\\…'`）── UNC を先に当てると `\\Users\\…` を UNC と読み、
    `C:` だけが残って Workspace の中のパスも相対位置へ直せなかった（実 debugpy の
    FileNotFoundError で production 確認中に見つけた）。
  */
  return text
    .replace(FILE_URI_PATTERN, (uri) => {
      const path = fileUriToPath(uri)

      return path === null ? REDACTED_DEBUG_PATH : toDisplayPath(rootPath, path)
    })
    .replace(WINDOWS_DRIVE_PATH_PATTERN, (path) => toDisplayPath(rootPath, path))
    .replace(WINDOWS_UNC_PATH_PATTERN, (path) => toDisplayPath(rootPath, path))
    .replace(POSIX_ABSOLUTE_PATH_PATTERN, (path) => toDisplayPath(rootPath, path))
}

function toDisplayPath(rootPath: string, candidate: string): string {
  if (rootPath.length === 0 || !isAbsolute(candidate) || candidate.includes('\0')) {
    return REDACTED_DEBUG_PATH
  }

  const absolutePath = resolve(candidate)

  if (!isInsideWorkspace(rootPath, absolutePath)) {
    return REDACTED_DEBUG_PATH
  }

  const relativePath = normalizeWorkspaceRelativePath(
    relative(resolve(rootPath), absolutePath).replace(/\\/g, '/')
  )

  return relativePath === null || relativePath === '' ? REDACTED_DEBUG_PATH : relativePath
}

function readRawText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const withoutNul = value.replace(/\0/g, '')

  return withoutNul.trim().length === 0 ? null : withoutNul
}

function firstText(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  return null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
