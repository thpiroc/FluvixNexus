import { describe, expect, it } from 'vitest'
import { parseThreadsResponse } from './dapThreads'

describe('DAP threads response', () => {
  it('reads valid threads and sanitizes names', () => {
    expect(
      parseThreadsResponse({
        threads: [{ id: 1, name: 'main' }, { id: 2, name: ' worker \n thread ' }, { id: 3 }]
      })
    ).toEqual([
      { id: 1, name: 'main' },
      { id: 2, name: 'worker thread' },
      { id: 3, name: 'Thread 3' }
    ])
  })

  it('drops malformed thread entries without failing the whole response', () => {
    expect(
      parseThreadsResponse({
        threads: [
          { id: 1, name: 'main' },
          { id: -1, name: 'negative' },
          { id: 1.5, name: 'fraction' },
          { id: '2', name: 'string' },
          { id: Number.MAX_SAFE_INTEGER + 1, name: 'unsafe' },
          null
        ]
      })
    ).toEqual([{ id: 1, name: 'main' }])
  })

  /** Session 6-15B ── 実 vscode-js-debug 1.117.0 はスレッドを `0` と名乗る（DAP の id は整数）。 */
  it('keeps thread id 0 (vscode-js-debug)', () => {
    expect(parseThreadsResponse({ threads: [{ id: 0, name: 'main.js [47048]' }] })).toEqual([
      { id: 0, name: 'main.js [47048]' }
    ])
  })

  it.each([null, undefined, 42, 'threads', {}, { threads: null }, { threads: {} }, []])(
    'returns null for malformed response bodies: %s',
    (body) => {
      expect(parseThreadsResponse(body)).toBeNull()
    }
  )
})
