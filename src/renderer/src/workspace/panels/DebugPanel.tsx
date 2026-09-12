import type { JSX } from 'react'
import { CallStackView } from '../../debug/CallStackView'
import { EvaluateView } from '../../debug/EvaluateView'
import { VariablesView } from '../../debug/VariablesView'
import { useI18n } from '../../i18n/context'

export function DebugPanel(): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="fx-debug-panel">
      <div className="fx-debug-panel__header">{t('debug.callStack.title')}</div>
      <CallStackView />
      {/* Variables（Session 6-6）。Call Stack で選んだ frame を読む。 */}
      <div className="fx-debug-panel__header fx-debug-panel__header--section">
        {t('debug.variables.title')}
      </div>
      <VariablesView />
      {/* Evaluate（Session 6-7）。同じ frame の文脈で式を1つ評価する。 */}
      <div className="fx-debug-panel__header fx-debug-panel__header--section">
        {t('debug.evaluate.title')}
      </div>
      <EvaluateView />
    </div>
  )
}
