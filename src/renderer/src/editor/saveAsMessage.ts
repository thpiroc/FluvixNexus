import type { TFunction } from '../i18n/messages'
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
export function describeSaveAsNotice(notice: EditorSaveAsNotice, t: TFunction): string {
  if (notice.followed) {
    return t('editor.saveAs.followed', { name: notice.name })
  }

  switch (notice.reason) {
    case 'outside-workspace':
      return t('editor.saveAs.outsideWorkspace', { name: notice.name })

    case 'already-open':
      return t('editor.saveAs.alreadyOpen', { name: notice.name })

    case null:
      // 移ったはずなのに followed が false。作れない組み合わせだが、黙らない。
      return t('editor.saveAs.saved', { name: notice.name })
  }
}
