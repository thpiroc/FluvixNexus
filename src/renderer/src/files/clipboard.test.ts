import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@shared/files'
import { canPasteInto, findPasteRejection, type FilesClipboard } from './clipboard'

/**
 * 貼り付け先の判断の検証。
 *
 * 確かめるのは**メニューに出す / 出さない**の境目だけ。実際に貼り付けられるかは
 * Main が決める（realpath を見るのはあちら）ので、ここでは見えている位置
 * （relativePath）から決まる形だけを対象にする。
 */

function entryOf(relativePath: string, type: FileEntry['type'] = 'file'): FileEntry {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return {
    id: `${type === 'directory' ? 'd' : 'f'}:${relativePath}`,
    name,
    relativePath,
    type,
    extension: null
  }
}

function clipboardOf(
  relativePath: string,
  mode: FilesClipboard['mode'],
  type: FileEntry['type'] = 'file'
): FilesClipboard {
  return { mode, entry: entryOf(relativePath, type) }
}

describe('findPasteRejection', () => {
  it('別のフォルダへは copy / cut のどちらでも貼り付けられる', () => {
    expect(findPasteRejection(clipboardOf('src/main.ts', 'copy'), 'docs')).toBeNull()
    expect(findPasteRejection(clipboardOf('src/main.ts', 'cut'), 'docs')).toBeNull()
  })

  it('Workspace root（空文字）へも貼り付けられる', () => {
    expect(findPasteRejection(clipboardOf('src/main.ts', 'copy'), '')).toBeNull()
  })

  /*
    copy と cut で答えが割れる唯一の場所。同じフォルダへの copy は
    「複製が1つ増える」という成立する操作で、cut は何も起きない。
  */
  it('同じフォルダへの貼り付けは copy なら成立し、cut なら成立しない', () => {
    expect(findPasteRejection(clipboardOf('src/main.ts', 'copy'), 'src')).toBeNull()
    expect(findPasteRejection(clipboardOf('src/main.ts', 'cut'), 'src')).toBe('same-parent')
  })

  it('root 直下のものを root へ貼り付ける場合も同じ', () => {
    expect(findPasteRejection(clipboardOf('main.ts', 'copy'), '')).toBeNull()
    expect(findPasteRejection(clipboardOf('main.ts', 'cut'), '')).toBe('same-parent')
  })

  it.each([
    ['自分自身', 'src'],
    ['自分の中', 'src/lib'],
    ['自分の深い中', 'src/lib/deep']
  ])('フォルダを %s へは貼り付けられない', (_label, destination) => {
    expect(findPasteRejection(clipboardOf('src', 'copy', 'directory'), destination)).toBe(
      'into-self'
    )
    expect(findPasteRejection(clipboardOf('src', 'cut', 'directory'), destination)).toBe(
      'into-self'
    )
  })

  /*
    前方一致は区切り文字まで含めて比べる（shared/files/relativePath.ts）。
    `src` と `src2` を混同すると、成立する貼り付け先がメニューから消える。
  */
  it('名前が前方一致するだけの別フォルダは自分の中ではない', () => {
    expect(findPasteRejection(clipboardOf('src', 'copy', 'directory'), 'src2')).toBeNull()
  })
})

describe('canPasteInto', () => {
  it('理由が無いときだけ true', () => {
    const clipboard = clipboardOf('src', 'copy', 'directory')

    expect(canPasteInto(clipboard, 'docs')).toBe(true)
    expect(canPasteInto(clipboard, 'src/lib')).toBe(false)
  })
})
