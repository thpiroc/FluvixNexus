import type { FeedbackCategoryId } from '@shared/feedback'
import type { NotionDestinationConfig } from './feedbackConfig'
import {
  FeedbackDeliveryError,
  type FeedbackDeliveryFailure,
  type FeedbackDestination
} from './feedbackDestination'
import { formatFeedbackEnvironment, type FeedbackRecord } from './feedbackRecord'

/**
 * Notion の Database へ1件1ページで保存する保存先（Electron に依存しない）。
 *
 * ## Database に用意しておくプロパティ
 *
 * 名前と型が合っていないと Notion が 400 で断る（→ `rejected`）。
 *
 * | プロパティ | 型        | 中身                                   |
 * | ---------- | --------- | -------------------------------------- |
 * | タイトル   | タイトル  | `[種別] 本文の1行目の先頭`             |
 * | 種別       | セレクト  | バグ / Bad / Good / 安全性チェック / その他 |
 * | 本文       | テキスト  | 詳細の全文                             |
 * | 送信日時   | 日付      | Main が受け取った時刻                  |
 * | バージョン | テキスト  | Fluvix Nexus のバージョン              |
 * | 環境       | テキスト  | OS・アーキテクチャ・Electron           |
 *
 * 種別のセレクトの選択肢は、無ければ Notion が作る（先に作っておく必要は無い）。
 *
 * ## API のバージョンを固定する
 *
 * `Notion-Version: 2022-06-28` で `parent.database_id` を使う。新しい版は
 * Database と data source を分けており、同じ要求の形が通らなくなりうる
 * ── 版を上げるときは、要求の形と一緒に上げる。
 */

export const NOTION_API_URL = 'https://api.notion.com/v1/pages'
export const NOTION_API_VERSION = '2022-06-28'

/** 1回の保存を待つ上限。これを越えたら `network` として失敗させる。 */
export const NOTION_REQUEST_TIMEOUT_MS = 15_000

/** Notion の rich text 1要素の上限（文字数）と、1プロパティに載せられる要素数。 */
const NOTION_TEXT_CHUNK_MAX = 2000
const NOTION_TEXT_CHUNKS_MAX = 100

const TITLE_PREVIEW_MAX = 40

export const NOTION_PROPERTY_NAMES = {
  title: 'タイトル',
  category: '種別',
  detail: '本文',
  submittedAt: '送信日時',
  appVersion: 'バージョン',
  environment: '環境'
} as const

/** セレクトに入れる名前。画面の日本語の表示と同じにしてある（利用者の言葉で並ぶ）。 */
export const NOTION_CATEGORY_NAMES: Readonly<Record<FeedbackCategoryId, string>> = {
  bug: 'バグ',
  bad: 'Bad',
  good: 'Good',
  safety: '安全性チェック',
  other: 'その他'
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface NotionDestinationOptions {
  /** テストで差し替える。既定は呼んだ時点の `globalThis.fetch`。 */
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
}

export function createNotionDestination(
  config: NotionDestinationConfig,
  options: NotionDestinationOptions = {}
): FeedbackDestination {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const timeoutMs = options.timeoutMs ?? NOTION_REQUEST_TIMEOUT_MS

  return {
    id: 'notion',
    async save(record) {
      let response: Response

      try {
        response = await fetchImpl(NOTION_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(buildNotionPage(record, config.databaseId)),
          signal: AbortSignal.timeout(timeoutMs)
        })
      } catch (cause) {
        throw new FeedbackDeliveryError(
          'notion',
          'network',
          `Could not reach Notion: ${describeCause(cause, config.token)}`
        )
      }

      if (response.ok) {
        return
      }

      throw new FeedbackDeliveryError(
        'notion',
        classifyNotionStatus(response.status),
        `Notion responded ${response.status}${await describeNotionError(response, config.token)}`
      )
    }
  }
}

/** Notion の「ページを作る」要求の本文。 */
export function buildNotionPage(record: FeedbackRecord, databaseId: string): object {
  const categoryName = NOTION_CATEGORY_NAMES[record.category]

  return {
    parent: { database_id: databaseId },
    properties: {
      [NOTION_PROPERTY_NAMES.title]: {
        title: [text(`[${categoryName}] ${previewOf(record.detail)}`)]
      },
      [NOTION_PROPERTY_NAMES.category]: { select: { name: categoryName } },
      [NOTION_PROPERTY_NAMES.detail]: { rich_text: splitNotionText(record.detail).map(text) },
      [NOTION_PROPERTY_NAMES.submittedAt]: { date: { start: record.submittedAt } },
      [NOTION_PROPERTY_NAMES.appVersion]: { rich_text: [text(record.appVersion)] },
      [NOTION_PROPERTY_NAMES.environment]: {
        rich_text: [text(formatFeedbackEnvironment(record.environment))]
      }
    }
  }
}

/**
 * 長い本文を Notion の rich text の要素に分ける。
 *
 * 上限は UTF-16 の長さで数え、**サロゲートペアの途中では切らない**
 * （絵文字などが2つの壊れた文字になる）。載せきれない分は落とし、末尾に印を付ける。
 */
export function splitNotionText(value: string): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < value.length && chunks.length < NOTION_TEXT_CHUNKS_MAX) {
    let end = Math.min(start + NOTION_TEXT_CHUNK_MAX, value.length)

    if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) {
      end -= 1
    }

    chunks.push(value.slice(start, end))
    start = end
  }

  if (start < value.length) {
    const marker = '…(truncated)'
    const last = chunks[chunks.length - 1]!
    chunks[chunks.length - 1] = last.slice(0, NOTION_TEXT_CHUNK_MAX - marker.length) + marker
  }

  return chunks.length === 0 ? [''] : chunks
}

function previewOf(detail: string): string {
  const firstLine = detail.split(/\r?\n/, 1)[0]!.trim()
  const codePoints = Array.from(firstLine)

  return codePoints.length > TITLE_PREVIEW_MAX
    ? `${codePoints.slice(0, TITLE_PREVIEW_MAX).join('')}…`
    : firstLine
}

function text(content: string): { type: 'text'; text: { content: string } } {
  return { type: 'text', text: { content } }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function classifyNotionStatus(status: number): FeedbackDeliveryFailure {
  if (status === 401 || status === 403) {
    return 'unauthorized'
  }

  if (status === 404) {
    return 'not-found'
  }

  if (status === 429 || status >= 500) {
    return 'unavailable'
  }

  return 'rejected'
}

/**
 * ログへ出す文言から秘密情報を伏せる。
 *
 * token に加え、ID の形（32桁の16進・UUID）も伏せる ── Notion の 404 は
 * `Could not find database with ID: <ID>` のように Database ID を文言に含める。
 */
function redactNotionText(text: string, token: string): string {
  return text
    .split(token)
    .join('<redacted>')
    .replace(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi, '<id>')
}

/** Notion のエラー本文（`{ code, message }`）から、ログに残す短い説明を作る。 */
async function describeNotionError(response: Response, token: string): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown }
    const code = typeof body.code === 'string' ? body.code : 'unknown'
    const message = typeof body.message === 'string' ? body.message.slice(0, 300) : ''

    return redactNotionText(` (${code}): ${message}`, token)
  } catch {
    return ''
  }
}

/**
 * fetch の失敗の説明。
 *
 * undici は理由を `cause` に入れ、表には「fetch failed」としか書かない
 * （接続できない・TLS・不正なヘッダーのどれでも同じ）。そこで `cause` を辿り、
 * `code` も添える。万一 token や ID が文言に混ざっても伏せる。
 */
function describeCause(cause: unknown, token: string): string {
  const parts: string[] = []
  let current: unknown = cause

  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    if (!(current instanceof Error)) {
      parts.push(String(current))
      break
    }

    const code = (current as { code?: unknown }).code
    parts.push(`${current.name}${typeof code === 'string' ? ` ${code}` : ''}: ${current.message}`)
    current = current.cause
  }

  return redactNotionText(parts.join(' <- '), token)
}
