import type { EditorSaveAsNotice } from './useEditorSession'

/**
 * 別名で保存の結末を1行の文にする（Session 4-2）。
 *
 * `unsaved/lossMessage.ts` と同じ位置づけ ── 文言を組み立てる純粋な判断を
 * 描く側（EditorWorkArea.tsx）から切り出して、ここだけをテストの対象にする。
 *
 * ## 「書けたか」と「タブが移ったか」を混ぜない
 *
 * この経路では、**書けたのにタブが移らない**場合がある（Workspace の外・
 * 保存先が別のタブに開かれている）。文をひとまとめに「保存しました」で
 * 済ませると、その後もタブに未保存の印が付いたままであることの説明が
 * どこにも無くなり、利用者からは保存が失敗したように見える。
 *
 * そこで必ず2つを続けて書く。
 *
 * ```
 * 1文目   どこへ書けたか        ── 押した操作の結果そのもの
 * 2文目   このタブがどうなるか  ── 移らなかった場合だけ
 * ```
 */
export function describeSaveAsNotice(notice: EditorSaveAsNotice): string {
  if (notice.followed) {
    return `${notice.name} へ保存しました。このタブはこのファイルを編集しています。`
  }

  switch (notice.reason) {
    case 'outside-workspace':
      return (
        `${notice.name} へ保存しました（Workspace の外）。` +
        'Workspace の外のファイルは開けないため、このタブは元のファイルを指したままです。'
      )

    case 'already-open':
      return (
        `${notice.name} へ保存しました。` +
        'その場所は別のタブで開いているため、このタブは切り替えていません。'
      )

    case null:
      // 移ったはずなのに followed が false。作れない組み合わせだが、黙らない。
      return `${notice.name} へ保存しました。`
  }
}
