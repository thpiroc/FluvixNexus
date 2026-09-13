import { describe, expect, it } from 'vitest'
import { validateDebugProfileDraft } from './profileValidation'

/**
 * Debug Profile の欄の検証（Session 6-10）。
 *
 * 要点は2つ ── 6欄以外を持ち込まないこと（`cwd` / `runtimeExecutable` / `adapter` が
 * 載っていても消える）と、欄ごとに閉じた理由で断ること。
 */

const valid = {
  name: 'Run app',
  language: 'node',
  programRelativePath: 'src/app.js',
  programArgs: ['--port', '3000'],
  env: { APP_MODE: 'debug' },
  stopOnEntry: false
}

describe('validateDebugProfileDraft', () => {
  it('accepts the six fields', () => {
    expect(validateDebugProfileDraft(valid)).toEqual({ status: 'ok', draft: valid })
  })

  it('rebuilds the draft from the six fields only', () => {
    const check = validateDebugProfileDraft({
      ...valid,
      profileId: 'dp-00000000-0000-4000-8000-000000000000',
      cwd: 'C:\\Windows',
      runtimeExecutable: 'C:\\evil.exe',
      adapter: 'C:\\evil.exe',
      adapterArgs: ['--x'],
      console: 'integratedTerminal',
      preLaunchTask: 'rm -rf /',
      request: 'attach',
      processId: 42
    })

    expect(check.status).toBe('ok')

    if (check.status === 'ok') {
      expect(Object.keys(check.draft).sort()).toEqual(
        ['env', 'language', 'name', 'programArgs', 'programRelativePath', 'stopOnEntry'].sort()
      )
    }
  })

  it('normalizes the separators of the relative path', () => {
    const check = validateDebugProfileDraft({ ...valid, programRelativePath: 'src\\sub\\app.js' })

    expect(check.status === 'ok' && check.draft.programRelativePath).toBe('src/sub/app.js')
  })

  it('does not trim names, arguments or environment values', () => {
    const check = validateDebugProfileDraft({
      ...valid,
      name: '  spaced  ',
      programArgs: ['  a  ', '', '&&', '|', '%PATH%'],
      env: { A: ' x ' }
    })

    expect(check).toEqual({
      status: 'ok',
      draft: {
        ...valid,
        name: '  spaced  ',
        programArgs: ['  a  ', '', '&&', '|', '%PATH%'],
        env: { A: ' x ' }
      }
    })
  })

  it.each(['node', 'python', 'csharp'])('accepts the language %s', (language) => {
    expect(validateDebugProfileDraft({ ...valid, language }).status).toBe('ok')
  })

  it.each([
    ['not an object', null, 'name', 'invalid-type'],
    ['an array', [], 'name', 'invalid-type'],
    ['name is missing', { ...valid, name: undefined }, 'name', 'invalid-type'],
    ['name is blank', { ...valid, name: '   ' }, 'name', 'empty'],
    ['name is too long', { ...valid, name: 'x'.repeat(101) }, 'name', 'too-long'],
    ['name has NUL', { ...valid, name: 'a\0b' }, 'name', 'contains-nul'],
    ['language is a number', { ...valid, language: 1 }, 'language', 'invalid-type'],
    ['language is unknown', { ...valid, language: 'ruby' }, 'language', 'unsupported'],
    ['language is an adapter name', { ...valid, language: 'pwa-node' }, 'language', 'unsupported'],
    [
      'path is missing',
      { ...valid, programRelativePath: 1 },
      'programRelativePath',
      'invalid-type'
    ],
    [
      'path is absolute (Windows)',
      { ...valid, programRelativePath: 'C:\\app.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'path is absolute (POSIX)',
      { ...valid, programRelativePath: '/etc/passwd' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'path is UNC',
      { ...valid, programRelativePath: '\\\\server\\share\\a.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'path climbs out',
      { ...valid, programRelativePath: '../outside.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'path climbs inside',
      { ...valid, programRelativePath: 'src/../../x.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'path is drive-relative',
      { ...valid, programRelativePath: 'C:app.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'path is a file URI',
      { ...valid, programRelativePath: 'file:///C:/app.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'path has NUL',
      { ...valid, programRelativePath: 'a\0.js' },
      'programRelativePath',
      'invalid-path'
    ],
    [
      'path is the workspace root',
      { ...valid, programRelativePath: '  ' },
      'programRelativePath',
      'empty'
    ],
    ['args is a string', { ...valid, programArgs: '--port 3000' }, 'programArgs', 'invalid-type'],
    ['args has a number', { ...valid, programArgs: ['a', 1] }, 'programArgs', 'invalid-type'],
    [
      'args has too many',
      { ...valid, programArgs: Array.from({ length: 65 }, () => 'a') },
      'programArgs',
      'too-many'
    ],
    [
      'args has a long one',
      { ...valid, programArgs: ['x'.repeat(4097)] },
      'programArgs',
      'too-long'
    ],
    ['args has NUL', { ...valid, programArgs: ['a\0'] }, 'programArgs', 'contains-nul'],
    ['env is missing', { ...valid, env: undefined }, 'env', 'invalid-type'],
    ['env has PATH', { ...valid, env: { PATH: 'C:\\evil' } }, 'env', 'denied-name'],
    [
      'env has NODE_OPTIONS',
      { ...valid, env: { NODE_OPTIONS: '--require x' } },
      'env',
      'denied-name'
    ],
    ['env has a bad name', { ...valid, env: { 'A-B': 'x' } }, 'env', 'invalid-name'],
    ['stopOnEntry is a string', { ...valid, stopOnEntry: 'true' }, 'stopOnEntry', 'invalid-type']
  ])('rejects when %s', (_name, raw, field, reason) => {
    expect(validateDebugProfileDraft(raw)).toEqual({ status: 'invalid', field, reason })
  })
})
