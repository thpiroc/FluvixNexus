import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AUDIT_LOG_FILE_NAME,
  AUDIT_LOG_MAX_BYTES,
  AUDIT_ROTATED_LOG_FILE_NAME,
  createAuditLogWriter,
  nodeAuditFileSystem,
  type AuditFileSystem,
  type AuditWriteFailure
} from './auditLogWriter'
import type { AuditEvent } from './auditEvent'

/**
 * Audit Log の書き出し（Security Core v1 の STEP4）。
 *
 * 置き場所・順序・並行・1 MiB / 1世代の rotation・巨大な1件・失敗の扱いを確かめる。
 */

const DIRECTORY = join(tmpdir(), 'fluvix-audit-test-in-memory', 'logs')
const FILE = join(DIRECTORY, AUDIT_LOG_FILE_NAME)
const ROTATED = join(DIRECTORY, AUDIT_ROTATED_LOG_FILE_NAME)

interface MemoryFileSystem extends AuditFileSystem {
  readonly files: Map<string, string>
  readonly calls: string[]
  failures: {
    readonly on: 'mkdir' | 'size' | 'append' | 'rename' | 'remove'
    readonly times: number
  } | null
}

function memoryFileSystem(initial: Record<string, string> = {}): MemoryFileSystem {
  const files = new Map(Object.entries(initial))
  const calls: string[] = []
  const fileSystem: MemoryFileSystem = {
    files,
    calls,
    failures: null,
    mkdir: async (path) => {
      await step(fileSystem, 'mkdir')
      calls.push(`mkdir ${path}`)
    },
    size: async (path) => {
      await step(fileSystem, 'size')

      const content = files.get(path)

      return content === undefined ? null : Buffer.byteLength(content, 'utf8')
    },
    append: async (path, text) => {
      await step(fileSystem, 'append')
      calls.push(`append ${path}`)
      files.set(path, `${files.get(path) ?? ''}${text}`)
    },
    rename: async (from, to) => {
      await step(fileSystem, 'rename')
      calls.push(`rename ${from} ${to}`)

      const content = files.get(from)

      if (content === undefined) {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      }

      files.set(to, content)
      files.delete(from)
    },
    remove: async (path) => {
      await step(fileSystem, 'remove')
      calls.push(`remove ${path}`)
      files.delete(path)
    }
  }

  return fileSystem
}

/** 毎回 await を挟む（割り込みが起きうる状態を作る）＋ 仕込んだ失敗を起こす。 */
async function step(fileSystem: MemoryFileSystem, operation: string): Promise<void> {
  await Promise.resolve()

  const failure = fileSystem.failures

  if (failure !== null && failure.on === operation && failure.times > 0) {
    fileSystem.failures = { on: failure.on, times: failure.times - 1 }

    /*
      fs が投げる例外の message には、置き場所の絶対パス（利用者名を含む）が入る。
      環境変数を載せた spawn の失敗のように、Secret が混じることもある。
      Audit の失敗の知らせが、その両方を素通しにしないことまで確かめる。
    */
    throw Object.assign(
      new Error(
        `EPERM: ${operation} failed, open 'C:\\Users\\taro\\AppData\\Roaming\\Fluvix Nexus\\logs\\agent-audit.log' token=A1b2C3d4E5f6G7h8`
      ),
      { code: 'EPERM' }
    )
  }
}

function writerOn(
  fileSystem: AuditFileSystem,
  options: {
    readonly maxBytes?: number
    readonly directory?: () => string | null
    readonly onFailure?: (failure: AuditWriteFailure) => void
  } = {}
): ReturnType<typeof createAuditLogWriter> {
  return createAuditLogWriter({
    resolveDirectory: options.directory ?? ((): string => DIRECTORY),
    fileSystem,
    maxBytes: options.maxBytes,
    now: () => new Date('2026-09-23T09:41:02.318Z'),
    onFailure: options.onFailure
  })
}

function event(subject: string): AuditEvent {
  return { type: 'mcp-tool.requested', subject }
}

function lines(text: string | undefined): string[] {
  return (text ?? '').split('\n').filter((line) => line.length > 0)
}

describe('置き場所', () => {
  it('フォルダは最初の1件で作り、1件ごとに1行を足す', async () => {
    const fileSystem = memoryFileSystem()
    const writer = writerOn(fileSystem)

    expect(fileSystem.calls).toEqual([])

    await writer.write(event('first'))
    await writer.write(event('second'))

    const written = lines(fileSystem.files.get(FILE))

    expect(written).toHaveLength(2)
    expect(written.map((line) => (JSON.parse(line) as { subject: string }).subject)).toEqual([
      'first',
      'second'
    ])
    expect(fileSystem.calls.filter((call) => call.startsWith('mkdir'))).toEqual([
      `mkdir ${DIRECTORY}`
    ])
  })

  it('置き場所が取れないときは失敗として知らせ、投げない', async () => {
    const failures: AuditWriteFailure[] = []
    const fileSystem = memoryFileSystem()

    for (const directory of [
      (): null => null,
      (): string => '',
      (): string => 'logs',
      (): string => {
        throw new TypeError('app.getPath is not a function')
      }
    ]) {
      const writer = writerOn(fileSystem, { directory, onFailure: (f) => failures.push(f) })

      await expect(writer.write(event('a'))).resolves.toBeUndefined()
    }

    expect(failures).toHaveLength(4)
    expect(fileSystem.files.size).toBe(0)
  })
})

describe('順序と並行', () => {
  it('待たずに並べても、呼んだ順のまま1行ずつ書かれる', async () => {
    const fileSystem = memoryFileSystem()
    const writer = writerOn(fileSystem)
    const count = 50

    for (let index = 0; index < count; index += 1) {
      void writer.write(event(`event-${index}`))
    }

    await writer.whenIdle()

    const written = lines(fileSystem.files.get(FILE))

    expect(written).toHaveLength(count)
    expect(written.map((line) => (JSON.parse(line) as { subject: string }).subject)).toEqual(
      Array.from({ length: count }, (_value, index) => `event-${index}`)
    )
  })

  it('rotation の最中に別の書き込みが割り込まない', async () => {
    const fileSystem = memoryFileSystem()
    const writer = writerOn(fileSystem, { maxBytes: 260 })

    for (let index = 0; index < 20; index += 1) {
      void writer.write(event(`event-${index}`))
    }

    await writer.whenIdle()

    // 現在の Log と .1 を合わせて、1件も欠けず・重ならずに並んでいる。
    const all = [...lines(fileSystem.files.get(ROTATED)), ...lines(fileSystem.files.get(FILE))]
    const subjects = all.map((line) => (JSON.parse(line) as { subject: string }).subject)

    expect(subjects).toEqual([...subjects].sort((left, right) => order(left) - order(right)))
    expect(new Set(subjects).size).toBe(subjects.length)

    // rename の直後に、前の Log への append が来ていない。
    const relevant = fileSystem.calls.filter(
      (call) => call.startsWith('append') || call.startsWith('rename')
    )

    for (const [index, call] of relevant.entries()) {
      if (call.startsWith('rename')) {
        expect(relevant[index + 1] ?? 'append').toMatch(/^append/)
      }
    }
  })
})

describe('Rotation', () => {
  it('1 MiB に届くまでは回さない', async () => {
    const fileSystem = memoryFileSystem({ [FILE]: 'x'.repeat(AUDIT_LOG_MAX_BYTES - 400) })
    const writer = writerOn(fileSystem)

    await writer.write(event('still-fits'))

    expect(fileSystem.files.has(ROTATED)).toBe(false)
    expect(fileSystem.files.get(FILE)?.startsWith('x'.repeat(100))).toBe(true)
  })

  it('次の1件で 1 MiB を超えるなら、その前に回す', async () => {
    const fileSystem = memoryFileSystem({ [FILE]: 'x'.repeat(AUDIT_LOG_MAX_BYTES - 40) })
    const writer = writerOn(fileSystem)

    await writer.write(event('does-not-fit'))

    expect(fileSystem.files.get(ROTATED)).toBe('x'.repeat(AUDIT_LOG_MAX_BYTES - 40))
    expect(lines(fileSystem.files.get(FILE))).toHaveLength(1)
  })

  it('古い .1 は置き換わり、世代は1つより増えない', async () => {
    const fileSystem = memoryFileSystem({ [ROTATED]: 'older generation' })
    const writer = writerOn(fileSystem, { maxBytes: 260 })

    for (let index = 0; index < 12; index += 1) {
      await writer.write(event(`event-${index}`))
    }

    expect([...fileSystem.files.keys()].sort()).toEqual([FILE, ROTATED].sort())
    expect(fileSystem.files.get(ROTATED)).not.toContain('older generation')
    expect(lines(fileSystem.files.get(FILE)).length).toBeGreaterThan(0)
    expect(Buffer.byteLength(fileSystem.files.get(FILE) ?? '', 'utf8')).toBeLessThanOrEqual(260)
  })

  it('回した後の新しい Log にも、続けて書ける', async () => {
    const fileSystem = memoryFileSystem({ [FILE]: 'x'.repeat(250) })
    const writer = writerOn(fileSystem, { maxBytes: 260 })

    await writer.write(event('after-rotation'))
    await writer.write(event('and-again'))

    const written = lines(fileSystem.files.get(FILE))

    expect(written).toHaveLength(2)
    expect(fileSystem.files.get(ROTATED)).toBe('x'.repeat(250))
  })

  it('前のセッションが既に上限へ届いていても、1件で上限を大きく超えない', async () => {
    const fileSystem = memoryFileSystem({ [FILE]: 'x'.repeat(AUDIT_LOG_MAX_BYTES * 2) })
    const writer = writerOn(fileSystem)

    await writer.write(event('fresh'))

    expect(lines(fileSystem.files.get(FILE))).toHaveLength(1)
  })

  it('巨大な1件でも、Log の大きさは上限の中に収まる', async () => {
    const fileSystem = memoryFileSystem()
    const writer = writerOn(fileSystem, { maxBytes: 4096 })

    for (let index = 0; index < 20; index += 1) {
      await writer.write({
        type: 'mcp-tool.requested',
        subject: `${'a'.repeat(50_000)} ${index}`,
        error: new Error('b'.repeat(50_000))
      })
    }

    for (const path of [FILE, ROTATED]) {
      expect(Buffer.byteLength(fileSystem.files.get(path) ?? '', 'utf8')).toBeLessThanOrEqual(4096)
    }
  })
})

describe('失敗', () => {
  it.each([['mkdir'], ['size'], ['append'], ['rename']] as const)(
    '%s が失敗しても投げず、Secret を含まない要約で知らせる',
    async (operation) => {
      const fileSystem = memoryFileSystem(operation === 'rename' ? { [FILE]: 'x'.repeat(250) } : {})
      const failures: AuditWriteFailure[] = []
      const writer = writerOn(fileSystem, {
        maxBytes: 260,
        onFailure: (failure) => failures.push(failure)
      })

      fileSystem.failures = { on: operation, times: 1 }

      await expect(writer.write(event('token=A1b2C3d4E5f6G7h8'))).resolves.toBeUndefined()

      expect(failures).toHaveLength(1)
      expect(failures[0].consecutiveFailures).toBe(1)
      expect(failures[0].summary).toContain('EPERM')
      expect(failures[0].summary).not.toContain('A1b2C3d4')
      expect(failures[0].summary).not.toContain('taro')
      expect(failures[0].summary.split('\n')).toHaveLength(1)
    }
  )

  it('失敗した後の1件は、開き直して書ける', async () => {
    const fileSystem = memoryFileSystem()
    const failures: AuditWriteFailure[] = []
    const writer = writerOn(fileSystem, { onFailure: (failure) => failures.push(failure) })

    fileSystem.failures = { on: 'append', times: 1 }

    await writer.write(event('lost'))
    await writer.write(event('kept'))

    expect(failures).toHaveLength(1)
    expect(lines(fileSystem.files.get(FILE))).toHaveLength(1)
    expect(fileSystem.files.get(FILE)).toContain('kept')
  })

  it('続けて失敗した回数を数える（知らせ方は呼び出し側が決める）', async () => {
    const fileSystem = memoryFileSystem()
    const failures: AuditWriteFailure[] = []
    const writer = writerOn(fileSystem, { onFailure: (failure) => failures.push(failure) })

    fileSystem.failures = { on: 'append', times: 3 }

    await writer.write(event('a'))
    await writer.write(event('b'))
    await writer.write(event('c'))
    await writer.write(event('d'))

    expect(failures.map((failure) => failure.consecutiveFailures)).toEqual([1, 2, 3])
    expect(fileSystem.files.get(FILE)).toContain('"subject":"d"')
  })

  it('知らせる側が投げても、書き込みは解決する', async () => {
    const fileSystem = memoryFileSystem()
    const writer = writerOn(fileSystem, {
      onFailure: () => {
        throw new Error('onFailure exploded')
      }
    })

    fileSystem.failures = { on: 'append', times: 1 }

    await expect(writer.write(event('a'))).resolves.toBeUndefined()
  })

  it('Sanitize できない event でも、列は止まらない', async () => {
    const fileSystem = memoryFileSystem()
    const writer = writerOn(fileSystem)
    const broken = {
      type: 'file-write.requested',
      get subject(): string {
        throw new Error('nope')
      }
    } as unknown as AuditEvent

    await expect(writer.write(broken)).resolves.toBeUndefined()
    await writer.write(event('after'))

    const written = lines(fileSystem.files.get(FILE))

    expect(written).toHaveLength(2)
    expect(JSON.parse(written[0]) as Record<string, unknown>).toMatchObject({
      event: 'audit.unrecognized-event',
      reason: 'sanitize-failed'
    })
  })
})

describe('実際のファイルへ書く', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('logs フォルダが無ければ作り、1行ずつ書く', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fluvix-audit-'))

    roots.push(root)

    const directory = join(root, 'logs')
    const writer = createAuditLogWriter({
      resolveDirectory: () => directory,
      fileSystem: nodeAuditFileSystem
    })

    expect(existsSync(directory)).toBe(false)

    await writer.write({ type: 'policy.decided', decision: 'deny', reason: 'secret-file' })
    await writer.write({
      type: 'file-write.denied',
      decision: 'deny',
      reason: 'outside-workspace',
      workspacePath: 'src/index.ts'
    })
    await writer.whenIdle()

    const written = lines(readFileSync(join(directory, AUDIT_LOG_FILE_NAME), 'utf8'))

    expect(written).toHaveLength(2)
    expect(written.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual([
      'policy.decided',
      'file-write.denied'
    ])
  })

  it('Secret は Log にも .1 にも残らない', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fluvix-audit-'))

    roots.push(root)

    const directory = join(root, 'logs')
    const writer = createAuditLogWriter({
      resolveDirectory: () => directory,
      fileSystem: nodeAuditFileSystem,
      maxBytes: 400
    })
    const secrets = [
      'sk-ant-api03-ABCdefGHIjklMNOpqrSTUvwx1234567890',
      'ghp_A1b2C3d4E5f6G7h8A1b2C3d4E5f6G7h8',
      'password=Sup3rS3cretValue',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890abcdef\n-----END RSA PRIVATE KEY-----'
    ]

    for (const secret of secrets) {
      await writer.write({ type: 'secret.masked', subject: secret })
      await writer.write({ type: 'external-send.denied', error: new Error(`failed: ${secret}`) })
    }

    await writer.whenIdle()

    const contents = [AUDIT_LOG_FILE_NAME, AUDIT_ROTATED_LOG_FILE_NAME]
      .map((name) => join(directory, name))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(contents.length).toBeGreaterThan(0)

    for (const fragment of ['sk-ant-api03', 'ghp_A1b2', 'Sup3rS3cretValue', 'MIIEowIBAAKCAQEA']) {
      expect(contents).not.toContain(fragment)
    }
  })
})

/** `event-12` → 12。 */
function order(subject: string): number {
  return Number.parseInt(subject.replace('event-', ''), 10)
}
