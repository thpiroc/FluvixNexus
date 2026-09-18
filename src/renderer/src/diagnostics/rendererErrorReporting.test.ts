import { describe, expect, it, vi } from 'vitest'
import type { ReportRendererErrorRequest } from '@shared/ipc'
import {
  installRendererErrorReporting,
  toErrorEventReport,
  toRejectionReport,
  type RendererErrorEventTarget
} from './rendererErrorReporting'

function fakeTarget(): RendererErrorEventTarget & {
  dispatch(type: 'error' | 'unhandledrejection', event: object): void
  count(): number
} {
  const listeners = new Map<string, Set<(event: Event) => void>>()

  return {
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener)
    },
    dispatch: (type, event) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event as Event)
      }
    },
    count: () => [...listeners.values()].reduce((total, set) => total + set.size, 0)
  }
}

describe('installRendererErrorReporting', () => {
  it('未捕捉の例外と Promise の失敗を知らせ、やめると購読が外れる', () => {
    const target = fakeTarget()
    const reports: ReportRendererErrorRequest[] = []
    const dispose = installRendererErrorReporting(target, (request) => reports.push(request))

    target.dispatch('error', { message: 'Uncaught TypeError: x', error: new TypeError('x') })
    target.dispatch('unhandledrejection', { reason: new Error('y') })

    expect(reports.map((report) => [report.source, report.name, report.message])).toEqual([
      ['error', 'TypeError', 'x'],
      ['unhandledrejection', 'Error', 'y']
    ])

    dispose()

    expect(target.count()).toBe(0)
  })

  it('同じものは1回だけ・上限まで', () => {
    const target = fakeTarget()
    const report = vi.fn()

    installRendererErrorReporting(target, report, 2)

    for (let index = 0; index < 5; index += 1) {
      target.dispatch('error', { message: 'same', error: new Error('same') })
    }

    target.dispatch('error', { message: 'b', error: new Error('b') })
    target.dispatch('error', { message: 'c', error: new Error('c') })

    expect(report).toHaveBeenCalledTimes(2)
  })

  it('知らせる側が投げても外へ漏らさない', () => {
    const target = fakeTarget()

    installRendererErrorReporting(target, () => {
      throw new Error('bridge missing')
    })

    expect(() => target.dispatch('error', { message: 'x', error: new Error('x') })).not.toThrow()
  })
})

describe('toErrorEventReport / toRejectionReport', () => {
  it('害の無い既知のものは送らない', () => {
    expect(
      toErrorEventReport({
        message: 'ResizeObserver loop completed with undelivered notifications.',
        error: undefined
      })
    ).toBeNull()
    expect(toErrorEventReport({ message: 'Script error.', error: null })).toBeNull()
    expect(toErrorEventReport({ message: '', error: undefined })).toBeNull()

    const canceled = new Error('Canceled')
    canceled.name = 'Canceled'

    expect(toRejectionReport(canceled)).toBeNull()
    expect(
      toRejectionReport({ name: 'AbortError', message: 'The operation was aborted.' })
    ).toBeNull()
  })

  it('Error でない理由は中身を辿らない', () => {
    expect(toRejectionReport({ token: 'secret' })).toEqual({
      source: 'unhandledrejection',
      name: 'NonError',
      message: '[object]',
      stack: ''
    })
    expect(toRejectionReport('boom')?.message).toBe('boom')
  })

  it('error が無ければ message を使う', () => {
    expect(toErrorEventReport({ message: 'Uncaught boom', error: null })).toEqual({
      source: 'error',
      name: 'Error',
      message: 'Uncaught boom',
      stack: ''
    })
  })
})
