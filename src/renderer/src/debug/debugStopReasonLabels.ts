import type { DebugExceptionBreakMode, DebugStopReason } from '@shared/debug'
import type { TranslationKey } from '../i18n/locales/types'

/**
 * 停止理由 → 画面の言葉（Session 6-13。純粋・テスト対象）。
 *
 * Main から届くのは閉じた集合の1語だけで、表示する文字は Renderer がここで翻訳キーを選んで作る
 * ── **adapter が送ってきた `reason` の文字列を描く経路は無い**（debugStatusLabels.ts と同じ形）。
 *
 * `stopped` の言い回しは Session 6-9 の決めに揃え、「Stopped / 停止中」を使わない
 * （idle と取り違える）。どれも「Paused … / …一時停止中」と書く。
 */

export const DEBUG_STOP_REASON_MESSAGE_KEYS: Readonly<Record<DebugStopReason, TranslationKey>> = {
  breakpoint: 'debug.stopReason.breakpoint',
  step: 'debug.stopReason.step',
  pause: 'debug.stopReason.pause',
  entry: 'debug.stopReason.entry',
  exception: 'debug.stopReason.exception',
  unknown: 'debug.stopReason.unknown'
}

/**
 * 例外で止まった条件の言葉。`never`（止まらない設定）で止まることは無く、読めなかった
 * adapter と同じく何も出さない。
 */
export function debugExceptionBreakModeMessageKey(
  mode: DebugExceptionBreakMode | null
): TranslationKey | null {
  switch (mode) {
    case 'unhandled':
      return 'debug.stopReason.breakModeUnhandled'
    case 'userUnhandled':
      return 'debug.stopReason.breakModeUserUnhandled'
    case 'always':
      return 'debug.stopReason.breakModeAlways'
    case 'never':
    case null:
      return null
  }
}
