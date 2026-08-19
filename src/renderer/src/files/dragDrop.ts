import { WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry } from '@shared/files'
import { canPasteInto } from './clipboard'
import { canMoveInto } from './moveTarget'

/**
 * ドラッグ&ドロップを「移動 / コピーの行き先」へ翻訳する（React にも DOM にも依存しない）。
 *
 * moveTarget.ts が「そのフォルダは移動先になれるか」を、clipboard.ts が「そのフォルダへ
 * 貼り付けられるか」を決めているのと同じ立ち位置で、**判断だけをデータとして切り出す。**
 * Workspace Shell のドラッグ&ドロップを「座標の解釈（dnd/dockGuide.ts）」と
 * 「操作への翻訳（dnd/dropTarget.ts）」と「マウスの追跡（dnd/usePanelDrag.ts）」に
 * 分けてあるのと同じ分け方で、ここは2つめにあたる（追跡は useFileDrag.ts）。
 *
 * ## 判定を作り直さない
 *
 * **禁止される操作の判定は Session 3-6-1 / 3-6-2 のものをそのまま呼ぶ** ──
 * 移動は `canMoveInto`（moveTarget.ts）、コピーは `canPasteInto`（clipboard.ts）。
 * ドラッグ&ドロップは新しい操作ではなく、既にある移動とコピーへの**別の入口**でしかない。
 * ここに同じ規則を書き直すと、右クリックからは断られる操作がドラッグからは通る
 * （あるいはその逆の）ずれが生まれる。
 *
 * mode で分けているのは、**成立する範囲が移動とコピーで違う**ため
 * （同じフォルダへのコピーは複製が1つ増えるので成立し、移動は何も起きない。§10.8）。
 * その差は既に clipboard.ts の `findPasteRejection` が mode で持っているので、
 * ここでは呼ぶ相手を選ぶだけで済む。
 *
 * ## Main の検証の代わりではない
 *
 * moveTarget.ts / clipboard.ts と同じで、正本は Main 側にある
 * （main/files/mutateWorkspaceEntry.ts）。**Renderer が通した ＝ 許可された、ではない。**
 * ここにあるのは、
 *
 *   - 落とせない場所にドロップ可能な見た目を出さないため
 *   - 何も起きない操作のために IPC を往復させないため
 *
 * の判断だけで、使うのは relativePath（＝画面から見えている位置）に限る。
 * ジャンクションを挟んだ行き先が実は Workspace の外だった / 自分自身の中だった、
 * という形は Renderer からは見抜けない（realpath を持たない）。それを見るのは Main で、
 * 断られたときは移動 / コピーと同じ文言が出る（filesError.ts）。
 */

/**
 * ドロップしたときに何が起きるか。
 *
 * Windows のエクスプローラの約束に合わせ、**素のドラッグが移動、Ctrl を押しながらが
 * コピー**（`dragModeFor`）。同じボリュームの中での既定が移動である点も揃えてある。
 */
export type FilesDragMode = 'move' | 'copy'

/**
 * ドラッグ中にカーソルが指している場所。
 *
 * ここに現れるのは**行き先になりうる場所だけ**で、ファイル行のように行き先に
 * なれない場所を指している間は（この型ではなく）null で表す。ファイル行を
 * 「その親フォルダ」と読み替えないのは、読み替えると**画面で指している行と
 * 実際の行き先が違う**ことになり、深い階層ほど取り違えが起きるため。
 */
export type FilesDropZone =
  /** フォルダ行。Workspace root の行も relativePath が空文字のフォルダ行として来る。 */
  | { readonly kind: 'directory'; readonly relativePath: string }
  /**
   * 行が無いところ（＝その面が受け持つフォルダ）。
   *
   * ツリーでは余白＝ Workspace root、カラム表示ではそのカラムが見せているフォルダに
   * なる（Session 3-6-7）。**面ごとに行き先を持たせる**のが要点で、カラムの余白を
   * 一律 root にすると、`src/renderer` のカラムの余白へ落としたのに Workspace 直下へ
   * 移る、という「指した場所と違う行き先」が生まれる。
   *
   * フォルダ行そのものは上の 'directory' として来るため、こちらは「一番下の行より下」や
   * 面の内側の余白にあたる。行がスクロールで見えていないときでも、そのフォルダへ置ける
   * 道を残すために余白を行き先として扱う。
   */
  | { readonly kind: 'surface'; readonly relativePath: string }

/** Ctrl を押しているかからドロップの種類を決める。キーボードイベントからも呼べる形にしてある。 */
export function dragModeFor(modifiers: { readonly ctrlKey: boolean }): FilesDragMode {
  return modifiers.ctrlKey ? 'copy' : 'move'
}

/**
 * そのエントリを掴めるか。
 *
 * Workspace root は Files パネルの操作範囲の外（FileContextMenu.tsx で「移動…」も
 * 「コピー」も出していないのと同じ理由）なので掴めない。**行き先にはなれる。**
 */
export function canDragEntry(entry: FileEntry): boolean {
  return entry.relativePath !== WORKSPACE_ROOT_RELATIVE_PATH
}

/**
 * 今指している場所へ落とせるなら行き先の relativePath、落とせないなら null。
 *
 * null を返す場合にドロップ可能な見た目を出さない（呼び出し側の約束）。
 * 「落とせるか」と「どこへ落ちるか」を別の関数にしないのは、2つに分けると
 * 片方だけ見て描く経路が生まれ、**案内した行き先と実際の行き先がずれうる**ため。
 */
export function resolveDropDestination(
  source: FileEntry,
  zone: FilesDropZone | null,
  mode: FilesDragMode
): string | null {
  if (zone === null) {
    return null
  }

  // どちらの場所も「行き先のフォルダ」を持っている（面は自分が見せているフォルダ）。
  const destination = zone.relativePath

  /*
    どちらも Session 3-6-1 / 3-6-2 の判定をそのまま呼ぶ。copy 側に渡しているのは
    「今 copy を控えている」のと同じ形（clipboard.ts の FilesClipboard）で、
    ドラッグ中の状態を控えとして持たせているわけではない ── 問いが同じなので、
    問いに答える関数も同じものを使う。
  */
  if (mode === 'copy') {
    return canPasteInto({ mode: 'copy', entry: source }, destination) ? destination : null
  }

  return canMoveInto(source, destination) ? destination : null
}
