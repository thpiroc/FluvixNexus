import { isAtOrUnder, parentRelativePath, type FileEntry } from '@shared/files'

/**
 * Files パネルの中だけのクリップボード（React にも DOM にも依存しない）。
 *
 * moveTarget.ts が「その行き先は成立するか」を、fileTreeModel.ts が「行の並び」を
 * 決めているのと同じ立ち位置で、**判断だけをデータとして切り出す。**
 *
 * ## OS のクリップボードは使わない
 *
 * 持つのは relativePath だけ（FileEntry）。OS のクリップボードへ載せるには
 * 絶対パスか実体が要り、**Renderer が絶対パスを持たない**という前提
 * （ARCHITECTURE.md §9.2）を崩すことになる。エクスプローラとの受け渡しは、
 * やるなら Main 側の別の経路（`clipboard` は Electron の Main / Renderer 双方に
 * あるが、Workspace の境界を通す口を1つ増やす話になる）。
 *
 * ここで扱うのは「Files パネルの中で、さっき指したもの」だけに留める。
 *
 * ## Workspace をまたがない
 *
 * relativePath は今の Workspace の中でしか意味を持たない。Workspace が切り替わると
 * FileTree ごと作り直される（FilesPanel.tsx が `key` に workspace.id を渡している）
 * ため、この状態も一緒に消える。**「切り替わったら消す」処理を書かない。**
 *
 * ## copy と cut を最初から同じ形で持つ
 *
 * UI から使えるのは `copy` だけだが、器は `mode` を持つ形にしてある。
 * cut を後から足すときに**貼り付け側の判断（下の findPasteRejection）を書き換えずに済む**
 * ようにするため ── 貼り付け先が成立するかの問いは mode で変わるので、
 * mode を持たない形にすると、その分岐が呼び出し側へ漏れる。
 *
 * **Session 3-6-3 で「cut は UI へ出さない」と決めた。** 移動の主な入口は
 * ドラッグ&ドロップ（dragDrop.ts）になり、右クリックの「移動…」は行き先が
 * 画面に出ていないときの道として残る。ここへ「切り取り → 貼り付け」を足すと
 * **同じ操作への入口が3つ**になり、しかも3つめは既にある2手と手数も結果も同じものになる。
 *
 * 器を残しているのは、OS のクリップボードとの受け渡し（エクスプローラから切り取って
 * 貼る）を入れるときに要る形であるため。それは上記のとおり Main 側の別の経路の話。
 */

/** 貼り付けたときに何が起きるか。 */
export type FilesClipboardMode =
  /** 複製する（元は残る）。 */
  | 'copy'
  /**
   * 動かす（元は消える）。
   *
   * **UI からは載せない**（Session 3-6-3 で決めた。上記）。載せる日が来るとしたら
   * OS のクリップボードとの受け渡しであって、Files パネルの中だけの控えとしてではない。
   * 実際の処理は `files:move`（Session 3-6-1）がそのまま使える。
   */
  | 'cut'

/** さっき指したもの。指していなければ null（呼び出し側が持つ）。 */
export interface FilesClipboard {
  readonly mode: FilesClipboardMode
  /**
   * 指したときの姿。
   *
   * **これが今もそこに在るとは限らない**（貼り付ける前に消される・改名される）。
   * 実在の確認は Main 側で行い、無ければ NOT_FOUND として返る。
   * Renderer 側で先に確かめる形にしないのは、確かめてから貼り付けるまでの隙間が
   * 残るうえ、ツリーの表示（消えた行はイベントで消える）と二重に持つことになるため。
   */
  readonly entry: FileEntry
}

/** その貼り付け先が成立しない理由。成立するなら null。 */
export type PasteRejection =
  /**
   * 貼り付け先が、指したもの自身か、その中。
   *
   * copy では**複製の中を複製し続ける**ことになり、cut では移動と同じく
   * 行き場が無くなる。どちらも成立しない。
   */
  | 'into-self'
  /**
   * 既にそのフォルダの中にいる。
   *
   * **cut だけの理由。** copy では同じフォルダへの貼り付けが成立する
   * （`example copy.txt` が1つ増える）── これが複製そのものの操作になる。
   */
  | 'same-parent'

/**
 * そのフォルダへ貼り付けられるか（成立しない理由、または null）。
 *
 * ## Main の検証の代わりではない
 *
 * moveTarget.ts と同じで、正本は Main 側にある。ここにあるのは
 * **成立しない貼り付け先をメニューに出さない**ための判断で、
 * 見えている位置（relativePath）だけで決まるものに限る。
 * Ctrl を押しながらのドラッグ（Session 3-6-3。dragDrop.ts）も
 * **同じ問いなので同じ関数を呼ぶ** ── コピー先が成立するかの規則を2箇所に書かない。
 * ジャンクションを挟んだ貼り付け先が実は自分自身の中だった、という形は
 * Renderer からは見抜けない（realpath を持たない）ので、ここでは見抜こうとしない。
 */
export function findPasteRejection(
  clipboard: FilesClipboard,
  destinationRelativePath: string
): PasteRejection | null {
  if (isAtOrUnder(clipboard.entry.relativePath, destinationRelativePath)) {
    return 'into-self'
  }

  if (
    clipboard.mode === 'cut' &&
    destinationRelativePath === parentRelativePath(clipboard.entry.relativePath)
  ) {
    return 'same-parent'
  }

  return null
}

/** 貼り付け先として選べるか。メニューに項目を出すかの判断に使う。 */
export function canPasteInto(clipboard: FilesClipboard, destinationRelativePath: string): boolean {
  return findPasteRejection(clipboard, destinationRelativePath) === null
}
