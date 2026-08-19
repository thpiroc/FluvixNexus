import { createContext, useContext } from 'react'
import type { UnsavedActionKind, UnsavedSource } from './types'

/**
 * 未保存の確認を Renderer 全体へ配る仕組み。
 *
 * Provider は **App.tsx の一番外**に置く。中に置くと、
 * WorkspaceFolderProvider（Workspace を閉じる側）と EditorProvider（未保存を持つ側）の
 * 両方から参照できない（片方が必ず外になる）。
 *
 * Provider は UnsavedChangesProvider.tsx。この形（Context の定義と Provider の分離）は、
 * Vite の Fast Refresh がコンポーネント以外の export を含むファイルを扱えないため
 * （editor/context.ts と同じ）。
 */

export interface UnsavedChangesController {
  /**
   * 未保存の内容を持っていることを申告する。
   *
   * 戻り値は取り消しの関数（useEffect からそのまま返せる形）。
   */
  readonly registerSource: (source: UnsavedSource) => () => void
  /**
   * この操作を続けてよいか、必要なら利用者に尋ねる。
   *
   * 未保存が1つも無ければ**尋ねずに true**。確認を出すこと自体が目的ではなく、
   * 失われるものがあるときだけ止めるのが目的なので、
   * 「毎回出るダイアログ」にはしない。
   */
  readonly confirmDiscard: (kind: UnsavedActionKind) => Promise<boolean>
}

export const UnsavedChangesContext = createContext<UnsavedChangesController | null>(null)

/**
 * 未保存の確認を参照する。
 *
 * Provider の外で呼ばれた場合は例外にする（useEditorContext と同じ理由。
 * 黙って通すと、確認を挟んだつもりの経路が黙って素通りする）。
 */
export function useUnsavedChanges(): UnsavedChangesController {
  const controller = useContext(UnsavedChangesContext)

  if (controller === null) {
    throw new Error('useUnsavedChanges must be used inside <UnsavedChangesProvider>.')
  }

  return controller
}
