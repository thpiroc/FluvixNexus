import type { ReportRendererErrorRequest } from '@shared/ipc'

/**
 * 画面の中で誰も捕まえなかった例外を、Main のエラー記録へ知らせる（DOM に依存しない形・テスト対象）。
 *
 * ## 既定の動きは止めない
 *
 * `preventDefault` しない。DevTools のコンソールには今までどおり出る ── ここは写しを
 * Main へ送るだけで、エラーの扱いを変えない。
 *
 * ## 送らないもの
 *
 * ```
 * ResizeObserver loop …  レイアウトの揺れで Chromium が出す警告。xterm / Monaco で日常的に出る（害は無い）
 * Script error.          中身が読めない（別オリジンの script）。送っても何も分からない
 * Canceled               Monaco が取り消した処理の Promise（CancellationError）。失敗ではない
 * AbortError             fetch などを自分で取り消したもの
 * ```
 *
 * ## 数を抑える
 *
 * 同じもの（種類・名前・message）は1回だけ、違うものも1回の起動で上限まで。
 * 描画のたびに投げる不具合で IPC を埋めないため。Main 側でも同じ抑えを掛けている
 * （main/diagnostics/errorGate.ts）── Renderer の申告は信じ切らない。
 */

export const RENDERER_ERROR_REPORTS_MAX = 20

/** `window` の必要な部分だけ（テストでは偽物を渡す）。 */
export interface RendererErrorEventTarget {
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void
  removeEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void
}

export type RendererErrorReporter = (request: ReportRendererErrorRequest) => void

/** 購読を始め、やめる関数を返す。 */
export function installRendererErrorReporting(
  target: RendererErrorEventTarget,
  report: RendererErrorReporter,
  maxReports: number = RENDERER_ERROR_REPORTS_MAX
): () => void {
  const seen = new Set<string>()

  const send = (request: ReportRendererErrorRequest | null): void => {
    if (request === null) {
      return
    }

    const fingerprint = `${request.source}|${request.name}|${request.message}`

    if (seen.has(fingerprint) || seen.size >= maxReports) {
      return
    }

    seen.add(fingerprint)

    try {
      report(request)
    } catch {
      // 知らせる側が失敗しても、画面のエラーをさらに増やさない。
    }
  }

  const handleError = (event: Event): void => {
    send(toErrorEventReport(event as ErrorEvent))
  }

  const handleRejection = (event: Event): void => {
    send(toRejectionReport((event as PromiseRejectionEvent).reason))
  }

  target.addEventListener('error', handleError)
  target.addEventListener('unhandledrejection', handleRejection)

  return () => {
    target.removeEventListener('error', handleError)
    target.removeEventListener('unhandledrejection', handleRejection)
  }
}

export function toErrorEventReport(
  event: Pick<ErrorEvent, 'message' | 'error'>
): ReportRendererErrorRequest | null {
  const message = typeof event.message === 'string' ? event.message : ''

  if (message.startsWith('ResizeObserver loop') || message === 'Script error.') {
    return null
  }

  // img の読み込み失敗などの `error` イベントは ErrorEvent ではない（message も error も無い）。
  if (event.error === undefined || event.error === null) {
    return message.length === 0 ? null : { source: 'error', name: 'Error', message, stack: '' }
  }

  const thrown = describe(event.error)

  return {
    source: 'error',
    name: thrown.name,
    message: thrown.message.length > 0 ? thrown.message : message,
    stack: thrown.stack
  }
}

export function toRejectionReport(reason: unknown): ReportRendererErrorRequest | null {
  const thrown = describe(reason)

  if (
    thrown.name === 'AbortError' ||
    (thrown.name === 'Canceled' && thrown.message === 'Canceled')
  ) {
    return null
  }

  return { source: 'unhandledrejection', ...thrown }
}

function describe(value: unknown): { name: string; message: string; stack: string } {
  if (value instanceof Error || isErrorLike(value)) {
    return {
      name: typeof value.name === 'string' ? value.name : 'Error',
      message: typeof value.message === 'string' ? value.message : '',
      stack: typeof value.stack === 'string' ? value.stack : ''
    }
  }

  if (typeof value === 'string') {
    return { name: 'NonError', message: value, stack: '' }
  }

  // object の中身は辿らない（Main 側の記録と同じ扱い）。
  return {
    name: 'NonError',
    message: value === null ? 'null' : typeof value === 'object' ? '[object]' : String(value),
    stack: ''
  }
}

/** DOMException など、Error を継いでいないが name / message を持つもの。 */
function isErrorLike(
  value: unknown
): value is { readonly name?: unknown; readonly message?: unknown; readonly stack?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}
