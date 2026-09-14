import { describe, expect, it } from 'vitest'
import {
  createDebugAdapterReadinessScanner,
  type DebugAdapterSocketReadiness
} from './adapterTransport'

/**
 * socket の adapter の ready の合図（Session 6-15A）。
 *
 * 文言は表の側（catalog の行）が持つ。ここでは「行が揃ってから当てる」「port だけを読む」
 * 「loopback 以外を名乗ったら ready にしない」「待ち続けない（溜める上限）」を見る。
 */

const READINESS: DebugAdapterSocketReadiness = {
  kind: 'stdout-pattern',
  pattern: /^Debug server listening at (?<host>[^\s]+?):(?<port>[0-9]+)$/
}

describe('createDebugAdapterReadinessScanner', () => {
  it('waits for a complete line and reads the port', () => {
    const scanner = createDebugAdapterReadinessScanner(READINESS)

    expect(scanner.push('starting...\nDebug server listening at 127.0.0.1:')).toEqual({
      status: 'waiting'
    })
    expect(scanner.push('53123\r\n')).toEqual({ status: 'ready', port: 53123 })
  })

  it('keeps the first answer once settled', () => {
    const scanner = createDebugAdapterReadinessScanner(READINESS)

    expect(scanner.push('Debug server listening at localhost:4711\n')).toEqual({
      status: 'ready',
      port: 4711
    })
    expect(scanner.push('Debug server listening at 127.0.0.1:1\n')).toEqual({
      status: 'ready',
      port: 4711
    })
  })

  it.each([
    ['a remote host', 'Debug server listening at 10.0.0.5:4711\n'],
    ['a wildcard host', 'Debug server listening at 0.0.0.0:4711\n'],
    ['port 0', 'Debug server listening at 127.0.0.1:0\n'],
    ['an out of range port', 'Debug server listening at 127.0.0.1:70000\n'],
    ['a too long port', 'Debug server listening at 127.0.0.1:000004711\n']
  ])('does not become ready for %s', (_name, line) => {
    expect(createDebugAdapterReadinessScanner(READINESS).push(line)).toMatchObject({
      status: 'invalid'
    })
  })

  it('requires a named port group', () => {
    const scanner = createDebugAdapterReadinessScanner({
      kind: 'stdout-pattern',
      pattern: /^listening on ([0-9]+)$/
    })

    expect(scanner.push('listening on 4711\n')).toMatchObject({ status: 'invalid' })
  })

  it('accepts a pattern without a host group (the host is always 127.0.0.1)', () => {
    const scanner = createDebugAdapterReadinessScanner({
      kind: 'stdout-pattern',
      pattern: /port=(?<port>[0-9]+)/
    })

    expect(scanner.push('ready port=9229\n')).toEqual({ status: 'ready', port: 9229 })
  })

  it('gives the same answer for a global / sticky pattern', () => {
    const scanner = createDebugAdapterReadinessScanner({
      kind: 'stdout-pattern',
      pattern: /port=(?<port>[0-9]+)/gy
    })

    expect(scanner.push('noise\nport=1234\n')).toEqual({ status: 'ready', port: 1234 })
  })

  it('gives up when too much output arrives without a line break', () => {
    const scanner = createDebugAdapterReadinessScanner(READINESS, 16)

    expect(scanner.push('x'.repeat(17))).toMatchObject({ status: 'invalid' })
  })
})
