import type { JSX } from 'react'
import { CallStackView } from '../../debug/CallStackView'
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
    </div>
  )
}
