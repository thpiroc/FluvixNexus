import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import {
  formatDiagnosticsBytes,
  formatDiagnosticsDuration,
  formatDiagnosticsReportText,
  type DiagnosticsErrorRecord,
  type DiagnosticsReport
} from '@shared/diagnostics'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'

/**
 * 診断情報（Settings の1カテゴリ。`settingsCatalog.ts` の `kind: 'diagnostics'`）。
 *
 * ## 並べるだけ
 *
 * 中身は Main が作って伏せたもの（main/diagnostics/）で、ここは**受け取って並べるだけ**。
 * 自分で値を足したり、伏せ直したりしない ── 伏せる判断を Main の1箇所に保つため。
 *
 * ## コピーは Main が書く
 *
 * 「診断情報をコピー」は `diagnostics:copy-report` を呼ぶだけで、Main が診断情報を
 * 作り直してクリップボードへ書く（shared/ipc/contracts/diagnostics.ts）。コピーされる
 * 文字列は「コピーされる内容」を開くとそのまま見える ── 利用者が**何を渡すのかを
 * 渡す前に確かめられる**ことが要点。
 *
 * ## 開くたびに取り直す
 *
 * 保存しない。state は届いた診断情報と、ボタンを押した結果の一言だけ。
 */
export function DiagnosticsView(): JSX.Element {
  const { t } = useI18n()
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; key: TranslationKey } | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await fluvix.diagnostics.getReport()

      if (!mounted.current) {
        return
      }

      if (result.ok) {
        setReport(result.data)
        setLoadState('ready')
      } else {
        setLoadState('failed')
      }
    } catch {
      if (mounted.current) {
        setLoadState('failed')
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copy = async (): Promise<void> => {
    let ok = false

    try {
      ok = (await fluvix.diagnostics.copyReport()).ok
    } catch {
      ok = false
    }

    if (mounted.current) {
      setNotice(
        ok
          ? { tone: 'ok', key: 'settings.diagnostics.copied' }
          : { tone: 'error', key: 'settings.diagnostics.copyFailed' }
      )
    }
  }

  const clearErrors = async (): Promise<void> => {
    let ok = false

    try {
      ok = (await fluvix.diagnostics.clearErrors()).ok
    } catch {
      ok = false
    }

    if (!mounted.current) {
      return
    }

    setNotice(
      ok
        ? { tone: 'ok', key: 'settings.diagnostics.cleared' }
        : { tone: 'error', key: 'settings.diagnostics.clearFailed' }
    )
    await load()
  }

  const refresh = (): void => {
    setNotice(null)
    void load()
  }

  return (
    <div className="fx-diagnostics" data-testid="settings-diagnostics">
      <div className="fx-diagnostics__toolbar">
        <button
          type="button"
          className="fx-diagnostics__button fx-diagnostics__button--primary"
          data-testid="settings-diagnostics-copy"
          disabled={loadState !== 'ready'}
          onClick={() => void copy()}
        >
          {t('settings.diagnostics.copy')}
        </button>
        <button
          type="button"
          className="fx-diagnostics__button"
          data-testid="settings-diagnostics-refresh"
          onClick={refresh}
        >
          {t('settings.diagnostics.refresh')}
        </button>
        {notice !== null && (
          <span
            className="fx-diagnostics__notice"
            data-testid="settings-diagnostics-notice"
            data-tone={notice.tone}
            role="status"
          >
            {t(notice.key)}
          </span>
        )}
      </div>

      <p className="fx-diagnostics__note">{t('settings.diagnostics.privacyNote')}</p>

      {loadState === 'loading' && report === null && (
        <p className="fx-diagnostics__note" data-testid="settings-diagnostics-loading">
          {t('settings.diagnostics.loading')}
        </p>
      )}

      {loadState === 'failed' && (
        <p className="fx-diagnostics__error" data-testid="settings-diagnostics-failed">
          {t('settings.diagnostics.loadFailed')}
        </p>
      )}

      {report !== null && <DiagnosticsReportView report={report} onClearErrors={clearErrors} />}
    </div>
  )
}

function DiagnosticsReportView({
  report,
  onClearErrors
}: {
  readonly report: DiagnosticsReport
  readonly onClearErrors: () => Promise<void>
}): JSX.Element {
  const { t } = useI18n()
  const { app, runtime, system, memory, state } = report
  const unknown = t('settings.diagnostics.values.unknown')
  const yesNo = (value: boolean): string =>
    t(value ? 'settings.diagnostics.values.yes' : 'settings.diagnostics.values.no')

  return (
    <>
      <DiagnosticsSection titleKey="settings.diagnostics.sections.app" testId="app">
        <Field
          labelKey="settings.diagnostics.fields.version"
          value={`${app.name} ${app.version}`}
        />
        <Field
          labelKey="settings.diagnostics.fields.build"
          value={t(
            app.isPackaged
              ? 'settings.diagnostics.values.installed'
              : 'settings.diagnostics.values.development'
          )}
        />
        <Field labelKey="settings.diagnostics.fields.locale" value={app.locale || unknown} />
        <Field
          labelKey="settings.diagnostics.fields.uptime"
          value={formatDiagnosticsDuration(app.uptimeSeconds)}
        />
      </DiagnosticsSection>

      <DiagnosticsSection titleKey="settings.diagnostics.sections.system" testId="system">
        <Field labelKey="settings.diagnostics.fields.os" value={system.osName || system.platform} />
        <Field
          labelKey="settings.diagnostics.fields.osVersion"
          value={`${system.platform} ${system.osRelease}`.trim()}
        />
        <Field labelKey="settings.diagnostics.fields.arch" value={system.arch || unknown} />
        <Field
          labelKey="settings.diagnostics.fields.cpu"
          value={`${system.cpuModel || unknown} (${system.cpuCount})`}
        />
        <Field
          labelKey="settings.diagnostics.fields.memory"
          value={t('settings.diagnostics.values.memory', {
            total: formatDiagnosticsBytes(system.totalMemoryBytes),
            free: formatDiagnosticsBytes(system.freeMemoryBytes)
          })}
        />
      </DiagnosticsSection>

      <DiagnosticsSection titleKey="settings.diagnostics.sections.runtime" testId="runtime">
        <Field
          labelKey="settings.diagnostics.fields.electron"
          value={runtime.electron || unknown}
        />
        <Field labelKey="settings.diagnostics.fields.chrome" value={runtime.chrome || unknown} />
        <Field labelKey="settings.diagnostics.fields.node" value={runtime.node || unknown} />
        <Field labelKey="settings.diagnostics.fields.v8" value={runtime.v8 || unknown} />
      </DiagnosticsSection>

      <DiagnosticsSection titleKey="settings.diagnostics.sections.state" testId="state">
        <Field
          labelKey="settings.diagnostics.fields.mainProcess"
          value={formatDiagnosticsBytes(memory.mainProcessBytes)}
        />
        <Field
          labelKey="settings.diagnostics.fields.allProcesses"
          value={
            memory.allProcessesBytes === null
              ? unknown
              : `${formatDiagnosticsBytes(memory.allProcessesBytes)} (${memory.processCount ?? '?'})`
          }
        />
        <Field
          labelKey="settings.diagnostics.fields.workspace"
          value={yesNo(state.workspaceOpen)}
        />
        <Field labelKey="settings.diagnostics.fields.windows" value={String(state.windowCount)} />
        <Field
          labelKey="settings.diagnostics.fields.terminals"
          value={String(state.terminalSessionCount)}
        />
        <Field
          labelKey="settings.diagnostics.fields.languageServers"
          value={
            state.languageServers.length === 0
              ? unknown
              : state.languageServers
                  .map((server) => `${server.serverId}: ${server.status}`)
                  .join(', ')
          }
        />
        <Field labelKey="settings.diagnostics.fields.debugSession" value={state.debugSession} />
      </DiagnosticsSection>

      <section className="fx-diagnostics__section" data-testid="settings-diagnostics-errors">
        <div className="fx-diagnostics__section-head">
          <h3 className="fx-diagnostics__section-title">
            {t('settings.diagnostics.sections.errors')}
          </h3>
          <button
            type="button"
            className="fx-diagnostics__button"
            data-testid="settings-diagnostics-clear"
            disabled={report.storedErrorCount === 0}
            onClick={() => void onClearErrors()}
          >
            {t('settings.diagnostics.clearErrors')}
          </button>
        </div>
        {report.recentErrors.length === 0 ? (
          <p className="fx-diagnostics__note" data-testid="settings-diagnostics-no-errors">
            {t('settings.diagnostics.noErrors')}
          </p>
        ) : (
          <>
            <p className="fx-diagnostics__note">
              {t('settings.diagnostics.errorCount', {
                shown: report.recentErrors.length,
                stored: report.storedErrorCount
              })}
            </p>
            <ol className="fx-diagnostics__errors">
              {report.recentErrors.map((record, index) => (
                <ErrorRecordItem key={`${record.occurredAt}-${index}`} record={record} />
              ))}
            </ol>
          </>
        )}
      </section>

      <details className="fx-diagnostics__preview" data-testid="settings-diagnostics-preview">
        <summary>{t('settings.diagnostics.preview')}</summary>
        <pre className="fx-diagnostics__text">{formatDiagnosticsReportText(report)}</pre>
      </details>
    </>
  )
}

function ErrorRecordItem({ record }: { readonly record: DiagnosticsErrorRecord }): JSX.Element {
  const { t } = useI18n()
  const occurredAt = new Date(record.occurredAt)

  return (
    <li
      className="fx-diagnostics__error-item"
      data-kind={record.kind}
      data-severity={record.severity}
    >
      <div className="fx-diagnostics__error-head">
        <span className="fx-diagnostics__error-kind">
          {t(`settings.diagnostics.errorKinds.${record.kind}`)}
        </span>
        <time className="fx-diagnostics__error-time" dateTime={occurredAt.toISOString()}>
          {occurredAt.toLocaleString()}
        </time>
      </div>
      <div className="fx-diagnostics__error-message">
        {record.name}: {record.message}
      </div>
      {record.stack.length > 0 && (
        <details>
          <summary>{t('settings.diagnostics.stack')}</summary>
          <pre className="fx-diagnostics__text">{record.stack.join('\n')}</pre>
        </details>
      )}
    </li>
  )
}

function DiagnosticsSection({
  titleKey,
  testId,
  children
}: {
  readonly titleKey: TranslationKey
  readonly testId: string
  readonly children: ReactNode
}): JSX.Element {
  const { t } = useI18n()

  return (
    <section className="fx-diagnostics__section" data-testid={`settings-diagnostics-${testId}`}>
      <h3 className="fx-diagnostics__section-title">{t(titleKey)}</h3>
      <dl className="fx-diagnostics__fields">{children}</dl>
    </section>
  )
}

function Field({
  labelKey,
  value
}: {
  readonly labelKey: TranslationKey
  readonly value: string
}): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="fx-diagnostics__field">
      <dt>{t(labelKey)}</dt>
      <dd>{value}</dd>
    </div>
  )
}
