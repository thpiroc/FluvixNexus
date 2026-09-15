import { describe, expect, it } from 'vitest'
import {
  LOG_FILE_LINE_MAX_LENGTH,
  describeLogDetail,
  formatLogFileLine,
  redactLogText,
  sanitizeLogText
} from './logRedaction'

/** Session 7-1C ── 配布版のログファイルに、パスや認証情報を残さない。 */
describe('redactLogText', () => {
  it.each([
    ['a drive path with spaces', 'workspace opened: D:\\DEV\\PROJECTS\\Fluvix Nexus'],
    ['a drive path with forward slashes', 'fatal: not a git repository: C:/Users/Taro Yamada/x'],
    ['a drive path under a Unicode user name', 'watching the workspace: C:\\Users\\ぴろ\\proj'],
    ['a UNC path', 'failed to watch \\\\server\\share\\Taro Yamada\\repo'],
    ['an extended-length path', 'open \\\\?\\C:\\Users\\Taro\\a.txt'],
    ['a file URI', 'blocked navigation to "file:///C:/Users/Taro/secret.html".'],
    ['a POSIX home path', 'shell started: bash cwd=/home/taro yamada/work'],
    ['a Python repr path', "FileNotFoundError: 'C:\\\\Users\\\\taro\\\\a.py'"]
  ])('hides %s without leaving any part of it', (_label, raw) => {
    const redacted = redactLogText(raw)

    expect(redacted).toContain('<path>')
    expect(redacted).not.toMatch(/Users|Taro|taro|ぴろ|server|share|DEV|PROJECTS|Nexus|home/)
  })

  it('keeps the text around a quoted path', () => {
    expect(
      redactLogText('failed to watch "D:\\proj\\.git"; git changes will not be detected.')
    ).toBe('failed to watch "<path>"; git changes will not be detected.')
  })

  it('does not treat URLs, relative paths or plain words as paths', () => {
    const raw =
      'git fetch exited 128 for https://github.com/owner/repo.git (src/main/index.ts, stdout/stderr, pid=42)'

    expect(redactLogText(raw)).toBe(raw)
  })

  it.each([
    ['URL user info', 'https://taro:ghs_abcdefghijklmnopqrstu@github.com/o/r.git', 'taro'],
    ['a GitHub token', 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 was rejected', 'ghp_'],
    [
      'a fine-grained token',
      'using github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
      'github_pat_'
    ],
    ['a Bearer value', 'authorization: Bearer abc.def-ghi', 'abc.def'],
    ['a password assignment', 'password=hunter2; secret: "s e c r e t"', 'hunter2'],
    ['an api key assignment', 'API_KEY=sk-live-123', 'sk-live']
  ])('hides %s', (_label, raw, leaked) => {
    const redacted = redactLogText(raw)

    expect(redacted).toContain('<redacted>')
    expect(redacted).not.toContain(leaked)
    expect(redacted).not.toContain('s e c r e t')
  })
})

describe('sanitizeLogText', () => {
  it('collapses control characters so one record stays on one line', () => {
    expect(sanitizeLogText('first\r\n2026-01-01T00:00:00.000Z ERROR [fake] injected\tline')).toBe(
      'first 2026-01-01T00:00:00.000Z ERROR [fake] injected line'
    )
  })

  it('truncates long text, and still hides a path cut at the read limit', () => {
    const long = `${'x'.repeat(LOG_FILE_LINE_MAX_LENGTH + 100)}`

    expect(sanitizeLogText(long)).toHaveLength(LOG_FILE_LINE_MAX_LENGTH + 1)
    expect(sanitizeLogText(long).endsWith('…')).toBe(true)

    const cut = `${'y'.repeat(15_990)} C:\\Users\\Taro Yamada\\very\\long\\path`

    expect(sanitizeLogText(cut)).not.toMatch(/Users|Taro/)
  })
})

describe('describeLogDetail', () => {
  it('writes only the name, code and message of an error (no stack)', () => {
    const error = Object.assign(new Error('spawn C:\\tools\\node.exe ENOENT'), { code: 'ENOENT' })

    expect(describeLogDetail(error)).toBe('Error (ENOENT): spawn C:\\tools\\node.exe ENOENT')
  })

  it('does not walk into objects such as spawn options or environment tables', () => {
    expect(
      describeLogDetail({ env: { GITHUB_TOKEN: 'ghp_x', USERPROFILE: 'C:\\Users\\Taro' } })
    ).toBe('[object]')
    expect(describeLogDetail(['C:\\Users\\Taro'])).toBe('[object]')
    expect(describeLogDetail(null)).toBe('null')
    expect(describeLogDetail(undefined)).toBe('undefined')
    expect(describeLogDetail(42)).toBe('42')
    expect(describeLogDetail(() => 1)).toBe('[function]')
  })
})

describe('formatLogFileLine', () => {
  it('writes a dated, single, redacted line with the details joined', () => {
    const line = formatLogFileLine({
      time: new Date('2026-09-15T01:02:03.004Z'),
      level: 'warn',
      scope: 'lsp',
      message: 'failed to start pyright: C:\\Users\\Taro\\AppData\\pyright.cmd',
      details: [Object.assign(new Error('boom\nat C:\\app\\main.js:1:1'), { code: 'EACCES' })]
    })

    expect(line).toBe(
      '2026-09-15T01:02:03.004Z WARN  [lsp] failed to start pyright: <path> | Error (EACCES): boom at <path>'
    )
    expect(line).not.toContain('\n')
  })

  it('keeps the error detail when the message has no path', () => {
    expect(
      formatLogFileLine({
        time: new Date('2026-09-15T01:02:03.004Z'),
        level: 'error',
        scope: 'store',
        message: 'failed to write "settings.json".',
        details: [Object.assign(new Error('disk full'), { code: 'ENOSPC' })]
      })
    ).toBe(
      '2026-09-15T01:02:03.004Z ERROR [store] failed to write "settings.json". | Error (ENOSPC): disk full'
    )
  })
})
