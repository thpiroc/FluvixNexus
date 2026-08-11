import { describe, expect, it } from 'vitest'
import { IpcError, invalidRequest, toIpcErrorPayload } from './errors'

describe('toIpcErrorPayload', () => {
  it('IpcError はコードとメッセージをそのまま渡す', () => {
    const error = new IpcError('NOT_FOUND', 'file not found', 'C:/missing.txt')

    expect(toIpcErrorPayload(error)).toEqual({
      code: 'NOT_FOUND',
      message: 'file not found',
      detail: 'C:/missing.txt'
    })
  })

  it('detail が無い IpcError には detail を付けない', () => {
    const payload = toIpcErrorPayload(invalidRequest('ping requires a non-empty token.'))

    expect(payload).toEqual({
      code: 'INVALID_REQUEST',
      message: 'ping requires a non-empty token.'
    })
    expect('detail' in payload).toBe(false)
  })

  it('想定外の例外は INTERNAL に丸め、内容は detail へ隠す', () => {
    const payload = toIpcErrorPayload(new TypeError('window is not defined'))

    expect(payload.code).toBe('INTERNAL')
    // message は呼び出し側が扱う粒度に固定し、内部の事情を混ぜない。
    expect(payload.message).toBe('Unexpected error in IPC handler.')
    expect(payload.detail).toBe('TypeError: window is not defined')
  })

  it('Error ですらない値が投げられても失敗形に正規化する', () => {
    const payload = toIpcErrorPayload('boom')

    expect(payload.code).toBe('INTERNAL')
    expect(payload.detail).toBe('boom')
  })
})
