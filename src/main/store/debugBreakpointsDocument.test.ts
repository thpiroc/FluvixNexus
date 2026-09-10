import { describe, expect, it } from 'vitest'
import {
  DEBUG_BREAKPOINTS_MAX_WORKSPACES,
  DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE,
  DEBUG_BREAKPOINTS_SCHEMA_VERSION
} from '@shared/debug'
import { parseDebugBreakpointsDocument } from './debugBreakpointsDocument'

function document(workspaces: unknown): unknown {
  return { schemaVersion: DEBUG_BREAKPOINTS_SCHEMA_VERSION, workspaces }
}

describe('読める文書', () => {
  it('Workspace ごとに引ける形で返る', () => {
    const parsed = parseDebugBreakpointsDocument(
      document({
        'D:\\proj': {
          updatedAt: 100,
          breakpoints: [{ relativePath: 'src/a.ts', line: 3, enabled: true }]
        }
      })
    )

    expect(parsed?.workspaces['D:\\proj']?.breakpoints).toEqual([
      { relativePath: 'src/a.ts', line: 3, enabled: true }
    ])
  })

  it('契約に無い key は落とす', () => {
    const parsed = parseDebugBreakpointsDocument({
      schemaVersion: 1,
      workspaces: {},
      somethingElse: 'nope'
    })

    expect(parsed).toEqual({ schemaVersion: 1, workspaces: {} })
  })

  /* 少し古い保存ファイルで、印が黙って効かなくなるのを避ける。 */
  it('enabled が欠けていれば有効として読む', () => {
    const parsed = parseDebugBreakpointsDocument(
      document({ 'D:\\proj': { updatedAt: 1, breakpoints: [{ relativePath: 'a.ts', line: 1 }] } })
    )

    expect(parsed?.workspaces['D:\\proj']?.breakpoints[0]?.enabled).toBe(true)
  })

  it('updatedAt が読めなければ 0 にする', () => {
    const parsed = parseDebugBreakpointsDocument(
      document({ 'D:\\proj': { updatedAt: 'yesterday', breakpoints: [] } })
    )

    expect(parsed?.workspaces['D:\\proj']?.updatedAt).toBe(0)
  })
})

describe('文書ごと捨てる場合', () => {
  it.each([
    null,
    undefined,
    42,
    'nope',
    [],
    {},
    { schemaVersion: 0, workspaces: {} },
    { schemaVersion: -1, workspaces: {} },
    { schemaVersion: 1.5, workspaces: {} },
    { schemaVersion: '1', workspaces: {} },
    { schemaVersion: 1 },
    { schemaVersion: 1, workspaces: [] },
    { schemaVersion: 1, workspaces: 'nope' }
  ])('エンベロープが読めない: %s', (raw) => {
    expect(parseDebugBreakpointsDocument(raw)).toBeNull()
  })

  /*
    Workspace の数も1 Workspace の件数も上限で切った**後**に大きさを見る。
    それでも上限に届くのは、相対位置そのものが長い場合になる
    （500 件 × 3000 文字で 1.5MB。上限は 512KB）。
  */
  it('桁違いに大きい文書を断る', () => {
    const breakpoints = Array.from(
      { length: DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE },
      (_unused, index) => ({
        relativePath: `${'x'.repeat(3000)}/${String(index)}.ts`,
        line: index + 1,
        enabled: true
      })
    )

    expect(
      parseDebugBreakpointsDocument(document({ 'D:\\proj': { updatedAt: 1, breakpoints } }))
    ).toBeNull()
  })
})

describe('1件が壊れても全部を捨てない', () => {
  it('読めない breakpoint だけを落とす', () => {
    const parsed = parseDebugBreakpointsDocument(
      document({
        'D:\\proj': {
          updatedAt: 1,
          breakpoints: [
            { relativePath: 'ok.ts', line: 1, enabled: true },
            { relativePath: '', line: 1, enabled: true },
            { relativePath: 'bad.ts', line: 0, enabled: true },
            { relativePath: 'bad.ts', line: -3, enabled: true },
            { relativePath: 'bad.ts', line: 1.5, enabled: true },
            { relativePath: 'bad.ts', line: '3', enabled: true },
            { relativePath: 42, line: 1, enabled: true },
            null,
            'nope',
            [],
            { relativePath: 'ok2.ts', line: 9, enabled: false }
          ]
        }
      })
    )

    expect(parsed?.workspaces['D:\\proj']?.breakpoints).toEqual([
      { relativePath: 'ok.ts', line: 1, enabled: true },
      { relativePath: 'ok2.ts', line: 9, enabled: false }
    ])
  })

  it('手で編集された重複を畳む', () => {
    const parsed = parseDebugBreakpointsDocument(
      document({
        'D:\\proj': {
          updatedAt: 1,
          breakpoints: [
            { relativePath: 'a.ts', line: 1, enabled: true },
            { relativePath: 'a.ts', line: 1, enabled: false }
          ]
        }
      })
    )

    expect(parsed?.workspaces['D:\\proj']?.breakpoints).toHaveLength(1)
  })

  it('1 Workspace の件数を上限で切る', () => {
    const breakpoints = Array.from(
      { length: DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE + 50 },
      (_unused, index) => ({ relativePath: 'a.ts', line: index + 1, enabled: true })
    )

    expect(
      parseDebugBreakpointsDocument(document({ 'D:\\proj': { updatedAt: 1, breakpoints } }))
        ?.workspaces['D:\\proj']?.breakpoints
    ).toHaveLength(DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE)
  })

  it('形の読めない Workspace だけを落とす', () => {
    const parsed = parseDebugBreakpointsDocument(
      document({
        'D:\\ok': { updatedAt: 1, breakpoints: [] },
        'D:\\bad': { updatedAt: 1, breakpoints: 'nope' },
        'D:\\bad2': 42
      })
    )

    expect(Object.keys(parsed?.workspaces ?? {})).toEqual(['D:\\ok'])
  })
})

describe('Workspace の数', () => {
  it('新しいものから順に上限まで残す', () => {
    const workspaces: Record<string, unknown> = {}

    for (let index = 0; index < DEBUG_BREAKPOINTS_MAX_WORKSPACES + 10; index += 1) {
      workspaces[`D:\\proj-${String(index)}`] = { updatedAt: index, breakpoints: [] }
    }

    const parsed = parseDebugBreakpointsDocument(document(workspaces))
    const kept = Object.keys(parsed?.workspaces ?? {})

    expect(kept).toHaveLength(DEBUG_BREAKPOINTS_MAX_WORKSPACES)
    // 最も古い（updatedAt が小さい）ものから落ちる。
    expect(kept).not.toContain('D:\\proj-0')
    expect(kept).toContain(`D:\\proj-${String(DEBUG_BREAKPOINTS_MAX_WORKSPACES + 9)}`)
  })
})
