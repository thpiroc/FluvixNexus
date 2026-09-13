import { describe, expect, it } from 'vitest'
import { DEBUG_STOP_TEXT_MAX_LENGTH } from '@shared/debug'
import {
  REDACTED_DEBUG_PATH,
  UNKNOWN_DAP_STOPPED_EVENT,
  createExceptionInfoArguments,
  parseDapExceptionInfoResponse,
  parseDapStoppedEvent,
  readSupportsExceptionInfoRequest,
  redactDebugPaths,
  sanitizeDebugStopText,
  toDebugStopInfo,
  toDebugStopReason
} from './stopInfo'

/**
 * 停止理由と例外情報（Session 6-13）。
 *
 * 形は実 debugpy 1.8.21 が返したものに合わせてある（stopped event の `text` が型名・
 * `description` がメッセージ、exceptionInfo の `details.stackTrace` / `details.source` は絶対パス）。
 */

const ROOT = 'D:\\proj'

/** 実 debugpy の uncaught 例外の exceptionInfo（パスだけ差し替えたもの）。 */
const DEBUGPY_EXCEPTION_INFO = {
  exceptionId: 'ValueError',
  breakMode: 'unhandled',
  description: 'bad value 42',
  details: {
    message: 'bad value 42',
    typeName: 'ValueError',
    stackTrace:
      '  File "D:\\proj\\exc.py", line 2, in boom\n    raise ValueError("bad value 42")\nValueError: bad value 42\n',
    source: 'D:\\proj\\exc.py'
  }
}

describe('parseDapStoppedEvent', () => {
  it('reads the DAP reasons into the closed set', () => {
    expect(parseDapStoppedEvent({ reason: 'breakpoint', threadId: 1 }).reason).toBe('breakpoint')
    expect(parseDapStoppedEvent({ reason: 'step', threadId: 1 }).reason).toBe('step')
    expect(parseDapStoppedEvent({ reason: 'pause', threadId: 1 }).reason).toBe('pause')
    expect(parseDapStoppedEvent({ reason: 'entry', threadId: 1 }).reason).toBe('entry')
    expect(parseDapStoppedEvent({ reason: 'exception', threadId: 1 }).reason).toBe('exception')
  })

  it('folds breakpoint kinds into breakpoint and anything else into unknown', () => {
    expect(toDebugStopReason('function breakpoint')).toBe('breakpoint')
    expect(toDebugStopReason('data breakpoint')).toBe('breakpoint')
    expect(toDebugStopReason('instruction breakpoint')).toBe('breakpoint')
    expect(toDebugStopReason('goto')).toBe('unknown')
    expect(toDebugStopReason('Breakpoint')).toBe('unknown')
    expect(toDebugStopReason('adapter-specific')).toBe('unknown')
    expect(toDebugStopReason(undefined)).toBe('unknown')
    expect(toDebugStopReason(3)).toBe('unknown')
  })

  it('keeps text and description of the real debugpy exception stop', () => {
    expect(
      parseDapStoppedEvent({
        reason: 'exception',
        description: 'bad value 42',
        threadId: 1,
        preserveFocusHint: false,
        text: 'ValueError',
        allThreadsStopped: true
      })
    ).toEqual({ reason: 'exception', description: 'bad value 42', text: 'ValueError' })
  })

  it('treats malformed stopped bodies as unknown without throwing', () => {
    expect(parseDapStoppedEvent(undefined)).toEqual(UNKNOWN_DAP_STOPPED_EVENT)
    expect(parseDapStoppedEvent(null)).toEqual(UNKNOWN_DAP_STOPPED_EVENT)
    expect(parseDapStoppedEvent('exception')).toEqual(UNKNOWN_DAP_STOPPED_EVENT)
    expect(parseDapStoppedEvent([{ reason: 'exception' }])).toEqual(UNKNOWN_DAP_STOPPED_EVENT)
    expect(parseDapStoppedEvent({ reason: 'exception', text: 42, description: {} })).toEqual({
      reason: 'exception',
      description: null,
      text: null
    })
    expect(parseDapStoppedEvent({ reason: 'step', text: '   ', description: '\0' })).toEqual({
      reason: 'step',
      description: null,
      text: null
    })
  })
})

describe('exceptionInfo', () => {
  it('reads the capability only when it is literally true', () => {
    expect(readSupportsExceptionInfoRequest({ supportsExceptionInfoRequest: true })).toBe(true)
    expect(readSupportsExceptionInfoRequest({ supportsExceptionInfoRequest: 'true' })).toBe(false)
    expect(readSupportsExceptionInfoRequest({})).toBe(false)
    expect(readSupportsExceptionInfoRequest(null)).toBe(false)
  })

  it('builds only a threadId argument', () => {
    expect(createExceptionInfoArguments(7)).toEqual({ threadId: 7 })
  })

  it('reads the real debugpy response without the stack trace or source', () => {
    const parsed = parseDapExceptionInfoResponse(DEBUGPY_EXCEPTION_INFO)

    expect(parsed).toEqual({
      exceptionId: 'ValueError',
      description: 'bad value 42',
      breakMode: 'unhandled',
      typeName: 'ValueError',
      message: 'bad value 42'
    })
    expect(JSON.stringify(parsed)).not.toContain('exc.py')
    expect(JSON.stringify(parsed)).not.toContain('D:\\')
  })

  it('returns null for malformed responses and drops unknown break modes', () => {
    expect(parseDapExceptionInfoResponse(undefined)).toBeNull()
    expect(parseDapExceptionInfoResponse({})).toBeNull()
    expect(parseDapExceptionInfoResponse({ exceptionId: 5 })).toBeNull()
    expect(parseDapExceptionInfoResponse([DEBUGPY_EXCEPTION_INFO])).toBeNull()
    expect(
      parseDapExceptionInfoResponse({
        exceptionId: 'E',
        breakMode: 'sometimes',
        details: 'not-an-object'
      })
    ).toEqual({
      exceptionId: 'E',
      description: null,
      breakMode: null,
      typeName: null,
      message: null
    })
  })
})

describe('toDebugStopInfo', () => {
  it('carries only the sequence and reason for non-exception stops', () => {
    for (const reason of ['breakpoint', 'step', 'pause', 'entry', 'unknown'] as const) {
      expect(
        toDebugStopInfo({
          rootPath: ROOT,
          sequence: 3,
          stopped: { reason, description: 'C:\\secret\\x', text: 'T' },
          exceptionInfo: null
        })
      ).toEqual({ sequence: 3, reason, exception: null })
    }
  })

  it('prefers exceptionInfo details and keeps the break mode', () => {
    expect(
      toDebugStopInfo({
        rootPath: ROOT,
        sequence: 1,
        stopped: { reason: 'exception', description: 'from event', text: 'EventType' },
        exceptionInfo: parseDapExceptionInfoResponse(DEBUGPY_EXCEPTION_INFO)
      })
    ).toEqual({
      sequence: 1,
      reason: 'exception',
      exception: { typeName: 'ValueError', message: 'bad value 42', breakMode: 'unhandled' }
    })
  })

  it('falls back to the stopped event when exceptionInfo is unsupported or unreadable', () => {
    expect(
      toDebugStopInfo({
        rootPath: ROOT,
        sequence: 2,
        stopped: { reason: 'exception', description: 'bad value 42', text: 'ValueError' },
        exceptionInfo: null
      })
    ).toEqual({
      sequence: 2,
      reason: 'exception',
      exception: { typeName: 'ValueError', message: 'bad value 42', breakMode: null }
    })

    expect(
      toDebugStopInfo({
        rootPath: ROOT,
        sequence: 2,
        stopped: { reason: 'exception', description: null, text: null },
        exceptionInfo: {
          exceptionId: 'KeyError',
          description: "'k'",
          breakMode: 'always',
          typeName: null,
          message: null
        }
      }).exception
    ).toEqual({ typeName: 'KeyError', message: "'k'", breakMode: 'always' })

    expect(
      toDebugStopInfo({
        rootPath: ROOT,
        sequence: 2,
        stopped: { reason: 'exception', description: null, text: null },
        exceptionInfo: null
      }).exception
    ).toEqual({ typeName: null, message: null, breakMode: null })
  })

  it('never lets absolute paths or file URIs through the exception text', () => {
    const info = toDebugStopInfo({
      rootPath: ROOT,
      sequence: 4,
      stopped: {
        reason: 'exception',
        text: 'FileNotFoundError',
        description:
          "[Errno 2] No such file or directory: 'C:\\Users\\alice\\secret data\\keys.txt'"
      },
      exceptionInfo: {
        exceptionId: 'FileNotFoundError',
        description: null,
        breakMode: 'unhandled',
        typeName: 'FileNotFoundError',
        message:
          "cannot open 'D:\\proj\\data\\in.csv' via file:///C:/Users/alice/x.txt or \\\\server\\share\\y and /home/alice/z.txt"
      }
    })
    const serialized = JSON.stringify(info)

    expect(info.exception?.message).toBe(
      `cannot open 'data/in.csv' via ${REDACTED_DEBUG_PATH} or ${REDACTED_DEBUG_PATH} and ${REDACTED_DEBUG_PATH}`
    )
    expect(serialized).not.toMatch(/[A-Za-z]:\\\\/)
    expect(serialized).not.toContain('file:')
    expect(serialized).not.toContain('alice')
    expect(serialized).not.toContain('server')
  })
})

describe('redactDebugPaths / sanitizeDebugStopText', () => {
  it('turns workspace paths into relative paths and hides everything else', () => {
    expect(redactDebugPaths(ROOT, 'at D:\\proj\\src\\app.py line 3')).toBe('at src/app.py line 3')
    expect(redactDebugPaths(ROOT, 'at d:/PROJ/src/app.py')).toBe('at src/app.py')
    expect(redactDebugPaths(ROOT, 'at D:\\other\\app.py')).toBe(`at ${REDACTED_DEBUG_PATH}`)
    expect(redactDebugPaths(ROOT, 'root D:\\proj itself')).toBe(
      `root ${REDACTED_DEBUG_PATH} itself`
    )
    expect(redactDebugPaths(ROOT, 'uri file:///D:/proj/src/app.py')).toBe('uri src/app.py')
    expect(redactDebugPaths(ROOT, 'bad file://%zz')).toBe(`bad ${REDACTED_DEBUG_PATH}`)
  })

  it('does not stop at a space that is followed by more path segments', () => {
    expect(redactDebugPaths(ROOT, 'C:\\Program Files\\App Data\\x.py is missing')).toBe(
      `${REDACTED_DEBUG_PATH} is missing`
    )
  })

  it('leaves ordinary text alone', () => {
    expect(redactDebugPaths(ROOT, 'division by zero')).toBe('division by zero')
    expect(redactDebugPaths(ROOT, "'k'")).toBe("'k'")
    expect(redactDebugPaths(ROOT, 'ratio 1/2 and a/b/c')).toBe('ratio 1/2 and a/b/c')
    expect(redactDebugPaths(ROOT, 'http://example.com/a/b')).toBe('http://example.com/a/b')
  })

  it('hides every path when there is no workspace root', () => {
    expect(redactDebugPaths('', 'at D:\\proj\\src\\app.py')).toBe(`at ${REDACTED_DEBUG_PATH}`)
  })

  it('collapses control characters and newlines into one line and applies the length limit', () => {
    expect(sanitizeDebugStopText(ROOT, 'line 1\n\tline 2\u0007')).toBe('line 1 line 2')
    expect(sanitizeDebugStopText(ROOT, ' \n ')).toBeNull()
    expect(sanitizeDebugStopText(ROOT, null)).toBeNull()

    const long = sanitizeDebugStopText(ROOT, 'x'.repeat(DEBUG_STOP_TEXT_MAX_LENGTH + 50))

    expect(long).toHaveLength(DEBUG_STOP_TEXT_MAX_LENGTH + 1)
    expect(long?.endsWith('…')).toBe(true)
  })

  /*
    Python の FileNotFoundError はパスを repr で入れるので区切りが2つ重なる。UNC の規則を先に当てると
    `\\Users\\…` を UNC と読んで `C:` だけが残った（production 確認で見つけた不具合の固定）。
  */
  it('reads the doubled separators of a Python repr as one path (real FileNotFoundError)', () => {
    expect(
      redactDebugPaths(
        ROOT,
        "[Errno 2] No such file or directory: 'D:\\\\proj\\\\no_such_dir\\\\data.txt'"
      )
    ).toBe("[Errno 2] No such file or directory: 'no_such_dir/data.txt'")

    const outside = redactDebugPaths(
      ROOT,
      "[Errno 2] No such file or directory: 'C:\\\\Users\\\\alice\\\\keys.txt'"
    )

    expect(outside).toBe(`[Errno 2] No such file or directory: '${REDACTED_DEBUG_PATH}'`)
    expect(outside).not.toContain('C:')

    const unc = redactDebugPaths(ROOT, "open '\\\\\\\\fileserver\\\\share\\\\x.txt'")

    expect(unc).not.toContain('fileserver')
    expect(unc).not.toContain('share')
  })
})
