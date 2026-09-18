import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DiagnosticsErrorRecord } from '@shared/diagnostics'
import { createErrorGate } from './errorGate'
import {
  createErrorRecordStore,
  ERROR_RECORDS_FILE_NAME,
  normalizeErrorRecordsDocument
} from './errorRecords'

let directory: string
let filePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fluvix-error-records-'))
  filePath = join(directory, 'logs', ERROR_RECORDS_FILE_NAME)
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function record(
  index: number,
  overrides: Partial<DiagnosticsErrorRecord> = {}
): DiagnosticsErrorRecord {
  return {
    kind: 'renderer-error',
    severity: 'error',
    occurredAt: 1_700_000_000_000 + index,
    appVersion: '1.0.0',
    name: 'Error',
    message: `failure ${index}`,
    stack: [],
    ...overrides
  }
}

/** エラー記録のファイル。上限で止まり、書けなくても投げない。 */
describe('createErrorRecordStore', () => {
  it('足したものが新しい順に返り、ファイルに残って次の起動でも読める', () => {
    const store = createErrorRecordStore({ resolveFilePath: () => filePath })

    store.append(record(1))
    store.append(record(2))

    expect(store.list().map((entry) => entry.message)).toEqual(['failure 2', 'failure 1'])

    const reopened = createErrorRecordStore({ resolveFilePath: () => filePath })

    expect(reopened.list().map((entry) => entry.message)).toEqual(['failure 2', 'failure 1'])
  })

  it('上限を超えたら古いものから捨てる（ファイルが無制限に増えない）', () => {
    const store = createErrorRecordStore({ resolveFilePath: () => filePath, maxRecords: 3 })

    for (let index = 1; index <= 10; index += 1) {
      store.append(record(index))
    }

    expect(store.list().map((entry) => entry.message)).toEqual([
      'failure 10',
      'failure 9',
      'failure 8'
    ])

    const saved = JSON.parse(readFileSync(filePath, 'utf8')) as { records: unknown[] }

    expect(saved.records).toHaveLength(3)
  })

  it('消すと空になり、ファイルも空の記録になる', () => {
    const store = createErrorRecordStore({ resolveFilePath: () => filePath })

    store.append(record(1))
    store.clear()

    expect(store.list()).toEqual([])
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ schemaVersion: 1, records: [] })
  })

  it('場所が取れない・相対パスならメモリにだけ持ち、何も書かない', () => {
    for (const resolveFilePath of [
      () => null,
      () => 'logs/error-reports.json',
      () => {
        throw new Error('app.getPath is not available')
      }
    ]) {
      const store = createErrorRecordStore({ resolveFilePath })

      store.append(record(1))

      expect(store.list()).toHaveLength(1)
    }

    expect(existsSync(join(process.cwd(), 'logs', ERROR_RECORDS_FILE_NAME))).toBe(false)
  })

  it('壊れたファイルは空として読み、次の記録で書き直す', () => {
    const store = createErrorRecordStore({ resolveFilePath: () => filePath })

    store.append(record(0))
    writeFileSync(filePath, '{ not json', 'utf8')

    const reopened = createErrorRecordStore({ resolveFilePath: () => filePath })

    expect(reopened.list()).toEqual([])

    reopened.append(record(1))

    expect(JSON.parse(readFileSync(filePath, 'utf8')).records).toHaveLength(1)
  })
})

describe('normalizeErrorRecordsDocument', () => {
  it('形の違う記録を捨て、残ったものは伏せ直す（手で書き換えられたファイル）', () => {
    const records = normalizeErrorRecordsDocument({
      schemaVersion: 1,
      records: [
        {
          kind: 'renderer-error',
          severity: 'error',
          occurredAt: 1,
          appVersion: '1.0.0',
          name: 'Error',
          message: 'open C:\\Users\\taro\\diary.txt token=abc',
          stack: ['at f (C:\\Users\\taro\\x.js:1:2)', 'not a frame']
        },
        { kind: 'unknown-kind', severity: 'error', occurredAt: 1 },
        { kind: 'renderer-error', severity: 'panic', occurredAt: 1 },
        'text',
        null
      ]
    })

    expect(records).toHaveLength(1)
    expect(records[0].message).not.toContain('taro')
    expect(records[0].message).not.toContain('abc')
    expect(records[0].stack).toEqual(['at f (x.js:1:2)'])
  })

  it('知らない版・object でないものは空', () => {
    expect(normalizeErrorRecordsDocument({ schemaVersion: 2, records: [] })).toEqual([])
    expect(normalizeErrorRecordsDocument([])).toEqual([])
    expect(normalizeErrorRecordsDocument(null)).toEqual([])
  })
})

describe('createErrorGate', () => {
  it('同じものは1回だけ通す', () => {
    const gate = createErrorGate(10)

    expect(gate.admit('a')).toBe(true)
    expect(gate.admit('a')).toBe(false)
    expect(gate.admit('b')).toBe(true)
  })

  it('1回の起動で上限まで', () => {
    const gate = createErrorGate(3)

    expect(['a', 'b', 'c', 'd'].map((key) => gate.admit(key))).toEqual([true, true, true, false])
  })
})
