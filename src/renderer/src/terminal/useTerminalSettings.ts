import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fluvix } from '../api/fluvix'
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
  toTerminalSettingsDocument,
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
 * ここ                   いつ読み、いつ書くか
 * useTerminalTabs.ts     読んだ値を画面（terminalScreenStore）へ配る
 * ```
 *
 * ## 読み込みが終わるまで保存を許さない
 *
 * 先に許すと、**既定値で上書きした後に読み込みが届く**（起動のたびに 13px へ戻る）。
 * Editor の Auto Save・Files の見え方とまったく同じ形で、この順序だけは崩さない。
 *
 * ## 読めなくても端末は開く
 *
 * 読み込みに失敗しても既定のまま先へ進む。設定はターミナルを使うための前提ではない
 * ── ここで止めると、壊れた JSON 1つでシェルが1本も立たなくなる。
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
  const [settings, setSettings] = useState<TerminalDisplaySettings>(
    DEFAULT_TERMINAL_DISPLAY_SETTINGS
  )

  /** 読み込みが終わったか（終わるまで書かない。このファイルの冒頭）。 */
  const loadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    void fluvix.settings.loadTerminal().then((result) => {
      if (cancelled) {
        return
      }

      if (result.ok) {
        setSettings(toTerminalDisplaySettings(result.data.document))
      } else {
        console.warn('[settings] Terminal の見え方を読み込めませんでした。', result.error)
      }

      loadedRef.current = true
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loadedRef.current) {
      return
    }

    void fluvix.settings.saveTerminal({ document: toTerminalSettingsDocument(settings) })
  }, [settings])

  /*
    どの入口も「直前の値から次を作り、同じなら据え置く」形にする。

    直前の値から作るのは、打鍵の増減がそれを要求するため（`+` は今の大きさに対する
    操作にほかならない）。同じなら据え置くのは、上限に当たっている間 Ctrl + `+` を
    押し続けたときや、設定 UI で同じ値を確定し直したときに、保存と再描画が
    走り続けないようにするため。
  */
  const apply = useCallback(
    (change: (previous: TerminalDisplaySettings) => TerminalDisplaySettings): void => {
      setSettings((previous) => {
        const next = change(previous)

        return isSameTerminalDisplaySettings(previous, next) ? previous : next
      })
    },
    []
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
