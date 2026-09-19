import { describe, expect, it } from 'vitest'
import { FEEDBACK_CATEGORY_IDS } from '@shared/feedback'
import { FeedbackDeliveryError } from './feedbackDestination'
import type { FeedbackRecord } from './feedbackRecord'
import {
  NOTION_API_URL,
  NOTION_API_VERSION,
  NOTION_CATEGORY_NAMES,
  buildNotionPage,
  createNotionDestination,
  splitNotionText
} from './notionDestination'

/**
 * Notion への保存（通信は差し替えた fetch で見る）。
 */

const DATABASE_ID = '0123456789abcdef0123456789abcdef'
const TOKEN = 'ntn_secret_value'

const RECORD: FeedbackRecord = {
  category: 'bug',
  detail: 'エディタで保存すると固まる\n2行目の説明',
  submittedAt: '2026-09-19T01:02:03.000Z',
  appVersion: '1.0.0',
  environment: { os: 'Windows_NT', osRelease: '10.0.26200', arch: 'x64', electron: '43.3.0' }
}

type Page = {
  parent: { database_id: string }
  properties: Record<string, Record<string, unknown>>
}

function captureFetch(response: () => Response): {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  calls: { url: string; init: RequestInit }[]
} {
  const calls: { url: string; init: RequestInit }[] = []

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response()
    }
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function saveAndCatch(
  destination: ReturnType<typeof createNotionDestination>
): Promise<FeedbackDeliveryError> {
  try {
    await destination.save(RECORD)
  } catch (cause) {
    if (cause instanceof FeedbackDeliveryError) {
      return cause
    }
    throw cause
  }
  throw new Error('save did not fail')
}

describe('buildNotionPage', () => {
  it('日本語の本文・種別・日時・バージョン・環境をプロパティに載せる', () => {
    const page = buildNotionPage(RECORD, DATABASE_ID) as Page

    expect(page.parent).toEqual({ database_id: DATABASE_ID })
    expect(page.properties['タイトル']).toEqual({
      title: [{ type: 'text', text: { content: '[バグ] エディタで保存すると固まる' } }]
    })
    expect(page.properties['種別']).toEqual({ select: { name: 'バグ' } })
    expect(page.properties['本文']).toEqual({
      rich_text: [{ type: 'text', text: { content: RECORD.detail } }]
    })
    expect(page.properties['送信日時']).toEqual({ date: { start: RECORD.submittedAt } })
    expect(page.properties['バージョン']).toEqual({
      rich_text: [{ type: 'text', text: { content: '1.0.0' } }]
    })
    expect(page.properties['環境']).toEqual({
      rich_text: [
        { type: 'text', text: { content: 'Windows_NT 10.0.26200 (x64) / Electron 43.3.0' } }
      ]
    })
  })

  it('すべての種別に Notion のセレクト名がある', () => {
    expect(FEEDBACK_CATEGORY_IDS.map((id) => NOTION_CATEGORY_NAMES[id])).toEqual([
      'バグ',
      'Bad',
      'Good',
      '安全性チェック',
      'その他'
    ])
  })

  it('タイトルは1行目の先頭40文字まで', () => {
    const page = buildNotionPage({ ...RECORD, detail: 'あ'.repeat(50) }, DATABASE_ID) as Page
    const title = (page.properties['タイトル']!['title'] as { text: { content: string } }[])[0]!

    expect(title.text.content).toBe(`[バグ] ${'あ'.repeat(40)}…`)
  })
})

describe('splitNotionText', () => {
  it('2000文字ごとに分け、つなげると元に戻る', () => {
    const value = 'x'.repeat(4500)
    const chunks = splitNotionText(value)

    expect(chunks.map((chunk) => chunk.length)).toEqual([2000, 2000, 500])
    expect(chunks.join('')).toBe(value)
  })

  it('サロゲートペアの途中では切らない', () => {
    const value = `${'x'.repeat(1999)}😀tail`
    const chunks = splitNotionText(value)

    expect(chunks[0]).toBe('x'.repeat(1999))
    expect(chunks[1]).toBe('😀tail')
  })

  it('100要素を越える分は落として印を付ける', () => {
    const chunks = splitNotionText('x'.repeat(2000 * 100 + 10))

    expect(chunks).toHaveLength(100)
    expect(chunks[99]!.endsWith('…(truncated)')).toBe(true)
    expect(chunks[99]!.length).toBeLessThanOrEqual(2000)
  })
})

describe('createNotionDestination', () => {
  it('pages API へ token と固定の版で POST する', async () => {
    const fake = captureFetch(() => jsonResponse(200, { object: 'page', id: 'p' }))
    const destination = createNotionDestination(
      { token: TOKEN, databaseId: DATABASE_ID },
      { fetch: fake.fetch }
    )

    await destination.save(RECORD)

    expect(fake.calls).toHaveLength(1)
    const [{ url, init }] = fake.calls as [{ url: string; init: RequestInit }]
    const headers = init.headers as Record<string, string>

    expect(url).toBe(NOTION_API_URL)
    expect(init.method).toBe('POST')
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(headers['Notion-Version']).toBe(NOTION_API_VERSION)
    expect(JSON.parse(init.body as string)).toEqual(buildNotionPage(RECORD, DATABASE_ID))
  })

  it('Notion の応答を失敗の分類に落とす（説明に token は出ない）', async () => {
    const cases: [number, string][] = [
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [404, 'not-found'],
      [400, 'rejected'],
      [429, 'unavailable'],
      [503, 'unavailable']
    ]

    for (const [status, failure] of cases) {
      const fake = captureFetch(() =>
        jsonResponse(status, { object: 'error', code: 'x', message: 'nope' })
      )
      const error = await saveAndCatch(
        createNotionDestination({ token: TOKEN, databaseId: DATABASE_ID }, { fetch: fake.fetch })
      )

      expect(error.failure, String(status)).toBe(failure)
      expect(error.message).toContain(String(status))
      expect(error.message).not.toContain(TOKEN)
    }
  })

  it('Notion のエラー文に含まれる Database ID と token を伏せる', async () => {
    const dashed = '01234567-89ab-cdef-0123-456789abcdef'
    const fake = captureFetch(() =>
      jsonResponse(404, {
        object: 'error',
        code: 'object_not_found',
        message: `Could not find database with ID: ${dashed}. token ${TOKEN}; also ${DATABASE_ID}`
      })
    )
    const error = await saveAndCatch(
      createNotionDestination({ token: TOKEN, databaseId: DATABASE_ID }, { fetch: fake.fetch })
    )

    expect(error.failure).toBe('not-found')
    expect(error.message).toBe(
      'Notion responded 404 (object_not_found): Could not find database with ID: <id>. token <redacted>; also <id>'
    )
  })

  it('届かなければ network', async () => {
    const error = await saveAndCatch(
      createNotionDestination(
        { token: TOKEN, databaseId: DATABASE_ID },
        {
          fetch: async () => {
            throw new TypeError('fetch failed')
          }
        }
      )
    )

    expect(error.failure).toBe('network')
  })

  it('fetch failed の cause（code 付き）まで説明に残し、token は伏せる', async () => {
    const error = await saveAndCatch(
      createNotionDestination(
        { token: TOKEN, databaseId: DATABASE_ID },
        {
          fetch: async () => {
            const cause = Object.assign(new Error(`invalid Authorization header ${TOKEN}`), {
              name: 'InvalidArgumentError',
              code: 'UND_ERR_INVALID_ARG'
            })
            throw new TypeError('fetch failed', { cause })
          }
        }
      )
    )

    expect(error.failure).toBe('network')
    expect(error.message).toBe(
      'Could not reach Notion: TypeError: fetch failed <- InvalidArgumentError UND_ERR_INVALID_ARG: invalid Authorization header <redacted>'
    )
  })

  it('待ちすぎたら打ち切って network', async () => {
    const error = await saveAndCatch(
      createNotionDestination(
        { token: TOKEN, databaseId: DATABASE_ID },
        {
          timeoutMs: 20,
          fetch: (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            })
        }
      )
    )

    expect(error.failure).toBe('network')
  })
})
