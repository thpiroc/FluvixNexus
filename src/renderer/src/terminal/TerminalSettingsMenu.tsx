import type { JSX } from 'react'
import { useI18n } from '../i18n/context'
import { NumberField } from '../ui/NumberField'
import { Popover } from '../ui/Popover'
import {
  clampTerminalFontSize,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN
} from './terminalDisplay'
import type { TerminalDisplaySettings } from './terminalSettings'

/**
 * Terminal のタブ列から開く表示設定（Session 3-7-5 / Session 4-3B で1項目に）。
 *
 * ## Settings 画面ができた後も、ここを残す理由
 *
 * Session 4-3B でアプリ全体の Settings 画面（settings/SettingsOverlay.tsx）が入り、
 * ここにあった2項目はどちらもそちらへ並んだ。それでもこの入口を消さなかったのは、
 * **文字の大きさが「見ながら合わせるもの」**だからにほかならない ── 端末の出力を
 * 見ている最中に「あと 1px 大きく」と思うのが普通で、そのたびに画面全体を覆う
 * Settings を開くのは道具として遠い（Ctrl + `+` / `-` があるのと同じ理由）。
 *
 * 逆に**さかのぼれる行数はここから外した。** あちらは端末を見ながら決めるものでは
 * なく（変えても見た目は動かない）、一度決めたら滅多に触らない。同じ設定を変える
 * UI が2つある状態は、どちらが効いているかを利用者に確かめさせることになる。
 *
 *   ここ              … 文字の大きさ（見ながら合わせる。Settings にも同じものがある）
 *   Settings 画面      … 文字の大きさ・さかのぼれる行数
 *
 * どちらから変えても通る先は同じ setter（useTerminalSettings.ts）で、**値の正本は
 * この UI ではなく Terminal の Provider 側**にある。片方で変えればもう片方にも
 * その場で出る（二重に持っていない）。
 *
 * ## 変えられるのは1つだけ
 *
 * | 項目         | 範囲    | 変わると                       |
 * | ------------ | ------- | ------------------------------ |
 * | 文字の大きさ | 8〜32px | 全部のタブ。桁数も測り直される |
 *
 * フォントの種類と行の高さは並べない ── 等幅でないフォントを選べるようにすると
 * 画面と ConPTY の折り返しが食い違う（terminalDisplay.ts）。「＋」で開くシェルの既定も
 * ここには無い（Session 3-7-5 の範囲外。DESIGN.md）。
 *
 * ## 打ち込んでいる途中の値で端末を変えない
 *
 * 欄が下書きを持ち、**Enter か、欄から離れたとき**に確定する。その仕組みは
 * ui/NumberField.tsx が持つ（Session 4-3B で切り出した ── Settings 画面と
 * 同じ振る舞いの欄が4つになったため）。
 */

interface TerminalSettingsMenuProps {
  readonly display: TerminalDisplaySettings
  readonly onFontSizeChange: (fontSize: number) => void
}

export function TerminalSettingsMenu({
  display,
  onFontSizeChange
}: TerminalSettingsMenuProps): JSX.Element {
  const { t } = useI18n()

  return (
    <Popover
      label="⚙"
      buttonLabel={t('terminal.settings.label')}
      buttonClassName="fx-terminal-tabs__button"
      role="dialog"
      panelLabel={t('terminal.settings.label')}
      panelClassName="fx-terminal-settings"
    >
      {() => (
        <>
          <NumberField
            label={t('terminal.settings.fontSize')}
            unit="px"
            value={display.fontSize}
            min={TERMINAL_FONT_SIZE_MIN}
            max={TERMINAL_FONT_SIZE_MAX}
            step={1}
            clamp={clampTerminalFontSize}
            onCommit={onFontSizeChange}
            testId="terminal-font-size"
          />

          {/*
            さかのぼれる行数の行き先を書いておく（Session 4-3B）── ここにあったものを
            移したので、探した人が空振りしたまま終わらないようにする。
          */}
          <p className="fx-terminal-settings__note">{t('terminal.settings.note')}</p>
        </>
      )}
    </Popover>
  )
}
