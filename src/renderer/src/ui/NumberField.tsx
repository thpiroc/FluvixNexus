import { useEffect, useId, useState, type JSX } from 'react'
import './field.css'

/**
 * 数を1つ受け取る欄（Session 4-3B で Terminal の設定から切り出した）。
 *
 * ## なぜ ui/ に置くか
 *
 * Session 3-7-5 の時点では、この形をしたものは Terminal の設定 UI の中に1つしか
 * 無かった。Settings 画面（Session 4-3B）が Auto Save の待ち時間・Terminal の
 * 文字の大きさ・さかのぼれる行数の3つを並べた時点で、**同じ振る舞いの欄が
 * 4つになる**（Terminal 側にも文字の大きさが残る）。
 *
 * 写しにしなかったのは、この欄の要点が見た目ではなく**下書きを持つこと**に
 * あるためで、そこは写すたびに落としうる（下の commit を参照）。
 * Session 4-3A で読み書きの段取りを1箇所へ集めたのとまったく同じ判断になる。
 *
 * ## 打ち込んでいる途中の値で、外の世界を変えない
 *
 * 欄の中身は打っている間ずっと変わる。1文字ごとに反映すると、`1200` と打つ途中の
 * `1` が範囲へ丸められ（500 行）、**打ち終わる前に端末が作り替えられる。**
 * そこで欄は自分の下書きを持ち、**Enter か、欄から離れたとき**に確定する。
 * 確定した値は丸めた結果をそのまま欄へ書き戻す ── 効かなかった入力が
 * 欄に残ったままにならないようにするため。
 *
 * ## 丸めるのはこの欄ではない
 *
 * 渡された `clamp` を通すだけで、範囲そのものは値の意味を知っている側が持つ
 * （terminal/terminalDisplay.ts・editor/autoSave.ts）。UI と保存の読み書きが
 * **同じ関数**を通る形にしてある ── 片方だけに掛けると、掴んで変えた値は止まるのに
 * 保存ファイルを直接書けば通る、という食い違いが生まれる。
 */
export interface NumberFieldProps {
  readonly label: string
  /** 単位（px / 行 / ms）。無い値には空文字ではなく、単位の要らない語を渡すこと。 */
  readonly unit: string
  /** 今の値（正本はこの欄の外にある）。 */
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  /** 範囲へ丸める（値の意味を知っている側の関数をそのまま渡す）。 */
  readonly clamp: (value: number) => number
  readonly onCommit: (value: number) => void
  /** 範囲の案内の代わりに出す文（省略すると「min〜max unit」）。 */
  readonly hint?: string
  /** 起動確認から掴むための目印。 */
  readonly testId?: string
}

export function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step,
  clamp,
  onCommit,
  hint,
  testId
}: NumberFieldProps): JSX.Element {
  const inputId = useId()
  const [draft, setDraft] = useState(() => String(value))

  // 外で変わったとき（打鍵での増減・起動時の読み込み・別の UI からの変更）に欄も合わせる。
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
    <div className="fx-number-field">
      <label className="fx-number-field__label" htmlFor={inputId}>
        {label}
      </label>

      <div className="fx-number-field__value">
        <input
          id={inputId}
          className="fx-number-field__input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft}
          data-testid={testId}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
        <span className="fx-number-field__unit">{unit}</span>
      </div>

      <span className="fx-number-field__hint">{hint ?? `${min}〜${max}${unit}`}</span>
    </div>
  )
}
