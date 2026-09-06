import { describe, expect, it } from 'vitest'
import {
  createDidChangeParams,
  createDidCloseParams,
  createDidOpenParams,
  createDidSaveParams
} from './textDocumentNotifications'

/**
 * 通知1通の形（Session 5-2）。
 *
 * 電文の組み立てそのものは jsonRpcMessage.ts が持つので、ここで確かめるのは
 * **LSP が決めている形に収まっているか**だけになる。
 *
 * | 観点                           | 外すと何が起きるか                                    |
 * | ------------------------------ | ----------------------------------------------------- |
 * | didSave に版が載らない         | 未保存かの数（Undo で戻る）が LSP の版へ混ざる        |
 * | 全文の変更に `range` を出さない | `range: null` は仕様に無く、サーバの扱いが分かれる     |
 * | 差分の並びを変えない           | 複数カーソルの編集が、適用順の違いでずれる            |
 */

const URI = 'file:///D%3A/proj/src/app.ts'

describe('createDidOpenParams', () => {
  it('言語・版・全文を1つの textDocument に載せる', () => {
    expect(createDidOpenParams(URI, 'typescript', 3, 'const a = 1')).toEqual({
      textDocument: { uri: URI, languageId: 'typescript', version: 3, text: 'const a = 1' }
    })
  })
})

describe('createDidChangeParams', () => {
  it('範囲を持つ差分は、範囲ごとそのまま載せる', () => {
    const range = {
      start: { line: 0, character: 6 },
      end: { line: 0, character: 7 }
    }

    expect(createDidChangeParams(URI, 4, [{ range, text: 'b' }])).toEqual({
      textDocument: { uri: URI, version: 4 },
      contentChanges: [{ range, text: 'b' }]
    })
  })

  it('範囲を持たない変更（全置換）は `range` の欄そのものを落とす', () => {
    const params = createDidChangeParams(URI, 5, [{ range: null, text: 'whole file' }])
    const changes = (params.contentChanges as readonly Record<string, unknown>[])[0]

    expect(changes).toEqual({ text: 'whole file' })
    expect('range' in changes).toBe(false)
  })

  it('差分の並びを変えない（前から順に適用される決まりのため）', () => {
    const first = {
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
      text: 'z'
    }
    const second = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      text: 'a'
    }

    const params = createDidChangeParams(URI, 6, [first, second])

    expect(params.contentChanges).toEqual([first, second])
  })
})

describe('createDidSaveParams', () => {
  it('uri だけを載せる（版も本文も持たない）', () => {
    const params = createDidSaveParams(URI)

    expect(params).toEqual({ textDocument: { uri: URI } })
    expect('version' in (params.textDocument as Record<string, unknown>)).toBe(false)
    expect('text' in (params.textDocument as Record<string, unknown>)).toBe(false)
  })
})

describe('createDidCloseParams', () => {
  it('uri だけを載せる', () => {
    expect(createDidCloseParams(URI)).toEqual({ textDocument: { uri: URI } })
  })
})
