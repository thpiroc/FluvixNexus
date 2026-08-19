import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_FOLDER_SCHEMA_VERSION,
  WORKSPACE_ROOT_PATH_MAX_LENGTH,
  type WorkspaceFolderDocument
} from '@shared/workspace'
import { parseWorkspaceFolderDocument } from './workspaceFolderDocument'

/**
 * レイアウト文書と違い、Main は Workspace の中身まで見る。
 * その値を使うのが Main 自身であり、判断を任せられる相手がいないため。
 */
describe('parseWorkspaceFolderDocument', () => {
  const workspace = {
    id: 'a1b2c3',
    rootPath: 'D:\\projects\\demo',
    displayName: 'demo',
    openedAt: 1_700_000_000_000
  }

  const valid: WorkspaceFolderDocument = {
    schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION,
    lastWorkspace: workspace
  }

  it('保存された Workspace を受け入れる', () => {
    expect(parseWorkspaceFolderDocument(valid)).toEqual(valid)
  })

  it('Workspace を閉じた状態（null）も正しい内容として扱う', () => {
    const closed = { schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION, lastWorkspace: null }

    expect(parseWorkspaceFolderDocument(closed)).toEqual(closed)
  })

  it('lastWorkspace が無い場合も未選択として読む', () => {
    expect(
      parseWorkspaceFolderDocument({ schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION })
    ).toEqual({ schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION, lastWorkspace: null })
  })

  it('契約に無いキーは落とす（保存し続けないため）', () => {
    const parsed = parseWorkspaceFolderDocument({
      ...valid,
      unexpected: 'x',
      lastWorkspace: { ...workspace, exists: true }
    })

    expect(parsed).toEqual(valid)
    expect(parsed?.lastWorkspace === null || 'exists' in parsed!.lastWorkspace).toBe(false)
  })

  it.each([
    ['オブジェクトでない', 'broken'],
    ['null', null],
    ['配列', [valid]],
    ['schemaVersion が無い', { lastWorkspace: workspace }],
    ['schemaVersion が文字列', { schemaVersion: '1', lastWorkspace: workspace }],
    ['未対応の schemaVersion（未来）', { schemaVersion: 99, lastWorkspace: workspace }],
    ['未対応の schemaVersion（0）', { schemaVersion: 0, lastWorkspace: workspace }]
  ])('%s 場合は null（＝未選択で起動）', (_name, raw) => {
    expect(parseWorkspaceFolderDocument(raw)).toBeNull()
  })

  it.each([
    ['id が無い', { ...workspace, id: undefined }],
    ['id が空', { ...workspace, id: '' }],
    ['rootPath が無い', { ...workspace, rootPath: undefined }],
    ['rootPath が空', { ...workspace, rootPath: '' }],
    ['rootPath が文字列でない', { ...workspace, rootPath: 123 }],
    [
      'rootPath が桁違いに長い',
      { ...workspace, rootPath: 'x'.repeat(WORKSPACE_ROOT_PATH_MAX_LENGTH + 1) }
    ],
    ['displayName が空', { ...workspace, displayName: '' }],
    ['openedAt が無い', { ...workspace, openedAt: undefined }],
    ['openedAt が文字列', { ...workspace, openedAt: '1700000000000' }],
    ['openedAt が負', { ...workspace, openedAt: -1 }],
    ['openedAt が NaN', { ...workspace, openedAt: Number.NaN }],
    ['Workspace がオブジェクトでない', 'D:\\projects\\demo'],
    ['Workspace が配列', [workspace]]
  ])('Workspace の %s 場合は null（＝未選択で起動）', (_name, lastWorkspace) => {
    expect(
      parseWorkspaceFolderDocument({
        schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION,
        lastWorkspace
      })
    ).toBeNull()
  })

  it('パスが実在するかどうかは見ない（復元する時点の判断のため）', () => {
    const missing = {
      schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION,
      lastWorkspace: { ...workspace, rootPath: 'D:\\no\\such\\folder' }
    }

    expect(parseWorkspaceFolderDocument(missing)).toEqual(missing)
  })
})
