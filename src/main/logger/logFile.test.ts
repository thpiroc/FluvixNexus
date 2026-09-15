import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOG_FILE_NAME,
  ROTATED_LOG_FILE_NAME,
  createLogFileSink,
  nodeLogFileSystem,
  type LogFileSystem
} from './logFile'

const DIRECTORY = join(tmpdir(), 'fluvix-log-test-in-memory')
const FILE = join(DIRECTORY, LOG_FILE_NAME)
const ROTATED = join(DIRECTORY, ROTATED_LOG_FILE_NAME)

function memoryFileSystem(initial: Record<string, string> = {}): LogFileSystem & {
  readonly files: Map<string, string>
  readonly calls: string[]
} {
  const files = new Map(Object.entries(initial))
  const calls: string[] = []

  return {
    files,
    calls,
    mkdir: (path) => {
      calls.push(`mkdir ${path}`)
    },
    size: (path) => {
      const content = files.get(path)

      return content === undefined ? null : Buffer.byteLength(content, 'utf8')
    },
    append: (path, text) => {
      calls.push(`append ${path}`)
      files.set(path, `${files.get(path) ?? ''}${text}`)
    },
    rename: (from, to) => {
      calls.push(`rename ${from} ${to}`)
      const content = files.get(from)

      if (content === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }

      files.set(to, content)
      files.delete(from)
    },
    remove: (path) => {
      calls.push(`remove ${path}`)
      files.delete(path)
    }
  }
}

/** Session 7-1C ── 配布版で残るログ。上限で止まり、書けなくてもアプリを止めない。 */
describe('createLogFileSink', () => {
  it('creates the folder lazily, writes a header once, then one line per record', () => {
    const fileSystem = memoryFileSystem()
    const sink = createLogFileSink({
      resolveDirectory: () => DIRECTORY,
      fileSystem,
      createHeader: () => 'header'
    })

    expect(fileSystem.calls).toEqual([])

    sink.write('first')
    sink.write('second')

    expect(fileSystem.files.get(FILE)).toBe('header\nfirst\nsecond\n')
    expect(fileSystem.calls.filter((call) => call.startsWith('mkdir'))).toHaveLength(1)
  })

  it.each([
    ['null', () => null],
    ['an empty string', () => ''],
    ['a relative path (a mocked app.getPath)', () => 'logs'],
    [
      'a throwing resolver (app.getPath missing)',
      () => {
        throw new TypeError('app.getPath is not a function')
      }
    ]
  ])('writes nothing when the directory is %s', (_label, resolveDirectory) => {
    const fileSystem = memoryFileSystem()
    let failures = 0
    const sink = createLogFileSink({
      resolveDirectory,
      fileSystem,
      onFailure: () => {
        failures += 1
      }
    })

    sink.write('a')
    sink.write('b')

    expect(fileSystem.calls).toEqual([])
    expect(failures).toBe(0)
  })

  it('rotates to one old generation before the file would exceed the limit', () => {
    const fileSystem = memoryFileSystem()
    const sink = createLogFileSink({ resolveDirectory: () => DIRECTORY, fileSystem, maxBytes: 20 })

    sink.write('aaaaaaaaa') // 10 bytes
    sink.write('bbbbbbbbb') // 20 bytes: fits exactly
    sink.write('ccccccccc') // would be 30: rotate first
    sink.write('ddddddddd')
    sink.write('eeeeeeeee') // rotate again: the oldest generation is dropped

    expect(fileSystem.files.get(FILE)).toBe('eeeeeeeee\n')
    expect(fileSystem.files.get(ROTATED)).toBe('ccccccccc\nddddddddd\n')
    expect([...fileSystem.files.keys()].sort()).toEqual([FILE, ROTATED].sort())
  })

  it('starts a fresh file when the previous session already reached the limit', () => {
    const fileSystem = memoryFileSystem({ [FILE]: 'x'.repeat(30), [ROTATED]: 'older' })
    const sink = createLogFileSink({ resolveDirectory: () => DIRECTORY, fileSystem, maxBytes: 20 })

    sink.write('new')

    expect(fileSystem.files.get(FILE)).toBe('new\n')
    expect(fileSystem.files.get(ROTATED)).toBe('x'.repeat(30))
  })

  it('appends to a previous file that is still under the limit', () => {
    const fileSystem = memoryFileSystem({ [FILE]: 'old\n' })
    const sink = createLogFileSink({ resolveDirectory: () => DIRECTORY, fileSystem, maxBytes: 20 })

    sink.write('new')

    expect(fileSystem.files.get(FILE)).toBe('old\nnew\n')
  })

  it('stops writing after a failure, reports it once, and never throws', () => {
    const fileSystem = memoryFileSystem()
    let appends = 0
    const failures: unknown[] = []
    const sink = createLogFileSink({
      resolveDirectory: () => DIRECTORY,
      fileSystem: {
        ...fileSystem,
        append: () => {
          appends += 1
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
        }
      },
      onFailure: (cause) => {
        failures.push(cause)
        throw new Error('the reporter failed too')
      }
    })

    expect(() => {
      sink.write('a')
      sink.write('b')
      sink.write('c')
    }).not.toThrow()
    expect(appends).toBe(1)
    expect(failures).toHaveLength(1)
  })

  it('stops writing when the folder cannot be created', () => {
    const fileSystem = memoryFileSystem()
    let failures = 0
    const sink = createLogFileSink({
      resolveDirectory: () => DIRECTORY,
      fileSystem: {
        ...fileSystem,
        mkdir: () => {
          throw new Error('EPERM')
        }
      },
      onFailure: () => {
        failures += 1
      }
    })

    sink.write('a')
    sink.write('b')

    expect(fileSystem.files.size).toBe(0)
    expect(failures).toBe(1)
  })
})

/** 実ディスク（一時フォルダ）で、Node の fs に載せた形が同じように回ること。 */
describe('nodeLogFileSystem', () => {
  let directory: string | null = null

  afterEach(() => {
    if (directory !== null) {
      rmSync(directory, { recursive: true, force: true })
      directory = null
    }
  })

  it('creates nested folders, rotates on disk and keeps the total bounded', () => {
    directory = mkdtempSync(join(tmpdir(), 'fluvix-log-'))
    const logs = join(directory, 'nested', 'logs')
    const sink = createLogFileSink({
      resolveDirectory: () => logs,
      fileSystem: nodeLogFileSystem,
      maxBytes: 64
    })

    for (let index = 0; index < 50; index += 1) {
      sink.write(`line ${String(index).padStart(2, '0')} 日本語`)
    }

    const current = join(logs, LOG_FILE_NAME)
    const rotated = join(logs, ROTATED_LOG_FILE_NAME)

    expect(statSync(current).size).toBeLessThanOrEqual(64)
    expect(statSync(rotated).size).toBeLessThanOrEqual(64)
    expect(readFileSync(current, 'utf8')).toContain('line 49 日本語\n')
  })

  it('treats a missing file as empty and removing a missing file as done', () => {
    directory = mkdtempSync(join(tmpdir(), 'fluvix-log-'))
    const missing = join(directory, 'missing.log')

    expect(nodeLogFileSystem.size(missing)).toBeNull()
    expect(() => nodeLogFileSystem.remove(missing)).not.toThrow()

    writeFileSync(missing, 'abc')
    expect(nodeLogFileSystem.size(missing)).toBe(3)
    nodeLogFileSystem.remove(missing)
    expect(existsSync(missing)).toBe(false)
  })
})
