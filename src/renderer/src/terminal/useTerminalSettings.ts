import { useCallback, useMemo } from 'react'
import { useSettingsSection } from '../settings/useSettingsSection'
import {
  clampTerminalFontSize,
  clampTerminalScrollback,
  nextTerminalFontSize,
  type TerminalFontSizeCommand
} from './terminalDisplay'
import {
  DEFAULT_TERMINAL_DISPLAY_SETTINGS,
  isSameTerminalDisplaySettings,
  toTerminalDisplaySettings,
  toTerminalSettingsSection,
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
  const { value: settings, update } = useSettingsSection({
    section: 'terminal',
    initial: DEFAULT_TERMINAL_DISPLAY_SETTINGS,
    fromStored: toTerminalDisplaySettings,
    toStored: toTerminalSettingsSection,
    label: 'Terminal の見え方'
  })

  /*
    どの入口も「直前の値から次を作り、同じなら据え置く」形にする。

    直前の値から作るのは、打鍵の増減がそれを要求するため（`+` は今の大きさに対する
    操作にほかならない）。同じなら据え置くのは、上限に当たっている間 Ctrl + `+` を
    押し続けたときや、設定 UI で同じ値を確定し直したときに、保存と再描画が
    走り続けないようにするため。
  */
  const apply = useCallback(
    (change: (previous: TerminalDisplaySettings) => TerminalDisplaySettings): void => {
      update((previous) => {
        const next = change(previous)

        return isSameTerminalDisplaySettings(previous, next) ? previous : next
      })
    },
    [update]
  )

  const changeFontSize = useCallback(
    (command: TerminalFontSizeCommand): void => {
      apply((previous) => ({
        ...previous,
        fontSize: nextTerminalFontSize(previous.fontSize, command)
      }))
    },
    [apply]
  )

  /* 丸めと上下限は terminalDisplay.ts が持つ（設定 UI も打鍵も同じ関数を通る）。 */
  const setFontSize = useCallback(
    (fontSize: number): void => {
      apply((previous) => ({ ...previous, fontSize: clampTerminalFontSize(fontSize) }))
    },
    [apply]
  )

  const setScrollback = useCallback(
    (scrollback: number): void => {
      apply((previous) => ({ ...previous, scrollback: clampTerminalScrollback(scrollback) }))
    },
    [apply]
  )

  return useMemo(
    () => ({ settings, changeFontSize, setFontSize, setScrollback }),
    [settings, changeFontSize, setFontSize, setScrollback]
  )
}
