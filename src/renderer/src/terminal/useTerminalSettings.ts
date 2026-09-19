import { useMemo } from 'react'
import { useSettingsSection } from '../settings/useSettingsSection'
import type { TerminalFontSizeCommand } from './terminalDisplay'
import {
  createTerminalDisplaySetters,
  TERMINAL_DISPLAY_SETTINGS_BINDING,
  type TerminalDisplaySettings
} from './terminalSettings'

/**
 * Terminal の見え方（文字の大きさ・さかのぼれる行数）を持ち、ディスクと行き来する
 * （Session 3-7-5）。
 *
 * ## 置き場所は useTerminalTabs の中
 *
 * Files は器（FilesViewProvider）を別に立てているが、こちらは足していない。
 * **Terminal の持ち主（TerminalProvider）が既に Workspace Shell の外側にある**ためで、
 * Files が器を足したのは選択がパネルの中にあったからにほかならない
 * （パネルを動かすと消える。ARCHITECTURE.md §10.13）。ここに同じ器をもう1つ足すと、
 * 寿命の同じ Provider が2つ並ぶだけになる。
 *
 * 設定 UI（TerminalSettingsMenu.tsx）は Terminal パネルの中にあるが、値は
 * `TerminalContext` 経由で受け取る ── パネルは動かされるので、設定をそこに持たない。
 *
 * ```
 * terminalDisplay.ts     既定値・範囲・丸め方
 * terminalSettings.ts    保存形式との行き来
 * ここ                   見え方の正本と、変えるための入口
 * settings/useSettingsSection.ts  いつ読み、いつ書くか
 * useTerminalTabs.ts     読んだ値を画面（terminalScreenStore）へ配る
 * ```
 *
 * ## 読み書きの段取りは持たない（Session 4-3A）
 *
 * 「読み終わるまで書かない」「読めなくても既定で進む」は Editor の Auto Save・
 * Files の見え方とまったく同じ形をしていた ── 写しが3つあるということは
 * 間違え方も3通りあるということで、settings/useSettingsSection.ts へ集約した。
 * ここに残るのは**値をどう変えるか**（下の `apply`）だけになる。
 */

export interface TerminalSettingsController {
  readonly settings: TerminalDisplaySettings
  /** 打鍵（Ctrl + `+` / `-` / `0`）による増減。 */
  readonly changeFontSize: (command: TerminalFontSizeCommand) => void
  /** 設定 UI から直に指定する（上下限は clamp が掛ける）。 */
  readonly setFontSize: (fontSize: number) => void
  /** さかのぼれる行数を変える（上下限は clamp が掛ける）。 */
  readonly setScrollback: (scrollback: number) => void
}

export function useTerminalSettings(): TerminalSettingsController {
  /*
    読み込みと保存の段取りは settings/useSettingsSection.ts が持つ（Session 4-3A）。
    Editor / Files と一字一句同じだった部分で、**読み終わるまで書かない**順序も
    そちらが守る。
  */
  const { value: settings, update } = useSettingsSection(TERMINAL_DISPLAY_SETTINGS_BINDING)

  /*
    どの入口も「直前の値から次を作り、同じなら据え置く」形にする（terminalSettings.ts の
    createTerminalDisplaySetters）。Settings 画面も同じ関数を、選んでいる scope へ書く
    update で使う。
  */
  const { changeFontSize, setFontSize, setScrollback } = useMemo(
    () => createTerminalDisplaySetters(update),
    [update]
  )

  return useMemo(
    () => ({ settings, changeFontSize, setFontSize, setScrollback }),
    [settings, changeFontSize, setFontSize, setScrollback]
  )
}
