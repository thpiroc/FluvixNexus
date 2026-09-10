import { describe, expect, it } from 'vitest'
import { normalizeDebugBreakpointPath, resolveDebugBreakpointSource } from './breakpointSource'
import { isWindows } from '../platform'

/**
 * Breakpoint の相対位置 → DAP の `Source`。
 *
 * 見張るのは**Workspace の外へ出られないこと**の1点で、検証そのものは
 * Files / LSP と同じ関数（main/files/workspacePath.ts）が持つ。
 * ここが確かめるのは「その関数を確かに通っていること」と、
 * **Renderer へ返る形に絶対パスが出ないこと**にあたる。
 */

const ROOT = isWindows ? 'D:\\proj' : '/proj'

describe('Workspace の中', () => {
  it('相対位置から Source を組み立てる', () => {
    const source = resolveDebugBreakpointSource(ROOT, 'src/app.js')

    expect(source?.name).toBe('app.js')
    expect(source?.path).toContain('app.js')
    // DAP の Source.path は URI ではなく素の絶対パス。
    expect(source?.path.startsWith('file:')).toBe(false)
  })

  it('区切りは `/` でも `\\` でも通る', () => {
    expect(resolveDebugBreakpointSource(ROOT, 'src\\app.js')?.name).toBe('app.js')
  })

  it('まだ存在しないファイルでも通す（印は編集中のファイルに置く）', () => {
    expect(resolveDebugBreakpointSource(ROOT, 'src/not-created-yet.ts')).not.toBeNull()
  })
})

describe('Workspace の外', () => {
  it.each([
    '..',
    '../outside.ts',
    '..\\outside.ts',
    'src/../../outside.ts',
    './../outside.ts',
    'C:\\Windows\\system.ini',
    'C:/Windows/system.ini',
    '/etc/passwd',
    '\\\\server\\share\\a.ts',
    'C:src/app.ts',
    'src/app.ts:stream',
    'src/app\u0000.ts'
  ])('断る: %s', (relativePath) => {
    expect(resolveDebugBreakpointSource(ROOT, relativePath)).toBeNull()
    expect(normalizeDebugBreakpointPath(relativePath)).toBeNull()
  })

  it('root そのものは文書ではない', () => {
    expect(resolveDebugBreakpointSource(ROOT, '')).toBeNull()
    expect(resolveDebugBreakpointSource(ROOT, '   ')).toBeNull()
  })

  it.each([null, undefined, 42, {}, []])('文字列でない値を断る: %s', (value) => {
    expect(resolveDebugBreakpointSource(ROOT, value)).toBeNull()
  })

  it('桁違いに長い相対位置を断る', () => {
    expect(resolveDebugBreakpointSource(ROOT, 'a'.repeat(100_000))).toBeNull()
  })
})

describe('正規化', () => {
  it('区切りを `/` に揃える', () => {
    expect(normalizeDebugBreakpointPath('src\\lib\\app.ts')).toBe('src/lib/app.ts')
  })

  it('`./` は落とす', () => {
    expect(normalizeDebugBreakpointPath('./src/app.ts')).toBe('src/app.ts')
  })

  /* 前後に空白を含む名前は実在しうる。判定のためだけに trim し、名前は変えない。 */
  it('名前の中の空白は残す', () => {
    expect(normalizeDebugBreakpointPath('src/notes .ts')).toBe('src/notes .ts')
  })
})
