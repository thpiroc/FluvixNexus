import { joinRelativePath, type FileEntry, type FileEntryType } from '@shared/files'

/**
 * ディスク上の1件を、Renderer へ渡す FileEntry へ落とす。
 *
 * 列挙（readWorkspaceDirectory.ts）と作成 / 改名（mutateWorkspaceEntry.ts）の両方が
 * FileEntry を作るため、作り方をここ1箇所に置く。**id と拡張子の導き方が
 * 経路ごとにずれると、ツリーに並んでいる行と、作った直後に選ぼうとした行が
 * 別のものとして扱われる**（id が選択・展開状態の鍵になっている）。
 *
 * Electron にも fs にも依存しない（テストできる形にしておく）。
 */

/**
 * 拡張子（小数点なし・小文字）。
 *
 * 先頭のドットだけの名前（`.gitignore`）は拡張子ではない。
 * 末尾がドットの名前は、そもそも受け付けない（shared/files/fileName.ts）。
 */
export function deriveExtension(name: string): string | null {
  const dot = name.lastIndexOf('.')

  if (dot <= 0 || dot === name.length - 1) {
    return null
  }

  return name.slice(dot + 1).toLowerCase()
}

export function toFileEntry(
  name: string,
  parentRelativePath: string,
  type: FileEntryType
): FileEntry {
  const relativePath = joinRelativePath(parentRelativePath, name)

  return {
    // relativePath と種別の組。同じ名前がファイルからフォルダへ置き換わったとき、
    // id が変わることで表示側の選択・展開状態がその場で無効になる。
    id: `${type === 'directory' ? 'd' : 'f'}:${relativePath}`,
    name,
    relativePath,
    type,
    extension: type === 'directory' ? null : deriveExtension(name)
  }
}
