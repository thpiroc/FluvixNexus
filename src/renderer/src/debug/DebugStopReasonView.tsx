import type { JSX } from 'react'
import { useI18n } from '../i18n/context'
import { useCallStack } from './callStackContext'
import {
  DEBUG_STOP_REASON_MESSAGE_KEYS,
  debugExceptionBreakModeMessageKey
} from './debugStopReasonLabels'

/**
 * なぜ止まったか（Session 6-13）。Debug パネルの Toolbar の下に出す。
 *
 * 止まっていなければ何も描かない。読むのは Call Stack snapshot の `stop` だけで、
 * 例外なら型名とメッセージ（Main がパスを伏せた1行）を添える。**スタックトレースは出さない**
 * ── 場所は Call Stack と Editor の印が示し、全文は Debug Console に流れている。
 */
export function DebugStopReasonView(): JSX.Element | null {
  const { snapshot } = useCallStack()
  const { t } = useI18n()
  const stop = snapshot.stop

  if (snapshot.status === 'idle' || stop === null) {
    return null
  }

  const exception = stop.reason === 'exception' ? stop.exception : null
  const modeKey = debugExceptionBreakModeMessageKey(exception?.breakMode ?? null)
  const hasDetails =
    exception !== null && (exception.typeName !== null || exception.message !== null)

  return (
    <section
      className="fx-debug-stop-reason"
      role="status"
      aria-label={t('debug.stopReason.aria')}
      data-reason={stop.reason}
    >
      <p className="fx-debug-stop-reason__title">
        {t(DEBUG_STOP_REASON_MESSAGE_KEYS[stop.reason])}
      </p>
      {stop.reason === 'exception' &&
        (hasDetails ? (
          <p className="fx-debug-stop-reason__exception">
            {exception.typeName !== null && (
              <span className="fx-debug-stop-reason__type">{exception.typeName}</span>
            )}
            {exception.message !== null && (
              <span className="fx-debug-stop-reason__message" title={exception.message}>
                {exception.message}
              </span>
            )}
            {modeKey !== null && <span className="fx-debug-stop-reason__mode">{t(modeKey)}</span>}
          </p>
        ) : (
          <p className="fx-debug-stop-reason__notice">{t('debug.stopReason.noExceptionDetails')}</p>
        ))}
    </section>
  )
}
