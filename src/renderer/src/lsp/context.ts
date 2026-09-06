import { createContext, useContext } from 'react'
import type { LanguageServerId, LanguageServerPreferences } from '@shared/lsp'

/**
 * Language Server を使うかどうかを、Renderer 全体へ配る仕組み（Session 5-4）。
 *
 * Context の定義と Provider を別ファイルにしてあるのは、Vite の Fast Refresh が
 * コンポーネント以外の export を含むファイルを扱えないため
 * （Theme / Editor / Terminal の context.ts と同じ形）。
 *
 * ## Renderer 側のこの値は「画面の表示」にしか効かない
 *
 * サーバを立てる / 終わらせるのは Main の側で、Main は**自分で同じ設定を読む**
 * （main/lsp/languageServerSettings.ts）。ここが持っているのは
 * Settings 画面のつまみが今どこを向いているか、それだけになる。
 *
 * 実際に何が動いているかは別の経路で届く（`lsp:status-changed` ──
 * renderer/src/lsp/useLanguageServerStatus.ts）。**2つを混ぜない**のが要点で、
 * 「有効にしてある」と「立っている」は別のことにほかならない
 * ── 有効にしても入っていなければ立たないし、立たなくても Editor は使える。
 */

export interface LanguageServerSettingsController {
  readonly preferences: LanguageServerPreferences
  /** 全体の有効 / 無効を切り替える。 */
  readonly setEnabled: (enabled: boolean) => void
  /** 言語ごとの有効 / 無効を切り替える。 */
  readonly setServerEnabled: (id: LanguageServerId, enabled: boolean) => void
}

export const LspSettingsContext = createContext<LanguageServerSettingsController | null>(null)

/**
 * Language Server の設定を読み書きする。
 *
 * 器が無い場所（Provider の外）で呼ばれたら落とす。黙って既定値を返すと、
 * 「切り替えたのに次の描画で戻る」という形で表に出ることになり、原因が追いにくい。
 */
export function useLspSettings(): LanguageServerSettingsController {
  const controller = useContext(LspSettingsContext)

  if (controller === null) {
    throw new Error('useLspSettings must be used inside an LspSettingsProvider.')
  }

  return controller
}
