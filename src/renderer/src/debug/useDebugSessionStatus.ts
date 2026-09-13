import { useEffect, useState } from 'react'
import { isDebugSessionStatus, type DebugSessionStatus } from '@shared/debug'
import { fluvix } from '../api/fluvix'

/**
 * Debug が今どうなっているかを読む（Session 6-9）。
 *
 * ```
 * main/debug/sessionStatus.ts
 *    ↓  debug:get-status（最初の1回）/ debug:status-changed（変わったとき）
 * window.fluvix.debug      Preload の薄いラッパ
 *    ↓
 * ここ                      届いた1語をそのまま持つ
 *    ↓
 * DebugStatusItem          ステータスバーに1つ出す
 * ```
 *
 * lsp/useLanguageServerStatus.ts と同じ形で、**読むだけ**。このフックから
 * セッションを起こす / 止める経路は無い。
 *
 * ## 読めるまでは null
 *
 * 既定を `idle` にすると、adapter が無い PC で「Idle → Unavailable」と一瞬
 * 書き換わる。読めていないことは「何も出さない」で表す（Workspace の場所が
 * 読み込み中に空になるのと同じ）。
 *
 * ## 知らない語は受け取らない
 *
 * 閉じた集合の外の値（新しい版の Main / 壊れた payload）は捨てる ──
 * 翻訳キーへそのまま差し込むと、キーの文字列が画面に出る。
 *
 * ## 実行制御の応答に載る `state` は見ない
 *
 * `debug:continue` などの応答（`DebugControlOutcome.state`）にも状態は載るが、
 * ここはそれを使わない。状態の入口を2つにすると、どちらが新しいかを
 * Renderer が突き合わせることになる ── Main の状態が変われば必ずこの通知が届くので、
 * 通知だけを正本にすれば足りる。
 */
export function useDebugSessionStatus(): DebugSessionStatus | null {
  const [status, setStatus] = useState<DebugSessionStatus | null>(null)

  useEffect(() => {
    let cancelled = false

    // 購読を先に張る（読んでいる最中に起きた変化を取りこぼさない）。
    const unsubscribe = fluvix.debug.onStatusChanged((event) => {
      if (isDebugSessionStatus(event?.status)) {
        setStatus(event.status)
      }
    })

    void fluvix.debug.getStatus().then((result) => {
      if (cancelled || !result.ok || !isDebugSessionStatus(result.data?.status)) {
        return
      }

      const loaded = result.data.status

      // 読んでいる間に通知が届いていれば、そちらが新しい。
      setStatus((previous) => previous ?? loaded)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return status
}
