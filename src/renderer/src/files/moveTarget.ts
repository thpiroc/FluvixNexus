import { isAtOrUnder, parentRelativePath, type FileEntry } from '@shared/files'

/**
 * そのフォルダが、今動かそうとしているものの移動先になれるか（React にも DOM にも依存しない）。
 *
 * fileTreeModel.ts が「行の並び」を、nameEditState.ts が「入力欄が今受け付けるもの」を
 * 決めているのと同じ立ち位置で、**判断だけをデータとして切り出す。**
 *
 * ## Main の検証の代わりではない
 *
 * 正本は Main 側にある（main/files/mutateWorkspaceEntry.ts）。**Renderer が通した
 * ＝ 許可された、ではない。** ここにあるのは、
 *
 *   - 成立しない移動先を**メニューに出さない**ため（できない操作を並べて断らない。
 *     FileContextMenu.tsx の方針）
 *   - 成立しない移動先に**ドロップできる見た目を出さない**ため
 *     （Session 3-6-3。dragDrop.ts がこの関数を呼ぶ）
 *   - 何も起きない移動のために IPC を往復させないため
 *
 * の判断で、名前の検査を shared/files/fileName.ts に置いてあるのと同じ理由による。
 * 違うのは、こちらが Renderer にしか要らない判断（メニューの出し分け）である点で、
 * だから shared ではなく Files の隣に置く。
 *
 * ## 見えている位置だけで判断する
 *
 * 使うのは relativePath だけ。Renderer は絶対パスも realpath も持たないため、
 * **ジャンクションを挟んだ移動先が実は自分自身の中だった**という形はここでは見抜けない。
 * それを見るのは Main の仕事で、断られたときは移動固有の失敗として文言が出る
 * （shared/files/move.ts）。ここで見抜けないことを、ここで見抜こうとしない。
 */

/** その移動先が成立しない理由。成立するなら null。 */
export type MoveRejection =
  /** 既にそのフォルダの中にいる（動かしても何も変わらない）。 */
  | 'same-parent'
  /** 移動先が、動かすもの自身か、その中。 */
  | 'into-self'

export function findMoveRejection(
  source: FileEntry,
  destinationRelativePath: string
): MoveRejection | null {
  /*
    自分自身 / その中を先に見る。

    root（空文字）を動かすことはできないため（Files の操作範囲の外。
    FileContextMenu.tsx）、ここへ来る source は必ず親を持つ。
  */
  if (isAtOrUnder(source.relativePath, destinationRelativePath)) {
    return 'into-self'
  }

  if (destinationRelativePath === parentRelativePath(source.relativePath)) {
    return 'same-parent'
  }

  return null
}

/** 移動先として選べるか。メニューに項目を出すかの判断に使う。 */
export function canMoveInto(source: FileEntry, destinationRelativePath: string): boolean {
  return findMoveRejection(source, destinationRelativePath) === null
}
