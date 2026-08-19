import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { WORKSPACE_ROOT_PATH_MAX_LENGTH } from '@shared/workspace'
import { deriveWorkspaceDisplayName, normalizeWorkspaceRootPath } from './folderPath'

/**
 * パス文字列に対する判断だけを見る（実在するかどうかは対象外）。
 *
 * `/projects/demo` 形式は win32 / posix のどちらでも「絶対パス」として扱われるため、
 * 基本の確認はこの形で書く。ドライブレターのように OS で意味が変わる形は
 * win32 でのみ確認する（v1 の対象は Windows。DESIGN.md §8）。
 */
const isWindows = process.platform === 'win32'

describe('normalizeWorkspaceRootPath', () => {
  it('絶対パスを正規化して返す', () => {
    expect(normalizeWorkspaceRootPath('/projects/demo')).toBe(resolve('/projects/demo'))
  })

  it('前後の空白を落とす', () => {
    expect(normalizeWorkspaceRootPath('  /projects/demo  ')).toBe(resolve('/projects/demo'))
  })

  it('末尾の区切りが付いていても同じ結果になる（同じフォルダを別物にしない）', () => {
    expect(normalizeWorkspaceRootPath('/projects/demo/')).toBe(
      normalizeWorkspaceRootPath('/projects/demo')
    )
  })

  it('`.` や `..` を解決する', () => {
    expect(normalizeWorkspaceRootPath('/projects/./sub/../demo')).toBe(resolve('/projects/demo'))
  })

  it.each([
    ['文字列でない', 42],
    ['null', null],
    ['undefined', undefined],
    ['オブジェクト', { rootPath: '/projects/demo' }],
    ['空文字', ''],
    ['空白だけ', '   '],
    ['相対パス', 'projects/demo'],
    ['カレント相対', './demo'],
    ['NUL を含む', '/projects/demo\0/etc'],
    ['桁違いに長い', `/${'a'.repeat(WORKSPACE_ROOT_PATH_MAX_LENGTH)}`]
  ])('%s 場合は null', (_name, raw) => {
    expect(normalizeWorkspaceRootPath(raw)).toBeNull()
  })

  it('上限ちょうどの長さは受け付ける', () => {
    const path = `/${'a'.repeat(WORKSPACE_ROOT_PATH_MAX_LENGTH - 1)}`

    expect(path.length).toBe(WORKSPACE_ROOT_PATH_MAX_LENGTH)
    expect(normalizeWorkspaceRootPath(path)).not.toBeNull()
  })

  it.runIf(isWindows)('ドライブレター付きのパスを受け付ける', () => {
    expect(normalizeWorkspaceRootPath('D:\\projects\\demo')).toBe('D:\\projects\\demo')
  })

  it.runIf(isWindows)('区切り文字を OS の表記へ揃える', () => {
    expect(normalizeWorkspaceRootPath('D:/projects/demo')).toBe('D:\\projects\\demo')
  })

  it.runIf(isWindows)('UNC パスを受け付ける', () => {
    expect(normalizeWorkspaceRootPath('\\\\server\\share\\demo')).toBe('\\\\server\\share\\demo')
  })
})

describe('deriveWorkspaceDisplayName', () => {
  it('フォルダ名を名前にする', () => {
    expect(deriveWorkspaceDisplayName(resolve('/projects/demo'))).toBe('demo')
  })

  it('日本語のフォルダ名もそのまま扱う', () => {
    expect(deriveWorkspaceDisplayName(resolve('/projects/開発中'))).toBe('開発中')
  })

  it.runIf(isWindows)('ドライブ直下はパスそのものを名前にする（名前が空にならない）', () => {
    expect(deriveWorkspaceDisplayName('D:\\')).toBe('D:\\')
  })
})
