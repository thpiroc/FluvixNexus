import { describe, expect, it } from 'vitest'
import { ipcFailure, ipcSuccess } from '@shared/ipc'
import type { IpcErrorCode } from '@shared/ipc'
import { createTranslator } from '../i18n/messages'
import { IpcCallError, describeIpcError, unwrapIpcResult } from './result'

/*
  文言は辞書が正本になった（Session 4-5B）。t は必須引数なので、
  渡し忘れ（＝English でも日本語が出る）は型で落ちる。
*/
const t = createTranslator('ja')

/** 契約に定義されたエラーコードの一覧。UI 文言の網羅漏れを検出するために使う。 */
const ALL_ERROR_CODES: readonly IpcErrorCode[] = [
  'INVALID_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'BUSY',
  'PERMISSION_DENIED',
  'UNSUPPORTED',
  'CANCELLED',
  'CHANNEL_UNAVAILABLE',
  'INTERNAL'
]

describe('unwrapIpcResult', () => {
  it('成功なら値を取り出す', () => {
    expect(unwrapIpcResult(ipcSuccess({ token: 'abc' }))).toEqual({ token: 'abc' })
  })

  it('失敗なら IpcCallError としてコードを保ったまま投げる', () => {
    const result = ipcFailure({ code: 'NOT_FOUND', message: 'missing', detail: 'x' })

    try {
      unwrapIpcResult(result)
      expect.unreachable('IpcCallError が投げられるはず')
    } catch (cause) {
      expect(cause).toBeInstanceOf(IpcCallError)
      expect((cause as IpcCallError).code).toBe('NOT_FOUND')
      expect((cause as IpcCallError).detail).toBe('x')
    }
  })
})

describe('describeIpcError', () => {
  it('すべてのエラーコードに利用者向けの文言がある', () => {
    for (const code of ALL_ERROR_CODES) {
      const message = describeIpcError({ code, message: 'developer facing message' }, t)

      expect(message.length).toBeGreaterThan(0)
      // Main から来る開発者向けの message をそのまま出さないこと。
      expect(message).not.toBe('developer facing message')
    }
  })
})
