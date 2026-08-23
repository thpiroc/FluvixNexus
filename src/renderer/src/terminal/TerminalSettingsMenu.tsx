import { useEffect, useId, useState, type JSX } from 'react'
import { Popover } from '../ui/Popover'
import {
  clampTerminalFontSize,
  clampTerminalScrollback,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN
} from './terminalDisplay'
import type { TerminalDisplaySettings } from './terminalSettings'

/**
 * Terminal の表示設定（Session 3-7-5）。
 *
 * ## Terminal の設定であって、アプリの設定画面ではない
 *
 * DESIGN.md §9 の Settings 画面（アプリ全体）はまだ作らない。ここに置いたのは
 * **Terminal の見え方だけ**で、入口も Terminal のタブ列の中にある。
 *
 * 全体の設定画面を先に作らないのは、今そこへ並べられるものが Terminal の2項目しか
 * 無いためにほかならない。項目が2つしか無い画面は「まだ何も無い場所」を作るだけで、
 * その後に足す設定の置き場所を先に決めてしまうことになる。逆に、ここに置いた2つは
 * 全体の設定画面ができたときにそのまま移せる ── **値の持ち主はこの UI ではなく
 * Terminal の Provider 側**（useTerminalSettings.ts）で、ここは読み書きの窓口でしかない。
 *
 * ## 変えられるのは2つだけ
 *
 * | 項目               | 範囲              | 変わると                             |
 * | ------------------ | ----------------- | ------------------------------------ |
 * | 文字の大きさ       | 8〜32px           | 全部のタブ。桁数も測り直される       |
 * | さかのぼれる行数   | 500〜50000 行     | 全部のタブ。減らすと古い行は捨てられる |
 *
 * フォントの種類と行の高さは並べない ── 等幅でないフォントを選べるようにすると
 * 画面と ConPTY の折り返しが食い違う（terminalDisplay.ts）。「＋」で開くシェルの既定も
 * ここには無い（Session 3-7-5 の範囲外。DESIGN.md）。
 *
 * ## 打ち込んでいる途中の値で端末を変えない
 *
 * 欄の中身は打っている間ずっと変わる。1文字ごとに反映すると、`1200` と打つ途中の
 * `1` が範囲へ丸められ（500 行）、**打ち終わる前に画面が作り替えられる。**
 * そこで欄は自分の下書きを持ち、**Enter か、欄から離れたとき**に確定する。
 * 確定した値は丸めた結果をそのまま欄へ書き戻す ── 効かなかった入力が
 * 欄に残ったままにならないようにするため。
 */

interface TerminalSettingsMenuProps {
  readonly display: TerminalDisplaySettings
  readonly onFontSizeChange: (fontSize: number) => void
  readonly onScrollbackChange: (scrollback: number) => void
}

export function TerminalSettingsMenu({
  display,
  onFontSizeChange,
  onScrollbackChange
}: TerminalSettingsMenuProps): JSX.Element {
  return (
    <Popover
      label="⚙"
      buttonLabel="ターミナルの設定"
      buttonClassName="fx-terminal-tabs__button"
      role="dialog"
      panelLabel="ターミナルの設定"
      panelClassName="fx-terminal-settings"
    >
      {() => (
        <>
          <NumberField
            label="文字の大きさ"
            unit="px"
            value={display.fontSize}
            min={TERMINAL_FONT_SIZE_MIN}
            max={TERMINAL_FONT_SIZE_MAX}
            step={1}
            clamp={clampTerminalFontSize}
            onCommit={onFontSizeChange}
          />

          <NumberField
            label="さかのぼれる行数"
            unit="行"
            value={display.scrollback}
            min={TERMINAL_SCROLLBACK_MIN}
            max={TERMINAL_SCROLLBACK_MAX}
            step={500}
            clamp={clampTerminalScrollback}
            onCommit={onScrollbackChange}
          />

          {/*
            行数を減らすと、溢れた行はその場で捨てられる（xtermSetup.ts）。
            遡れる量を自分で減らしたのだから起きること自体は筋が通っているが、
            **黙って消える**のは別の話なので、選ぶ前に読める場所へ書いておく。
          */}
          <p className="fx-terminal-settings__note">
            Enter
            か、欄から離れたときに反映されます。行数を減らすと、そのぶん古い出力は捨てられます。
            設定はアプリを開き直しても残ります。
          </p>
        </>
      )}
    </Popover>
  )
}

interface NumberFieldProps {
  readonly label: string
  readonly unit: string
  /** 今の値（正本は Provider 側）。 */
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  /** 範囲へ丸める（terminalDisplay.ts の関数をそのまま渡す）。 */
  readonly clamp: (value: number) => number
  readonly onCommit: (value: number) => void
}

/**
 * 数を1つ受け取る欄。
 *
 * 下書きを持つ理由はこのファイルの冒頭。**丸めるのはこの欄ではない** ──
 * 渡された `clamp` を通すだけで、範囲そのものは terminalDisplay.ts が持っている
 * （UI と保存の読み書きが同じ関数を通る形にしてある）。
 */
function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step,
  clamp,
  onCommit
}: NumberFieldProps): JSX.Element {
  const inputId = useId()
  const [draft, setDraft] = useState(() => String(value))

  // 外で変わったとき（打鍵での増減・起動時の読み込み）に欄も合わせる。
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const parsed = Number(draft.trim())

    /*
      空欄や、数として読めないもの。**既定へ落とさず、今の値へ戻す** ──
      打ち間違いで設定が既定に化けるより、何も起きない方が分かりやすい。
    */
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }

    const next = clamp(parsed)

    // 丸めた結果を欄へ書き戻す（効かなかった入力を残さない）。
    setDraft(String(next))
    onCommit(next)
  }

  return (
    <div className="fx-terminal-settings__field">
      <label className="fx-terminal-settings__label" htmlFor={inputId}>
        {label}
      </label>

      <div className="fx-terminal-settings__value">
        <input
          id={inputId}
          className="fx-terminal-settings__input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
        <span className="fx-terminal-settings__unit">{unit}</span>
      </div>

      <span className="fx-terminal-settings__hint">
        {min}〜{max}
        {unit}
      </span>
    </div>
  )
}
