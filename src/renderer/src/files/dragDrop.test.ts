import { describe, expect, it } from 'vitest'
import { WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry } from '@shared/files'
import { canDragEntry, dragModeFor, resolveDropDestination, type FilesDropZone } from './dragDrop'

/**
 * ドラッグ&ドロップの行き先の決め方（ドロップ可否の判断とガイドの出し先）。
 *
 * 正本は Main 側にあり、ここが決めるのは**出し分け**だけ。それでも試験を置くのは、
 * 間違えると「落とせるはずの場所に落とせない」（ハイライトが出ないので気づけない）か、
 * **画面で指した行と違う場所へ動く**という、どちらも失敗として現れない壊れ方をするため。
 *
 * 禁止される操作そのもの（自分自身 / 子孫 / 同じフォルダ）の網羅は
 * moveTarget.test.ts と clipboard.test.ts が持つ。ここで確かめるのは
 * **その判定に正しく繋がっているか**と、mode で成立範囲が変わることの2つ。
 */

function file(relativePath: string): FileEntry {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return { id: `f:${relativePath}`, name, relativePath, type: 'file', extension: null }
}

function directory(relativePath: string): FileEntry {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return { id: `d:${relativePath}`, name, relativePath, type: 'directory', extension: null }
}

function folderZone(relativePath: string): FilesDropZone {
  return { kind: 'directory', relativePath }
}

/** 面の余白（行が無いところ）。ツリーの余白は Workspace root を受け持つ。 */
function surfaceZone(relativePath: string): FilesDropZone {
  return { kind: 'surface', relativePath }
}

const treeRoot: FilesDropZone = surfaceZone(WORKSPACE_ROOT_RELATIVE_PATH)

describe('dragModeFor', () => {
  /* Windows のエクスプローラと同じ約束（素のドラッグが移動、Ctrl でコピー）。 */
  it('Ctrl を押していればコピー、押していなければ移動', () => {
    expect(dragModeFor({ ctrlKey: false })).toBe('move')
    expect(dragModeFor({ ctrlKey: true })).toBe('copy')
  })
})

describe('canDragEntry', () => {
  it('ファイルもフォルダも掴める', () => {
    expect(canDragEntry(file('src/main.ts'))).toBe(true)
    expect(canDragEntry(directory('src'))).toBe(true)
  })

  /* Workspace root は Files パネルの操作範囲の外（掴めないが、行き先にはなれる）。 */
  it('Workspace root は掴めない', () => {
    expect(canDragEntry(directory(WORKSPACE_ROOT_RELATIVE_PATH))).toBe(false)
  })
})

describe('resolveDropDestination（移動）', () => {
  it('フォルダ行へ落とせる', () => {
    expect(resolveDropDestination(file('src/main.ts'), folderZone('docs'), 'move')).toBe('docs')
    expect(resolveDropDestination(directory('src/lib'), folderZone('docs'), 'move')).toBe('docs')
  })

  it('ツリーの余白へ落とすと Workspace root へ移動になる', () => {
    expect(resolveDropDestination(file('src/main.ts'), treeRoot, 'move')).toBe(
      WORKSPACE_ROOT_RELATIVE_PATH
    )
  })

  /* root 行そのものはフォルダ行として来る（余白と同じ行き先になる）。 */
  it('root 行へ落としても Workspace root へ移動になる', () => {
    expect(
      resolveDropDestination(file('src/main.ts'), folderZone(WORKSPACE_ROOT_RELATIVE_PATH), 'move')
    ).toBe(WORKSPACE_ROOT_RELATIVE_PATH)
  })

  /*
    ファイル行は行き先にならない（親フォルダへ読み替えもしない）。
    呼び出し側は「行き先になれない場所」を null として渡す。
  */
  it('落とせない場所（null）では行き先が決まらない', () => {
    expect(resolveDropDestination(file('src/main.ts'), null, 'move')).toBeNull()
    expect(resolveDropDestination(file('src/main.ts'), null, 'copy')).toBeNull()
  })

  it('自分自身へは落とせない', () => {
    expect(resolveDropDestination(directory('src'), folderZone('src'), 'move')).toBeNull()
  })

  it('自分の子孫フォルダへは落とせない', () => {
    expect(resolveDropDestination(directory('src'), folderZone('src/lib'), 'move')).toBeNull()
    expect(resolveDropDestination(directory('src'), folderZone('src/lib/deep'), 'move')).toBeNull()
  })

  /* 動かしても何も変わらない。IPC を往復させる意味が無い（moveTarget.ts の same-parent）。 */
  it('今いるフォルダへは落とせない', () => {
    expect(resolveDropDestination(file('src/main.ts'), folderZone('src'), 'move')).toBeNull()
    expect(resolveDropDestination(file('main.ts'), treeRoot, 'move')).toBeNull()
  })

  /* 前方一致するだけの別フォルダ（shared/files/relativePath.ts の isAtOrUnder）。 */
  it('名前が前方一致するだけの別フォルダへは落とせる', () => {
    expect(resolveDropDestination(directory('src'), folderZone('src2'), 'move')).toBe('src2')
  })

  /*
    カラム表示の余白（Session 3-6-7）。**そのカラムが見せているフォルダが行き先になる。**
    面の余白を一律 root にすると、指した場所と違うところへ動くことになる。
  */
  it('カラムの余白へ落とすと、そのカラムのフォルダへ移動になる', () => {
    expect(resolveDropDestination(file('docs/readme.md'), surfaceZone('src'), 'move')).toBe('src')
    expect(
      resolveDropDestination(directory('docs/guide'), surfaceZone('src/renderer'), 'move')
    ).toBe('src/renderer')
  })

  /* 面の余白でも判定は行と同じものを通る（今いるフォルダ・自分自身の中）。 */
  it('カラムの余白でも成立しない行き先は落とせない', () => {
    expect(resolveDropDestination(file('src/main.ts'), surfaceZone('src'), 'move')).toBeNull()
    expect(resolveDropDestination(directory('src'), surfaceZone('src/lib'), 'move')).toBeNull()
  })
})

describe('resolveDropDestination（コピー）', () => {
  it('フォルダ行へ落とせる', () => {
    expect(resolveDropDestination(file('src/main.ts'), folderZone('docs'), 'copy')).toBe('docs')
  })

  it('ツリーの余白へ落とすと Workspace root へのコピーになる', () => {
    expect(resolveDropDestination(file('src/main.ts'), treeRoot, 'copy')).toBe(
      WORKSPACE_ROOT_RELATIVE_PATH
    )
  })

  /**
   * **移動と違うのはここだけ。** 同じフォルダへのコピーは複製が1つ増えるので成立する
   * （§10.8）。Ctrl を押し直すだけで落とせる場所が増える形になる。
   */
  it('今いるフォルダへも落とせる（複製が1つ増える）', () => {
    expect(resolveDropDestination(file('src/main.ts'), folderZone('src'), 'copy')).toBe('src')
    expect(resolveDropDestination(file('main.ts'), treeRoot, 'copy')).toBe(
      WORKSPACE_ROOT_RELATIVE_PATH
    )
  })

  it('自分自身とその子孫へは落とせない', () => {
    expect(resolveDropDestination(directory('src'), folderZone('src'), 'copy')).toBeNull()
    expect(resolveDropDestination(directory('src'), folderZone('src/lib'), 'copy')).toBeNull()
  })
})
