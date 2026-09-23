import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import * as sideEffectApi from './index'
import * as lockModule from './sideEffectLock'
import { createSideEffectLock } from './sideEffectLock'

/**
 * 副作用のある操作の共有ロック（Security Core v1 の STEP9）。
 *
 * File Write と Terminal が**種類をまたいで同時に1件だけ**になること、取った本人しか
 * 外せないこと、外から外す口が無いことを固定する。
 */

describe('同時に1件だけ', () => {
  it('File Write を持っている間は、Terminal も2件目の File Write も取れない', () => {
    const lock = createSideEffectLock()
    const write = lock.acquire('file.write')

    expect(write.ok).toBe(true)
    expect(lock.heldBy()).toBe('file.write')
    expect(lock.acquire('terminal.run')).toEqual({ ok: false, heldBy: 'file.write' })
    expect(lock.acquire('file.write')).toEqual({ ok: false, heldBy: 'file.write' })
  })

  it('外せば、次の操作が取れる', () => {
    const lock = createSideEffectLock()
    const terminal = lock.acquire('terminal.run')

    if (!terminal.ok) {
      throw new Error('expected the lock')
    }

    terminal.lease.release()

    expect(lock.heldBy()).toBeNull()
    expect(lock.acquire('file.write').ok).toBe(true)
  })

  it('古い lease を2回外しても、次に取った別のロックは外れない', () => {
    const lock = createSideEffectLock()
    const first = lock.acquire('file.write')

    if (!first.ok) {
      throw new Error('expected the lock')
    }

    first.lease.release()

    const second = lock.acquire('terminal.run')

    first.lease.release()

    expect(second.ok).toBe(true)
    expect(lock.heldBy()).toBe('terminal.run')
  })

  it('知らない種類では取れない（承認の対象の2つだけ）', () => {
    const lock = createSideEffectLock()

    for (const kind of [
      'mcp.write',
      'git.push',
      'file.read',
      '',
      null,
      undefined,
      {},
      'toString'
    ]) {
      expect(lock.acquire(kind).ok).toBe(false)
    }

    expect(lock.heldBy()).toBeNull()
  })
})

describe('公開する名前', () => {
  it('取る口と、持っているかを見る口だけ（外から外す口は無い）', () => {
    expect(Object.keys(sideEffectApi).sort()).toEqual([
      'acquireSideEffect',
      'isSideEffectInProgress'
    ])
    expect(Object.keys(lockModule).sort()).toEqual(['createSideEffectLock'])
  })

  it('どのファイルも、ロックを飛ばす・外す名前を export していない', () => {
    const directory = join(__dirname)

    for (const name of readdirSync(directory).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts')
    )) {
      const exported = readFileSync(join(directory, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(
        exported.filter((line) => /bypass|skip|force|unlock|reset|clear|override/i.test(line))
      ).toEqual([])
    }
  })

  it('File Write と Terminal の Gate は、同じロックを使う', () => {
    for (const file of [
      join(__dirname, '..', 'fileWrite', 'currentFileWriteGate.ts'),
      join(__dirname, '..', 'terminalRun', 'currentTerminalRunGate.ts')
    ]) {
      const source = readFileSync(file, 'utf8')

      expect(source).toContain("from '../sideEffect/currentSideEffectLock'")
      expect(source).toMatch(/^\s*acquireSideEffect\s*$/m)
    }
  })
})
