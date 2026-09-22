import type { JsonFileRead } from '../store/jsonFile'

/**
 * フィードバックの保存先の設定（Electron に依存しない）。
 *
 * ## 秘密情報はソースにもリポジトリにも置かない
 *
 * Notion の token と Database ID は次のどちらかから、**送信のたびに**読む
 * （書き換えた後にアプリを起動し直さなくてよい）。
 *
 *   1. 環境変数 `FLUVIX_NOTION_TOKEN` / `FLUVIX_NOTION_DATABASE_ID`（開発時向け）
 *   2. userData の `feedback-destinations.json`（Windows では
 *      `%APPDATA%\Fluvix Nexus\feedback-destinations.json`）
 *
 * どちらもリポジトリの外にあり、ビルド・インストーラーにも入らない。
 * 環境変数が1つでもあれば、ファイルは見ない（2箇所を混ぜて組み立てない）。
 *
 * ## 何も無いのは「保存先が無い」であって失敗ではない
 *
 * 設定が無い利用者には v1 と同じく「受け付けるだけ」になる。
 * 一方で**中途半端な設定**（token だけ・ID だけ・JSON が壊れている）は失敗にする
 * ── 保存したつもりの人に、黙って捨てたことを「受け付けました」と見せない。
 */

export const FEEDBACK_DESTINATIONS_FILE_NAME = 'feedback-destinations.json'

export const NOTION_TOKEN_ENV = 'FLUVIX_NOTION_TOKEN'
export const NOTION_DATABASE_ID_ENV = 'FLUVIX_NOTION_DATABASE_ID'

export interface NotionDestinationConfig {
  readonly token: string
  /** ハイフン無しの 32 桁の16進（URL・ハイフン付きでも受け付けて揃える）。 */
  readonly databaseId: string
}

export interface FeedbackDestinationsConfig {
  readonly notion: NotionDestinationConfig | null
}

export type FeedbackDestinationsConfigRead =
  | { readonly ok: true; readonly config: FeedbackDestinationsConfig }
  | { readonly ok: false; readonly problem: string }

/**
 * 設定を決める。
 *
 * `problem` は Main のログへ出す文で、**token の値は決して含めない。**
 */
export function resolveFeedbackDestinationsConfig(
  env: Readonly<Record<string, string | undefined>>,
  file: JsonFileRead
): FeedbackDestinationsConfigRead {
  const envToken = nonEmpty(env[NOTION_TOKEN_ENV])
  const envDatabaseId = nonEmpty(env[NOTION_DATABASE_ID_ENV])

  if (envToken !== null || envDatabaseId !== null) {
    return notionConfig(envToken, envDatabaseId, 'environment variables')
  }

  if (file.kind === 'missing') {
    return { ok: true, config: { notion: null } }
  }

  if (file.kind === 'unreadable') {
    return { ok: false, problem: `${FEEDBACK_DESTINATIONS_FILE_NAME} is not valid JSON.` }
  }

  if (!isRecord(file.raw)) {
    return { ok: false, problem: `${FEEDBACK_DESTINATIONS_FILE_NAME} must be a JSON object.` }
  }

  const notion = file.raw['notion']

  if (notion === undefined || notion === null) {
    return { ok: true, config: { notion: null } }
  }

  if (!isRecord(notion)) {
    return {
      ok: false,
      problem: `"notion" in ${FEEDBACK_DESTINATIONS_FILE_NAME} must be an object.`
    }
  }

  return notionConfig(
    nonEmpty(notion['token']),
    nonEmpty(notion['databaseId']),
    FEEDBACK_DESTINATIONS_FILE_NAME
  )
}

function notionConfig(
  token: string | null,
  rawDatabaseId: string | null,
  source: string
): FeedbackDestinationsConfigRead {
  if (token === null || rawDatabaseId === null) {
    return {
      ok: false,
      problem: `Notion needs both a token and a database ID (${source}).`
    }
  }

  /*
    token は見える ASCII だけでできている。制御文字（PowerShell 5.1 の
    `Read-Host -AsSecureString` で Ctrl+V を押すと 0x16 が入る）などが混ざると、
    fetch が「fetch failed」とだけ言って送る前に落ちる ── 原因が見えないので先に断る。
    ログへ出すのは**混ざった文字の符号だけ**で、token 本体の文字は出さない。
  */
  const unexpected = unexpectedTokenCharacters(token)

  if (unexpected.length > 0) {
    return {
      ok: false,
      problem: `Notion token contains ${unexpected.length} unexpected character(s) (${[...new Set(unexpected)].join(', ')}) (${source}). Set it again.`
    }
  }

  const databaseId = normalizeNotionDatabaseId(rawDatabaseId)

  if (databaseId === null) {
    // 値そのものはログへ出さない。直し方が変わる形だけを添える。
    const hint = /^\W*collection:/i.test(rawDatabaseId)
      ? ' It is a data source URL (collection://); use the database URL instead.'
      : ''

    return {
      ok: false,
      problem: `Notion database ID is not recognizable (${source}).${hint}`
    }
  }

  return { ok: true, config: { notion: { token, databaseId } } }
}

/**
 * Database ID を 32 桁の16進へ揃える。
 *
 * Notion の画面からコピーしやすいのは URL なので、それも受け付ける
 * （`https://www.notion.so/<ws>/<タイトル>-<32桁>?v=<view の32桁>`）。
 * `?v=` の後ろは**ビューの ID** で Database ID ではないため、クエリは捨てて
 * パスの末尾の 32 桁を取る。
 *
 * 貼り付けたときに付きやすい前後の引用符・`<>`・空白は外す（PowerShell の
 * `Read-Host` は `"…"` をそのまま値にする）。`https://` が無い URL でも
 * クエリを捨てるのは同じ ── URL として解釈できるかに頼らない。
 *
 * `collection://…` は **data source の ID** で Database ID ではないため受け付けない
 * （`parent.database_id` に渡すと Notion が 404 を返す）。
 */
export function normalizeNotionDatabaseId(value: string): string | null {
  const unwrapped = value.trim().replace(/^["'<\s]+|["'>\s]+$/g, '')

  if (/^collection:/i.test(unwrapped)) {
    return null
  }

  const path = unwrapped.split(/[?#]/, 1)[0]!
  const compact = path.replace(/[-/]/g, '')
  const match = /([0-9a-f]{32})$/i.exec(compact)

  return match === null ? null : match[1]!.toLowerCase()
}

/** token に入っているはずのない文字（見える ASCII 以外）の符号。例: `U+0016` */
function unexpectedTokenCharacters(token: string): string[] {
  return Array.from(token)
    .filter((char) => !/^[\x21-\x7e]$/.test(char))
    .map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
