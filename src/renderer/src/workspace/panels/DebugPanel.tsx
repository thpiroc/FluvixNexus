import type { JSX } from 'react'
import { CallStackView } from '../../debug/CallStackView'
import { useI18n } from '../../i18n/context'

export function DebugPanel(): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="fx-debug-panel">
      <div className="fx-debug-panel__header">{t('debug.callStack.title')}</div>
      <CallStackView />
    </div>
  )
}
