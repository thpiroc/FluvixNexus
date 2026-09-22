import { useMemo, useState } from 'react'
import type { ThemeId } from '@shared/theme'
import { useSettingsSection } from '../settings/useSettingsSection'
import {
  APPEARANCE_SETTINGS_BINDING,
  createAppearanceSetters,
  type AppearanceSettings
} from './appearanceSettings'
import { readDocumentTheme } from './documentTheme'

/**
 * Theme を持ち、ディスクと行き来する（Session 4-4）。
 *
 * **Theme の正本はここ1つ。** CSS も Monaco も xterm も、この値が変わった結果と
 * して切り替わるのであって、それぞれが Theme を覚えているわけではない
 * （二重に持たない ── ARCHITECTURE.md §15.5 と同じ線）。
 *
 * ## 読み書きの段取りは持たない
 *
 * 「読み終わるまで書かない」「読めなくても既定で進む」は
 * settings/useSettingsSection.ts が持つ（Session 4-3A で3箇所から集約したもの）。
 * `appearance` はその集約の後に足された最初の section で、**段取りを1行も
 * 書かずに済んだ**のがその集約の効き目にあたる。
 *
 * ## Main も同じ値を読むが、持ち主ではない
 *
 * 起動時、Main は `settings.json` の `appearance.theme` を読んで窓の初期色を
 * 決める（main/windows/mainWindow.ts）。**同じ保存を読んでいるだけで、状態を
 * 二重に持ってはいない** ── Main は読むだけで書かず、変わったことも知らない。
 * 正本はディスク上の1つの値と、それを載せているこの hook にほかならない。
 *
 * ## 初期値を既定にしない（起動時のちらつき）
 *
 * `useSettingsSection` の初期値は「読み込みが終わるまでの値」で、他の3つ
 * （Auto Save・Files・Terminal）はそこに**既定**を置いている。Theme でそれを
 * すると、Light を選んでいる人の起動が**必ず一度 Dark を通る。**
 *
 * ```
 * Preload が light を当てる       … CSS は最初から Light（ここまでは正しい）
 * React が最初の描画をする        … 初期値が dark なら、ここで dark を当て直す ← ちらつき
 * settings:load が返る            … light に戻る
 * ```
 *
 * そこで初期値を `<html>` から読む。**二重の正本にはならない** ── あの属性は
 * Main が同じ `settings.json` から読んで先に届けた値そのもので
 * （preload/theme.ts）、読み込みが返れば同じ値に落ち着く。ここが見ているのは
 * 「保存されている Theme を、IPC より早い経路で受け取ったもの」にほかならない。
 *
 * 属性が無い / 知らない値なら Dark（`readDocumentTheme` が落とす）── Preload が
 * 動かなかった場合も、他の3つと同じ「読めなければ既定」に戻るだけで済む。
 */

export interface AppearanceController {
  readonly settings: AppearanceSettings
  /** Theme を変える（知らない名前は既定へ落ちる）。 */
  readonly setTheme: (theme: ThemeId) => void
}

export function useAppearance(): AppearanceController {
  /*
    読み込みが返るまでの値。Preload が当てた属性から読む（このファイルの冒頭）。
    最初の描画でしか使われないので、描画のたびに読み直しても意味は変わらない。
  */
  const [initial] = useState<AppearanceSettings>(() => ({ theme: readDocumentTheme() }))

  const { value: settings, update } = useSettingsSection({
    ...APPEARANCE_SETTINGS_BINDING,
    initial
  })
  const { setTheme } = useMemo(() => createAppearanceSetters(update), [update])

  return useMemo(() => ({ settings, setTheme }), [settings, setTheme])
}
