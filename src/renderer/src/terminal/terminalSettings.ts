import { TERMINAL_SETTINGS_SCHEMA_VERSION, type TerminalSettingsDocument } from '@shared/settings'
import {
  clampTerminalFontSize,
  clampTerminalScrollback,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_SCROLLBACK_DEFAULT
} from './terminalDisplay'

/**
 * Terminal の見え方の設定モデル（Session 3-7-5）。
 *
 * ## 設定と動作を分ける
 *
 * ここが持つのは「保存形式とどう行き来するか」「境界から来た値をどう読むか」だけで、
 * **いつ保存するかは持たない**（それは useTerminalSettings.ts）。
 * editor/autoSave.ts・files/filesSettings.ts とまったく同じ分担で、
 * このファイルは React も xterm も IPC も知らない（＝ Vitest でそのまま試せる）。
 *
 * ```
 * terminalDisplay.ts     既定値・範囲・丸め方
 * terminalSettings.ts    その値を、保存形式と行き来させる（ここ）
 * useTerminalSettings.ts いつ読み、いつ書くか
 * shared/settings/terminalSettings.ts  ディスクに置く形
 * main/store/terminalSettings.ts       保存先
 * ```
 *
 * ## 読めなければ既定で始める
 *
 * 保存が無い・壊れている・範囲の外（アプリのダウングレードや、ファイルを手で直した場合）は、
 * すべて既定（13px ＋ 5000 行）へ落ちる。**設定が読めないことは、端末を開けない理由に
 * ならない** ── Auto Save の「読めなければ OFF」、Files の「読めなければパネルの形に
 * 任せる」と同じ扱いにあたる。
 *
 * 項目ごとに落とすのも意図したもので、片方だけが範囲の外にあるファイルから
 * もう片方の値を捨てない（丸めるのは terminalDisplay.ts の clamp。値ごとに独立している）。
 */

export interface TerminalDisplaySettings {
  /** 文字の大きさ（px）。全部のタブで同じ（terminalScreenStore.ts）。 */
  readonly fontSize: number
  /** さかのぼれる行数。全部のタブで同じ。 */
  readonly scrollback: number
}

/** 既定。保存が無い / 読めないときはここから始まる。 */
export const DEFAULT_TERMINAL_DISPLAY_SETTINGS: TerminalDisplaySettings = {
  fontSize: TERMINAL_FONT_SIZE_DEFAULT,
  scrollback: TERMINAL_SCROLLBACK_DEFAULT
}

/* ------------------------------------------------------ 保存形式との変換 */

/**
 * 保存された文書から、実行時の設定へ。
 *
 * 文書として読めるかは Main が確かめており（store/terminalSettingsDocument.ts）、
 * ここが見るのは**値として扱ってよい範囲か**だけ。分担は Editor 設定（§12.4）・
 * Files 設定（§10.14）と同じ。
 */
export function toTerminalDisplaySettings(
  document: TerminalSettingsDocument | null
): TerminalDisplaySettings {
  const display = document?.display

  if (display === undefined) {
    return DEFAULT_TERMINAL_DISPLAY_SETTINGS
  }

  return {
    fontSize: clampTerminalFontSize(display.fontSize),
    scrollback: clampTerminalScrollback(display.scrollback)
  }
}

/**
 * 実行時の設定から、保存する文書へ。
 *
 * 保存形式を別の型にしてある理由は shared/settings/terminalSettings.ts。
 * 変換をこの1箇所に置いておくと、実行時モデルを変えたときに
 * 直すべき場所が必ずここに現れる。
 *
 * 書く前にも丸めるのは、**範囲の外の値をディスクへ残さない**ため
 * （読むときだけ丸めると、次に読む側が必ずいることを当てにすることになる）。
 */
export function toTerminalSettingsDocument(
  settings: TerminalDisplaySettings
): TerminalSettingsDocument {
  return {
    schemaVersion: TERMINAL_SETTINGS_SCHEMA_VERSION,
    display: {
      fontSize: clampTerminalFontSize(settings.fontSize),
      scrollback: clampTerminalScrollback(settings.scrollback)
    }
  }
}

/** 同じ設定か（保存を予約するかどうかの判断）。 */
export function isSameTerminalDisplaySettings(
  a: TerminalDisplaySettings,
  b: TerminalDisplaySettings
): boolean {
  return a.fontSize === b.fontSize && a.scrollback === b.scrollback
}
