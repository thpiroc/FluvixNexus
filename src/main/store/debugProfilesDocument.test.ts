import { describe, expect, it } from 'vitest'
import { parseDebugProfilesDocument } from './debugProfilesDocument'

/**
 * 保存された Debug Profile 文書の検証（Session 6-10）。
 *
 * 保存ファイルは手で編集できる。**保存時と同じ検証**を1件ずつ通し、壊れた1件だけを落とす。
 */

const profile = {
  profileId: 'dp-00000000-0000-4000-8000-000000000001',
  name: 'Run app',
  language: 'python',
  programRelativePath: 'main.py',
  programArgs: [],
  env: {},
  stopOnEntry: true
}

function documentWith(profiles: unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    workspaces: { 'D:\\proj': { updatedAt: 5, profiles, ...extra } }
  }
}

describe('parseDebugProfilesDocument', () => {
  it('reads a valid document', () => {
    expect(parseDebugProfilesDocument(documentWith([profile]))).toEqual(documentWith([profile]))
  })

  it.each([
    ['not an object', 'x'],
    ['no schema version', { workspaces: {} }],
    ['schema version 0', { schemaVersion: 0, workspaces: {} }],
    ['workspaces is an array', { schemaVersion: 1, workspaces: [] }]
  ])('drops the whole document when the envelope is broken (%s)', (_name, raw) => {
    expect(parseDebugProfilesDocument(raw)).toBeNull()
  })

  it.each([
    ['a missing id', { ...profile, profileId: undefined }],
    ['a renderer-made id', { ...profile, profileId: 'my-profile' }],
    ['an absolute program', { ...profile, programRelativePath: 'C:\\Windows\\notepad.exe' }],
    ['a climbing program', { ...profile, programRelativePath: '../x.py' }],
    ['a denied env name', { ...profile, env: { PYTHONPATH: 'C:\\evil' } }],
    ['an unknown language', { ...profile, language: 'ruby' }],
    ['a non-boolean stopOnEntry', { ...profile, stopOnEntry: 'yes' }]
  ])('drops only the profile with %s', (_name, broken) => {
    const second = { ...profile, profileId: 'dp-00000000-0000-4000-8000-000000000002' }

    expect(parseDebugProfilesDocument(documentWith([broken, second]))).toEqual(
      documentWith([second])
    )
  })

  it('drops fields that are not part of the profile', () => {
    const parsed = parseDebugProfilesDocument(
      documentWith([{ ...profile, cwd: 'C:\\Windows', runtimeExecutable: 'C:\\evil.exe' }])
    )

    expect(parsed?.workspaces['D:\\proj'].profiles[0]).toEqual(profile)
  })

  it('keeps the first of two profiles with the same id', () => {
    const parsed = parseDebugProfilesDocument(documentWith([profile, { ...profile, name: 'Dup' }]))

    expect(parsed?.workspaces['D:\\proj'].profiles.map((entry) => entry.name)).toEqual(['Run app'])
  })

  it('keeps an empty workspace when no profile survives', () => {
    expect(parseDebugProfilesDocument(documentWith([{ ...profile, profileId: 'x' }]))).toEqual(
      documentWith([])
    )
  })

  it('keeps the newest workspaces when there are too many', () => {
    const workspaces = Object.fromEntries(
      Array.from({ length: 55 }, (_, i) => [`D:\\w${i}`, { updatedAt: i, profiles: [] }])
    )

    const parsed = parseDebugProfilesDocument({ schemaVersion: 1, workspaces })
    const keys = Object.keys(parsed?.workspaces ?? {})

    expect(keys).toHaveLength(50)
    expect(keys).not.toContain('D:\\w0')
    expect(keys).toContain('D:\\w54')
  })
})
