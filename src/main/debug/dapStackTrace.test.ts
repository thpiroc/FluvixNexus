import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { toFileUri } from '../lsp/documentUri'
import { isWindows } from '../platform'
import {
  DAP_STACK_TRACE_LEVELS,
  createStackTraceArguments,
  parseStackTraceResponse
} from './dapStackTrace'

const ROOT = isWindows ? 'D:\\proj' : '/proj'

describe('DAP stackTrace request', () => {
  it('asks for the first page of stack frames for the selected thread', () => {
    expect(createStackTraceArguments(7)).toEqual({
      threadId: 7,
      startFrame: 0,
      levels: DAP_STACK_TRACE_LEVELS
    })
  })
})

describe('DAP stackTrace response', () => {
  it('normalizes stack frames into the safe domain model', () => {
    expect(
      parseStackTraceResponse(ROOT, {
        stackFrames: [
          {
            id: 10,
            name: 'main',
            source: { path: resolve(ROOT, 'src/app.ts'), sourceReference: 99 },
            line: 12,
            column: 3
          },
          {
            id: 11,
            name: 'helper',
            source: { path: toFileUri(resolve(ROOT, 'src/helper.ts')) },
            line: 8,
            column: 1
          }
        ]
      })
    ).toEqual([
      {
        id: 10,
        name: 'main',
        source: { kind: 'workspace', relativePath: 'src/app.ts', name: 'app.ts' },
        line: 12,
        column: 3
      },
      {
        id: 11,
        name: 'helper',
        source: { kind: 'workspace', relativePath: 'src/helper.ts', name: 'helper.ts' },
        line: 8,
        column: 1
      }
    ])
  })

  it('keeps source-missing and workspace-external frames but makes them unopened', () => {
    const frames = parseStackTraceResponse(ROOT, {
      stackFrames: [
        { id: 1, name: 'native', line: 1, column: 1 },
        {
          id: 2,
          name: 'external',
          source: { path: isWindows ? 'D:\\secret\\lib.ts' : '/secret/lib.ts' },
          line: 2,
          column: 1
        }
      ]
    })

    expect(frames?.map((frame) => frame.source.kind)).toEqual(['unavailable', 'unavailable'])
    expect(JSON.stringify(frames)).not.toContain('secret')
  })

  it('validates line and column without dropping the frame', () => {
    expect(
      parseStackTraceResponse(ROOT, {
        stackFrames: [
          { id: 1, name: 'bad line', line: 0, column: -1 },
          { id: 2, name: 'bad column', line: 3, column: '4' }
        ]
      })
    ).toMatchObject([
      { id: 1, line: null, column: null },
      { id: 2, line: 3, column: null }
    ])
  })

  it('drops malformed frames and rejects malformed response bodies', () => {
    expect(
      parseStackTraceResponse(ROOT, {
        stackFrames: [{ id: 1, name: 'ok' }, { id: 0 }, { id: '2' }, null]
      })
    ).toHaveLength(1)

    for (const body of [null, undefined, 42, {}, { stackFrames: null }, []]) {
      expect(parseStackTraceResponse(ROOT, body)).toBeNull()
    }
  })
})
