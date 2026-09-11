import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { toFileUri } from '../lsp/documentUri'
import { isWindows } from '../platform'
import { normalizeStackFrameSource } from './stackFrameSource'

const ROOT = isWindows ? 'D:\\proj' : '/proj'
const OUTSIDE = isWindows ? 'D:\\secret\\app.ts' : '/secret/app.ts'

describe('stack frame source normalization', () => {
  it('turns an absolute workspace path into a relative path', () => {
    expect(normalizeStackFrameSource(ROOT, { path: resolve(ROOT, 'src/app.ts') })).toEqual({
      kind: 'workspace',
      relativePath: 'src/app.ts',
      name: 'app.ts'
    })
  })

  it('turns a file URI inside the workspace into a relative path', () => {
    expect(
      normalizeStackFrameSource(ROOT, { path: toFileUri(resolve(ROOT, 'src/app.ts')) })
    ).toEqual({
      kind: 'workspace',
      relativePath: 'src/app.ts',
      name: 'app.ts'
    })
  })

  it('keeps an outside source as unavailable without leaking the path', () => {
    const source = normalizeStackFrameSource(ROOT, { path: OUTSIDE, name: OUTSIDE })

    expect(source).toEqual({ kind: 'unavailable', name: 'app.ts', reason: 'outside-workspace' })
    expect(JSON.stringify(source)).not.toContain(OUTSIDE)
    expect(JSON.stringify(source)).not.toContain('file:')
  })

  it.each([
    null,
    undefined,
    {},
    { path: 'src/app.ts', name: 'src/app.ts' },
    { path: 'file:///D:/proj/%zz.ts', name: 'file:///D:/proj/%zz.ts' },
    { path: 'D:\\proj\\bad\u0000name.ts', name: 'bad\u0000name.ts' }
  ])('returns a safe unavailable source for missing or malformed input: %s', (source) => {
    const normalized = normalizeStackFrameSource(ROOT, source)

    expect(normalized.kind).toBe('unavailable')
    expect(JSON.stringify(normalized)).not.toContain('D:\\proj')
    expect(JSON.stringify(normalized)).not.toContain('file://')
  })

  it('marks a malformed file URI as malformed instead of outside-workspace', () => {
    expect(
      normalizeStackFrameSource(ROOT, {
        path: 'file:///D:/proj/%zz.ts',
        name: 'file:///D:/proj/%zz.ts'
      })
    ).toMatchObject({ kind: 'unavailable', reason: 'malformed' })
  })

  it('does not accept a sibling path that only shares the workspace prefix', () => {
    const source = normalizeStackFrameSource(ROOT, {
      path: isWindows ? 'D:\\project\\app.ts' : '/project/app.ts'
    })

    expect(source).toMatchObject({ kind: 'unavailable', reason: 'outside-workspace' })
  })
})
