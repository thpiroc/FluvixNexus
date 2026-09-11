/**
 * DAP `threads` request / response（Session 6-5）。
 *
 * 別プロセスから来る応答なので、読めるスレッドだけを採る。応答そのものが
 * `threads` 配列でなければ null にして、呼び出し側が「読めなかった」と扱える形にする。
 */

export interface DapThread {
  readonly id: number
  readonly name: string
}

export const DAP_THREAD_NAME_MAX_LENGTH = 200

export function parseThreadsResponse(body: unknown): readonly DapThread[] | null {
  if (typeof body !== 'object' || body === null || !('threads' in body)) {
    return null
  }

  const rawThreads = (body as { readonly threads?: unknown }).threads

  if (!Array.isArray(rawThreads)) {
    return null
  }

  return rawThreads.flatMap((thread) => {
    const parsed = parseThread(thread)

    return parsed === null ? [] : [parsed]
  })
}

function parseThread(value: unknown): DapThread | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as { readonly id?: unknown; readonly name?: unknown }

  if (!isDapHandle(record.id)) {
    return null
  }

  return {
    id: record.id,
    name: sanitizeLabel(record.name, `Thread ${String(record.id)}`)
  }
}

export function isDapHandle(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function sanitizeLabel(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') {
    return fallback
  }

  const collapsed = raw.replace(/\0/g, '').replace(/\s+/g, ' ').trim()

  if (collapsed.length === 0) {
    return fallback
  }

  return collapsed.length <= DAP_THREAD_NAME_MAX_LENGTH
    ? collapsed
    : `${collapsed.slice(0, DAP_THREAD_NAME_MAX_LENGTH)}...`
}
