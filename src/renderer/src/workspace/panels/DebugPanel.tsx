import type { JSX } from 'react'
import { CallStackView } from '../../debug/CallStackView'
import { DebugConsoleView } from '../../debug/DebugConsoleView'
import { DebugStopReasonView } from '../../debug/DebugStopReasonView'
import { DebugToolbar } from '../../debug/DebugToolbar'
import { VariablesView } from '../../debug/VariablesView'
import { useI18n } from '../../i18n/context'

export function DebugPanel(): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="fx-debug-panel">
      <DebugToolbar />
      {/* なぜ止まったか（Session 6-13）。止まっていなければ何も出ない。 */}
      <DebugStopReasonView />
      <div className="fx-debug-panel__header">{t('debug.callStack.title')}</div>
      <CallStackView />
      {/* Variables（Session 6-6）。Call Stack で選んだ frame を読む。 */}
      <div className="fx-debug-panel__header fx-debug-panel__header--section">
        {t('debug.variables.title')}
      </div>
      <VariablesView />
      {/* Debug Console（Session 6-8）。Evaluate と DAP output を同じ面に出す。 */}
      <div className="fx-debug-panel__header fx-debug-panel__header--section">
        {t('debug.console.title')}
      </div>
      <DebugConsoleView />
    </div>
  )
}
