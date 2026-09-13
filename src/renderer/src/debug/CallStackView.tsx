import type { JSX } from 'react'
import type { DebugCallStackFrame } from '@shared/debug'
import { useEditorContext } from '../editor/context'
import { useI18n } from '../i18n/context'
import { useCallStack } from './callStackContext'
import { openCallStackFrame } from './callStackNavigation'
import { findCurrentExecutionFrame } from './executionLocation'
import './debug.css'

export function CallStackView(): JSX.Element {
  const { snapshot, selectedFrameId, selectFrame } = useCallStack()
  const editor = useEditorContext()
  const { t } = useI18n()
  /* 実際に止まっている frame（Session 6-13）。選んでいる frame とは別に印を付ける。 */
  const currentFrameId = findCurrentExecutionFrame(snapshot)?.id ?? null

  if (snapshot.status === 'loading') {
    return <div className="fx-debug-call-stack__notice">{t('debug.callStack.loading')}</div>
  }

  if (snapshot.status === 'idle') {
    return <div className="fx-debug-call-stack__notice">{t('debug.callStack.empty')}</div>
  }

  if (snapshot.threads.length === 0) {
    return <div className="fx-debug-call-stack__notice">{t('debug.callStack.noThreads')}</div>
  }

  return (
    <div className="fx-debug-call-stack" aria-label={t('debug.callStack.aria')}>
      {snapshot.threads.map((thread) => (
        <section className="fx-debug-call-stack__thread" key={thread.id}>
          <h3 className="fx-debug-call-stack__thread-title">
            {thread.name}
            {thread.stopped && (
              <span className="fx-debug-call-stack__thread-state">
                {t('debug.callStack.stopped')}
              </span>
            )}
          </h3>
          {thread.frames.length === 0 ? (
            <p className="fx-debug-call-stack__thread-empty">
              {thread.stopped ? t('debug.callStack.noFrames') : t('debug.callStack.notLoaded')}
            </p>
          ) : (
            <ol className="fx-debug-call-stack__frames">
              {thread.frames.map((frame) => (
                <li className="fx-debug-call-stack__frame-item" key={frame.id}>
                  <FrameButton
                    frame={frame}
                    current={frame.id === currentFrameId}
                    selected={frame.id === selectedFrameId}
                    activate={() => {
                      /*
                        選ぶ（Variables がこの frame を読む）と、開く（Editor で位置を見せる）は
                        別のこと（Session 6-6）。Workspace 外の frame も選べるが、開きはしない
                        ── 開けるかどうかは openCallStackFrame が source の種類で決める。
                      */
                      selectFrame(frame.id)
                      openCallStackFrame(frame, editor)
                    }}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  )
}

function FrameButton({
  frame,
  current,
  selected,
  activate
}: {
  readonly frame: DebugCallStackFrame
  /** 実際に止まっている frame か（Session 6-13）。 */
  readonly current: boolean
  readonly selected: boolean
  readonly activate: () => void
}): JSX.Element {
  const { t } = useI18n()
  const canOpen = frame.source.kind === 'workspace' && frame.line !== null

  return (
    <button
      type="button"
      className="fx-debug-call-stack__frame"
      data-openable={canOpen}
      data-current={current}
      data-selected={selected}
      aria-current={selected ? 'true' : undefined}
      onClick={activate}
      title={
        canOpen
          ? t('debug.callStack.openFrame')
          : frame.source.kind === 'workspace'
            ? t('debug.callStack.invalidLocation')
            : t('debug.callStack.sourceUnavailable')
      }
    >
      <span className="fx-debug-call-stack__frame-name">
        {frame.name}
        {current && (
          <span className="fx-debug-call-stack__frame-badge">
            {t('debug.callStack.currentFrame')}
          </span>
        )}
      </span>
      <span className="fx-debug-call-stack__frame-location">
        {frame.source.kind === 'workspace'
          ? `${frame.source.relativePath}:${String(frame.line ?? 1)}`
          : frame.source.name}
      </span>
    </button>
  )
}
