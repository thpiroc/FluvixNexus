import type { IpcErrorPayload } from '@shared/ipc'
import { describeIpcError } from '../api/result'
import type { TFunction } from '../i18n/messages'

/**
 * Editor の失敗を、**文言ではなく中身のまま**持つための型（Session 4-5B）。
 *
 * files/filesError.ts が Files に対して担っているのと同じ立ち位置。
 * 状態（EditorSaveState / EditorDiskContent。useEditorSession.ts）へ
 * 翻訳済みの文字列を入れてしまうと、**エラーを出したまま言語を切り替えたときに
 * 前の言語のまま取り残される** ── 保存の失敗も食い違いの帯も、出したあと
 * しばらく画面に残るものなので、言い表すのは描くときにする。
 *
 * IPC 由来の失敗は共通の対応表（api/result.ts）に任せ、
 * ここが持つのは **Renderer 側でしか起きない失敗**の区別だけになる。
 */
export type EditorFailure =
  /** Main から返った失敗。文言は共通の対応表が決める。 */
  | { readonly kind: 'ipc'; readonly error: IpcErrorPayload }
  /** 要求と応答の間に Workspace が切り替わった（結果は今の話ではない）。 */
  | { readonly kind: 'workspace-changed' }
  /** 読めたが、テキストとして扱えなかった。 */
  | { readonly kind: 'not-text' }
  /** 書き出そうとしたタブが既に閉じられていた。 */
  | { readonly kind: 'tab-gone' }
  /** 書き出せる中身が無い（まだ読み込めていない）。 */
  | { readonly kind: 'no-writable-content' }

export function describeEditorFailure(failure: EditorFailure, t: TFunction): string {
  switch (failure.kind) {
    case 'ipc':
      return describeIpcError(failure.error, t)

    case 'workspace-changed':
      return t('editor.error.workspaceChanged')

    case 'not-text':
      return t('editor.error.notText')

    case 'tab-gone':
      return t('editor.error.tabGone')

    case 'no-writable-content':
      return t('editor.error.noWritableContent')
  }
}
