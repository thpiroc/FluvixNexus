import { useEffect, useState, type JSX } from 'react'
import type { UpdateStatusKind, UpdateStatusSnapshot } from '@shared/updates'
import { describeIpcError } from '../api/result'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'

export function UpdateSettingsControl(): JSX.Element {
  const { t } = useI18n()
  const [status, setStatus] = useState<UpdateStatusSnapshot | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    void fluvix.updates.getStatus().then((result) => {
      if (!alive) {
        return
      }

      if (result.ok) {
        setStatus(result.data)
        setOperationError(null)
      } else {
        setOperationError(describeIpcError(result.error, t))
      }
    })

    const unsubscribe = fluvix.updates.onStatusChanged((next) => {
      setStatus(next)
      setOperationError(null)
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [t])

  async function runOperation(operation: 'check' | 'download' | 'install'): Promise<void> {
    setOperationError(null)

    if (operation === 'install') {
      const result = await fluvix.updates.install()

      if (!result.ok) {
        setOperationError(describeIpcError(result.error, t))
      }

      return
    }

    const result =
      operation === 'check' ? await fluvix.updates.check() : await fluvix.updates.download()

    if (result.ok) {
      setStatus(result.data)
      return
    }

    setOperationError(describeIpcError(result.error, t))
  }

  if (status === null) {
    return (
      <div className="fx-updates" data-testid="settings-updates">
        <span className="fx-updates__state">{t('updates.status.loading')}</span>
      </div>
    )
  }

  const busy = status.status === 'checking' || status.status === 'downloading'
  const canDownload = status.status === 'available'
  const canInstall = status.status === 'downloaded'
  const message = operationError ?? status.message

  return (
    <div className="fx-updates" data-testid="settings-updates">
      <div className="fx-updates__summary" aria-live="polite">
        <span className="fx-updates__version">
          {t('updates.currentVersion', { version: status.currentVersion })}
        </span>
        <span className="fx-updates__state">{t(updateStatusLabelKey(status.status))}</span>
        {status.updateVersion !== null && (
          <span className="fx-updates__target">
            {t('updates.availableVersion', { version: status.updateVersion })}
          </span>
        )}
      </div>

      {status.progress !== null && (
        <div className="fx-updates__progress">
          <div
            className="fx-updates__progress-bar"
            style={{ width: `${status.progress.percent}%` }}
          />
          <span className="fx-updates__progress-label">
            {t('updates.progress', {
              percent: Math.round(status.progress.percent),
              transferred: formatBytes(status.progress.transferred),
              total: formatBytes(status.progress.total)
            })}
          </span>
        </div>
      )}

      {message !== null && <p className="fx-updates__message">{message}</p>}

      <div className="fx-updates__actions">
        <button
          type="button"
          className="fx-updates__button"
          data-testid="settings-updates-check"
          disabled={busy}
          onClick={() => void runOperation('check')}
        >
          {t('updates.actions.check')}
        </button>
        {canDownload && (
          <button
            type="button"
            className="fx-updates__button"
            data-testid="settings-updates-download"
            onClick={() => void runOperation('download')}
          >
            {t('updates.actions.download')}
          </button>
        )}
        {canInstall && (
          <button
            type="button"
            className="fx-updates__button fx-updates__button--primary"
            data-testid="settings-updates-install"
            onClick={() => void runOperation('install')}
          >
            {t('updates.actions.install')}
          </button>
        )}
      </div>

      <span className="fx-updates__source">
        {t('updates.source', {
          owner: status.source.owner,
          repo: status.source.repo
        })}
      </span>
    </div>
  )
}

function updateStatusLabelKey(status: UpdateStatusKind): TranslationKey {
  return `updates.status.${status}`
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB'] as const
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
