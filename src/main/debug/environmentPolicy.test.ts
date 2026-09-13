import { describe, expect, it } from 'vitest'
import {
  DENIED_DEBUG_PROFILE_ENV_NAMES,
  checkDebugProfileEnvironment,
  createDebugAdapterProcessEnvironment,
  isDeniedDebugProfileEnvironmentName
} from './environmentPolicy'

/**
 * 環境変数の方針（Session 6-10。docs/ARCHITECTURE.md §20.9）。
 *
 * 見るのは3つ ── 名前の形、「プログラムより先に何かを読み込ませる」名前を断ること、
 * profile の env と adapter のプロセスの環境を混ぜないこと。
 */

describe('checkDebugProfileEnvironment', () => {
  it('passes ordinary names and keeps values untouched', () => {
    const check = checkDebugProfileEnvironment({
      APP_MODE: 'debug',
      _private: '  spaced  ',
      Value1: '%PATH% && ${HOME} | x'
    })

    expect(check).toEqual({
      status: 'ok',
      env: { APP_MODE: 'debug', _private: '  spaced  ', Value1: '%PATH% && ${HOME} | x' }
    })
  })

  it('accepts an empty environment', () => {
    expect(checkDebugProfileEnvironment({})).toEqual({ status: 'ok', env: {} })
  })

  it('fixes the denied list to the names decided in §20.9', () => {
    expect([...DENIED_DEBUG_PROFILE_ENV_NAMES]).toEqual([
      'PATH',
      'NODE_OPTIONS',
      'ELECTRON_RUN_AS_NODE',
      'PYTHONSTARTUP',
      'PYTHONHOME',
      'PYTHONPATH',
      'DOTNET_STARTUP_HOOKS',
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES'
    ])
  })

  it.each([...DENIED_DEBUG_PROFILE_ENV_NAMES])('denies %s', (name) => {
    expect(checkDebugProfileEnvironment({ [name]: 'x' })).toEqual({
      status: 'rejected',
      reason: 'denied-name'
    })
  })

  /** Windows の環境変数は大文字小文字を区別しない ── `Path` も PATH を差し替える。 */
  it.each(['Path', 'path', 'node_options', 'Electron_Run_As_Node', 'PythonPath'])(
    'denies %s regardless of case',
    (name) => {
      expect(isDeniedDebugProfileEnvironmentName(name)).toBe(true)
      expect(checkDebugProfileEnvironment({ [name]: 'x' })).toEqual({
        status: 'rejected',
        reason: 'denied-name'
      })
    }
  )

  it.each(['1ABC', 'A-B', 'A B', 'A=B', '', 'Ä', 'A.B', '$A'])(
    'rejects the malformed name %j',
    (name) => {
      expect(checkDebugProfileEnvironment({ [name]: 'x' })).toEqual({
        status: 'rejected',
        reason: 'invalid-name'
      })
    }
  )

  it('rejects a name longer than the limit', () => {
    expect(checkDebugProfileEnvironment({ ['A'.repeat(257)]: 'x' })).toEqual({
      status: 'rejected',
      reason: 'invalid-name'
    })
  })

  it('rejects two names that differ only by case', () => {
    expect(checkDebugProfileEnvironment({ Mode: 'a', MODE: 'b' })).toEqual({
      status: 'rejected',
      reason: 'duplicate-name'
    })
  })

  it.each([
    ['not an object', 'A=B', 'invalid-type'],
    ['null', null, 'invalid-type'],
    ['an array', [['A', 'B']], 'invalid-type'],
    ['a class instance', new Map([['A', 'B']]), 'invalid-type'],
    ['a non-string value', { A: 1 }, 'invalid-type'],
    ['a value with NUL', { A: 'a\0b' }, 'contains-nul'],
    ['a value that is too long', { A: 'x'.repeat(8193) }, 'too-long'],
    [
      'too many entries',
      Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`V${i}`, 'x'])),
      'too-many'
    ]
  ])('rejects %s', (_name, raw, reason) => {
    expect(checkDebugProfileEnvironment(raw)).toEqual({ status: 'rejected', reason })
  })

  it('returns a fresh plain object (does not hand back the caller’s object)', () => {
    const raw = { A: 'x' }
    const check = checkDebugProfileEnvironment(raw)

    expect(check.status).toBe('ok')
    expect(check.status === 'ok' && check.env).not.toBe(raw)
  })

  /** JSON から来た `__proto__` は自分の key として残り、prototype を差し替えない。 */
  it('does not let a __proto__ key change the prototype', () => {
    const check = checkDebugProfileEnvironment(JSON.parse('{"__proto__":"x","A":"y"}'))

    expect(check.status).toBe('ok')

    if (check.status === 'ok') {
      expect(Object.getPrototypeOf(check.env)).toBe(Object.prototype)
      expect(Object.keys(check.env)).toEqual(['__proto__', 'A'])
    }
  })
})

describe('createDebugAdapterProcessEnvironment', () => {
  it('drops the two variables that come from running inside Electron (any case)', () => {
    expect(
      createDebugAdapterProcessEnvironment({
        PATH: 'C:\\bin',
        ELECTRON_RUN_AS_NODE: '1',
        node_options: '--inspect',
        SystemRoot: 'C:\\Windows'
      })
    ).toEqual({ PATH: 'C:\\bin', SystemRoot: 'C:\\Windows' })
  })

  it('does not modify the parent environment', () => {
    const parent = { ELECTRON_RUN_AS_NODE: '1' }

    createDebugAdapterProcessEnvironment(parent)

    expect(parent).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })
})
