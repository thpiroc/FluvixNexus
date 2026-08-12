import { describe, expect, it } from 'vitest'
import { WORKSPACE_LAYOUT_DOCUMENT_MAX_BYTES } from '@shared/workspace'
import { parseWorkspaceLayoutDocument } from './workspaceLayoutDocument'

/**
 * Main が見るのは「文書としての形」だけ、という線引きの確認。
 *
 * レイアウトの中身（DockNode の木・PanelId）の検証は Renderer 側にあり、
 * ここでそれを再実装しないこと自体がこの層の設計。
 * そのため、中身がレイアウトとして意味を成すかどうかはここでは問わない。
 */
describe('parseWorkspaceLayoutDocument', () => {
  const valid = {
    schemaVersion: 1,
    layout: { presetId: 'default', root: { kind: 'group', id: 'root' } }
  }

  it('schemaVersion と layout を持つ文書を受け入れる', () => {
    expect(parseWorkspaceLayoutDocument(valid)).toEqual(valid)
  })

  it('契約に無いキーは落とす（保存し続けないため）', () => {
    const parsed = parseWorkspaceLayoutDocument({ ...valid, unexpected: 'x' })

    expect(parsed).toEqual(valid)
    expect(parsed === null || 'unexpected' in parsed).toBe(false)
  })

  it('layout の中身は解釈しない（Renderer の責務）', () => {
    const document = { schemaVersion: 1, layout: { anything: [1, 2, 3] } }

    expect(parseWorkspaceLayoutDocument(document)).toEqual(document)
  })

  it('将来の schemaVersion も文書としては受け入れる（対応の判断は Renderer）', () => {
    const document = { schemaVersion: 99, layout: {} }

    expect(parseWorkspaceLayoutDocument(document)).toEqual(document)
  })

  it.each([
    ['オブジェクトでない', 'broken'],
    ['null', null],
    ['配列', [{ schemaVersion: 1, layout: {} }]],
    ['schemaVersion が無い', { layout: {} }],
    ['schemaVersion が文字列', { schemaVersion: '1', layout: {} }],
    ['schemaVersion が整数でない', { schemaVersion: 1.5, layout: {} }],
    ['schemaVersion が 0 以下', { schemaVersion: 0, layout: {} }],
    ['layout が無い', { schemaVersion: 1 }],
    ['layout が null', { schemaVersion: 1, layout: null }],
    ['layout が配列', { schemaVersion: 1, layout: [] }]
  ])('%s 場合は null（＝Default Layout へ）', (_name, raw) => {
    expect(parseWorkspaceLayoutDocument(raw)).toBeNull()
  })

  it('桁違いに大きい内容は受け付けない', () => {
    const document = {
      schemaVersion: 1,
      layout: { presetId: 'default', filler: 'x'.repeat(WORKSPACE_LAYOUT_DOCUMENT_MAX_BYTES) }
    }

    expect(parseWorkspaceLayoutDocument(document)).toBeNull()
  })

  it('JSON にできない値は受け付けない', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(parseWorkspaceLayoutDocument({ schemaVersion: 1, layout: circular })).toBeNull()
  })
})
