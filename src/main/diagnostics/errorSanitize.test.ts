import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTICS_ERROR_MESSAGE_MAX_LENGTH,
  DIAGNOSTICS_ERROR_STACK_MAX_LINES
} from '@shared/diagnostics'
import {
  createErrorRecord,
  describeThrown,
  sanitizeErrorMessage,
  sanitizeErrorStack,
  sanitizeStackFrame
} from './errorSanitize'

/** 診断情報に載るエラーの伏せ方。**伏せ漏れを許さない**側を確かめる。 */
describe('sanitizeErrorMessage', () => {
  it('Windows のパス（空白を含むユーザー名も）を伏せる', () => {
    const message = sanitizeErrorMessage(
      "ENOENT: no such file or directory, open 'C:\\Users\\Taro Yamada\\secret\\notes.txt'"
    )

    expect(message).not.toContain('Taro')
    expect(message).not.toContain('Users')
    expect(message).toContain('<path>')
  })

  it('POSIX のパス・file URI・UNC を伏せる', () => {
    const message = sanitizeErrorMessage(
      'failed at /home/taro/project/a.ts and file:///C:/Users/taro/b.ts and \\\\server\\share\\taro\\c.ts'
    )

    expect(message).not.toContain('taro')
  })

  it('token・password・API キー・Bearer の値を伏せる', () => {
    const message = sanitizeErrorMessage(
      'request failed: token=abc123 password: hunter2 api_key=sk-XYZ Authorization Bearer eyJhbGciOi ghp_0123456789abcdefABCDEF https://user:pat@github.com/x'
    )

    for (const secret of [
      'abc123',
      'hunter2',
      'sk-XYZ',
      'eyJhbGciOi',
      'ghp_0123456789',
      'user:pat'
    ]) {
      expect(message).not.toContain(secret)
    }
  })

  it('"…" の中身（JSON の断片などファイルの中身になりうるもの）を伏せ、識別子の \'…\' は残す', () => {
    const message = sanitizeErrorMessage(
      "Unexpected token 'a', \"apiKey: my-private-value\" is not valid JSON; reading 'foo'"
    )

    expect(message).not.toContain('my-private-value')
    expect(message).toContain('"<text>"')
    expect(message).toContain("'a'")
    expect(message).toContain("'foo'")
  })

  it('改行を1行に畳み、上限で切る', () => {
    expect(sanitizeErrorMessage('line1\nline2')).toBe('line1 line2')

    const long = sanitizeErrorMessage('x'.repeat(DIAGNOSTICS_ERROR_MESSAGE_MAX_LENGTH * 3))

    expect(long.length).toBe(DIAGNOSTICS_ERROR_MESSAGE_MAX_LENGTH + 1)
    expect(long.endsWith('…')).toBe(true)
  })

  it('文字列でなければ空', () => {
    expect(sanitizeErrorMessage(undefined)).toBe('')
    expect(sanitizeErrorMessage({ secret: 'x' })).toBe('')
  })
})

describe('sanitizeErrorStack', () => {
  it('`at` の行だけを残し、パスをファイル名:行:桁 に縮める', () => {
    const stack = [
      'Error: open "C:\\Users\\taro\\secret.txt" failed',
      '    at readConfig (C:\\Users\\taro\\AppData\\Local\\Programs\\Fluvix Nexus\\resources\\app.asar\\out\\main\\index.js:120:15)',
      '    at file:///C:/Users/taro/AppData/Local/Programs/Fluvix%20Nexus/resources/app.asar/out/renderer/assets/index-abc.js:3:77',
      '    at async Promise.all (index 0)',
      '    at node:internal/process/task_queues:95:5',
      '    at /home/taro/dev/app/out/main/index.js:9:1'
    ].join('\n')

    expect(sanitizeErrorStack(stack)).toEqual([
      'at readConfig (index.js:120:15)',
      'at index-abc.js:3:77',
      'at async Promise.all (index 0)',
      'at node:internal/process/task_queues:95:5',
      'at index.js:9:1'
    ])
  })

  it('行数に上限がある', () => {
    const stack = Array.from(
      { length: 100 },
      (_, index) => `    at f${index} (C:\\a\\b.js:1:1)`
    ).join('\n')

    expect(sanitizeErrorStack(stack)).toHaveLength(DIAGNOSTICS_ERROR_STACK_MAX_LINES)
  })

  it('開発時の http URL はクエリを残さずに済むよう、パスでなければそのまま伏せだけ掛ける', () => {
    expect(sanitizeStackFrame('at App (http://localhost:5173/src/App.tsx:10:3)')).toBe(
      'at App (http://localhost:5173/src/App.tsx:10:3)'
    )
  })

  it('文字列でなければ空', () => {
    expect(sanitizeErrorStack(undefined)).toEqual([])
    expect(sanitizeErrorStack(42)).toEqual([])
  })
})

describe('createErrorRecord / describeThrown', () => {
  it('Error を名前・message・stack に分けて、伏せた記録にする', () => {
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'x') at C:\\Users\\taro\\a.js"
    )
    const record = createErrorRecord({
      kind: 'main-uncaught-exception',
      severity: 'fatal',
      occurredAt: 1_700_000_000_000,
      appVersion: '1.0.0',
      ...describeThrown(error)
    })

    expect(record.kind).toBe('main-uncaught-exception')
    expect(record.name).toBe('TypeError')
    expect(record.message).not.toContain('taro')
    expect(record.stack.every((line) => line.startsWith('at '))).toBe(true)
    expect(record.stack.join('\n')).not.toContain('taro')
  })

  it('Error でない値も投げずに記録にする（object の中身は辿らない）', () => {
    expect(describeThrown('boom')).toEqual({ name: 'NonError', message: 'boom', stack: '' })
    expect(describeThrown({ password: 'x' })).toEqual({
      name: 'NonError',
      message: '[object]',
      stack: ''
    })
    expect(describeThrown(null).message).toBe('null')
  })

  it('伏せ直しても結果が変わらない（保存した記録を読み直すとき）', () => {
    const first = createErrorRecord({
      kind: 'renderer-error',
      severity: 'error',
      occurredAt: 1,
      appVersion: '1.0.0',
      name: 'Error',
      message: `"secret" at C:\\Users\\taro\\x.js ${'y'.repeat(2000)}`,
      stack: '    at f (C:\\Users\\taro\\x.js:1:2)'
    })
    const second = createErrorRecord({ ...first, stack: first.stack.join('\n') })

    expect(second).toEqual(first)
  })
})
