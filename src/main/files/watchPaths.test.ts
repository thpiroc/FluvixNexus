import { describe, expect, it } from 'vitest'
import {
  dropPathsUnderDeleted,
  isIgnoredWatchPath,
  toWorkspaceRelativeWatchPath
} from './watchPaths'

/**
 * ファイル監視から届いたパスの扱い（Session 3-5）。
 *
 * `workspacePath.test.ts` が「Renderer から来たパスで外へ出られないこと」を見るのに対し、
 * ここは逆向き ── **OS から来たパスを Renderer へ渡してよい形へ落とせること**を見る。
 * 要は3つ。
 *   - Workspace の外を指すものは配らない
 *   - Renderer へ絶対パスを渡さない
 *   - 桁違いの変化で Renderer を埋めない（除外と、配下の畳み込み）
 */

const ROOT = 'D:\\proj'

describe('toWorkspaceRelativeWatchPath', () => {
  it('root からの相対位置に落とし、区切りは / にする', () => {
    expect(toWorkspaceRelativeWatchPath(ROOT, 'D:\\proj\\src\\main\\index.ts')).toBe(
      'src/main/index.ts'
    )
  })

  it('root 直下も扱える', () => {
    expect(toWorkspaceRelativeWatchPath(ROOT, 'D:\\proj\\README.md')).toBe('README.md')
  })

  it('末尾に区切りが付いた root でも同じ結果になる', () => {
    expect(toWorkspaceRelativeWatchPath('D:\\proj\\', 'D:\\proj\\a.ts')).toBe('a.ts')
  })

  // Windows では realpath とドライブレターの表記が揃わないことがある。
  it('Windows では大文字小文字を区別しない', () => {
    expect(toWorkspaceRelativeWatchPath(ROOT, 'd:\\PROJ\\src\\a.ts')).toBe('src/a.ts')
  })

  it('root そのものは変化として扱わない', () => {
    expect(toWorkspaceRelativeWatchPath(ROOT, 'D:\\proj')).toBeNull()
  })

  // ここが緩むと `D:\proj` の監視が `D:\project` の変化を拾う。
  it('前方一致だけの別フォルダは受け付けない', () => {
    expect(toWorkspaceRelativeWatchPath(ROOT, 'D:\\project\\a.ts')).toBeNull()
  })

  it('Workspace の外は受け付けない', () => {
    expect(toWorkspaceRelativeWatchPath(ROOT, 'D:\\other\\a.ts')).toBeNull()
    expect(toWorkspaceRelativeWatchPath(ROOT, 'C:\\Windows\\system32\\a.dll')).toBeNull()
  })

  it('`..` や `.` を含む形は受け付けない', () => {
    expect(toWorkspaceRelativeWatchPath(ROOT, 'D:\\proj\\..\\outside\\a.ts')).toBeNull()
    expect(toWorkspaceRelativeWatchPath(ROOT, 'D:\\proj\\.\\a.ts')).toBeNull()
  })

  it('桁違いに長い位置は受け付けない', () => {
    const deep = `D:\\proj\\${'a'.repeat(5000)}`

    expect(toWorkspaceRelativeWatchPath(ROOT, deep)).toBeNull()
  })
})

describe('isIgnoredWatchPath', () => {
  it('.git と node_modules は、どの階層に現れても外す', () => {
    expect(isIgnoredWatchPath('node_modules/react/index.js')).toBe(true)
    expect(isIgnoredWatchPath('packages/app/node_modules/x/y.js')).toBe(true)
    expect(isIgnoredWatchPath('.git/objects/ab/cdef')).toBe(true)
    expect(isIgnoredWatchPath('src/.git/config')).toBe(true)
  })

  it('名前が似ているだけのものは外さない', () => {
    expect(isIgnoredWatchPath('node_modules_backup/a.ts')).toBe(false)
    expect(isIgnoredWatchPath('src/gitignore.ts')).toBe(false)
    expect(isIgnoredWatchPath('.github/workflows/ci.yml')).toBe(false)
  })

  it('普通のソースは外さない', () => {
    expect(isIgnoredWatchPath('src/main/index.ts')).toBe(false)
  })
})

describe('dropPathsUnderDeleted', () => {
  it('消えたフォルダの配下は畳む', () => {
    expect(
      dropPathsUnderDeleted(['src', 'src/a.ts', 'src/deep/b.ts', 'docs/c.md'], ['src'])
    ).toEqual(['src', 'docs/c.md'])
  })

  it('前方一致だけのフォルダは巻き込まない', () => {
    expect(dropPathsUnderDeleted(['src2/a.ts'], ['src'])).toEqual(['src2/a.ts'])
  })

  it('消えたものが無ければそのまま返す', () => {
    const paths = ['a.ts', 'b.ts']

    expect(dropPathsUnderDeleted(paths, [])).toBe(paths)
  })

  it('消えたもの自身は残る（その1件は配る必要がある）', () => {
    expect(dropPathsUnderDeleted(['src/a.ts'], ['src/a.ts'])).toEqual(['src/a.ts'])
  })
})
