import { useEffect, useRef, type JSX } from 'react'
import type { SafeTerminalCommandDisplay, SafeTerminalRunResult } from '@shared/security'
import { useI18n } from '../i18n/context'
import type { AgentTerminalPrompt } from './agentTerminalPrompt'
import './agentTerminal.css'

/**
 * FN Agent の Terminal の確認と結果（Security Core v1 の STEP8）。
 *
 * AgentFileWriteDialog.tsx と同じ作りのアプリ内モーダル。**確認の画面は承認ではない**
 * ── ここで「続ける」を選んでもコマンドは起動せず、Main が改めて Native の確認を出す
 * （第2段階。main/security/approval/approvalDialog.ts）。
 *
 * ## 省略せずに見せる（2026-09-23 確定）
 *
 * コマンド名と、**引数を1つずつ**、番号付きで並べる。1行にまとめると、空白や `"` を
 * 含む引数の区切りが読み分けられない。長い引数は折り返して全部見せ、`…` で切らない
 * （受け付ける長さそのものを Main が 2,000 文字で抑えてある）。
 *
 * ## 見るだけ
 *
 * **内容を編集できる要素を置かない**（input も textarea も contentEditable も無い）。
 * 結果の画面にも「もう一度実行する」にあたる操作は置かない。
 *
 * ## 届いたものを文字として並べる
 *
 * コマンドも出力も Main が Mask して見えない文字を取り除いた後の文字列で、
 * **そのまま文字として描く**（`dangerouslySetInnerHTML` は使わない）。
 *
 * ## 既定は「取り消す」
 *
 * 初期 focus を取り消しに置き、Esc も取り消しにあたる。**返事をしなければ、
 * Main 側で 5 分後に失効する。**
 */

interface AgentTerminalDialogProps {
  readonly prompt: AgentTerminalPrompt
  readonly busy: boolean
  readonly onContinue: () => void
  readonly onCancel: () => void
}

export function AgentTerminalDialog({
  prompt,
  busy,
  onContinue,
  onCancel
}: AgentTerminalDialogProps): JSX.Element {
  const { t } = useI18n()
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [prompt.approvalId])

  const { command } = prompt

  return (
    <div
      className="fx-agent-terminal__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          onCancel()
        }
      }}
    >
      <div
        className="fx-agent-terminal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fx-agent-terminal-title"
        data-testid="agent-terminal-dialog"
      >
        <h2 className="fx-agent-terminal__title" id="fx-agent-terminal-title">
          {t('agent.terminal.title')}
        </h2>

        <p className="fx-agent-terminal__body">{t('agent.terminal.body')}</p>

        <CommandDetails command={command} />

        {command.viaBatch && (
          <p className="fx-agent-terminal__note" data-testid="agent-terminal-via-batch">
            {t('agent.terminal.viaBatch')}
          </p>
        )}

        {command.secretMasked && (
          <p className="fx-agent-terminal__note" data-testid="agent-terminal-masked">
            {t('agent.terminal.secretMasked')}
          </p>
        )}

        <p className="fx-agent-terminal__warning" data-testid="agent-terminal-privilege">
          {t('agent.terminal.privilegeNote')}
        </p>

        <p className="fx-agent-terminal__note">{t('agent.terminal.readOnlyNote')}</p>

        <div className="fx-agent-terminal__actions">
          <button
            type="button"
            className="fx-agent-terminal__button"
            ref={cancelRef}
            disabled={busy}
            title={t('agent.terminal.cancelTitle')}
            data-testid="agent-terminal-cancel"
            onClick={onCancel}
          >
            {t('agent.terminal.cancel')}
          </button>

          <button
            type="button"
            className="fx-agent-terminal__button"
            data-variant="primary"
            disabled={busy}
            title={t('agent.terminal.continueTitle')}
            data-testid="agent-terminal-continue"
            onClick={onContinue}
          >
            {t('agent.terminal.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AgentTerminalResultDialogProps {
  readonly command: SafeTerminalCommandDisplay
  readonly result: SafeTerminalRunResult
  readonly onClose: () => void
}

/** 実行した結果（伏せた後の出力）。見るだけで、閉じる以外の操作は無い。 */
export function AgentTerminalResultDialog({
  command,
  result,
  onClose
}: AgentTerminalResultDialogProps): JSX.Element {
  const { t } = useI18n()
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [result])

  const { output } = result

  return (
    <div
      className="fx-agent-terminal__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose()
        }
      }}
    >
      <div
        className="fx-agent-terminal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fx-agent-terminal-result-title"
        data-testid="agent-terminal-result"
      >
        <h2 className="fx-agent-terminal__title" id="fx-agent-terminal-result-title">
          {t('agent.terminal.resultTitle')}
        </h2>

        <p
          className="fx-agent-terminal__status"
          data-status={result.status}
          data-testid="agent-terminal-status"
        >
          {statusText(result, t)}
        </p>

        <CommandDetails command={command} />

        <div className="fx-agent-terminal__label">{t('agent.terminal.outputLabel')}</div>

        {output.withheld ? (
          <p className="fx-agent-terminal__note" data-testid="agent-terminal-withheld">
            {t('agent.terminal.outputWithheld')}
          </p>
        ) : output.lines.length === 0 ? (
          <p className="fx-agent-terminal__note">{t('agent.terminal.noOutput')}</p>
        ) : (
          <pre className="fx-agent-terminal__output" data-testid="agent-terminal-output">
            {output.lines.join('\n')}
          </pre>
        )}

        {output.truncated && (
          <p className="fx-agent-terminal__note" data-testid="agent-terminal-output-truncated">
            {t('agent.terminal.outputTruncated')}
          </p>
        )}

        {output.secretMasked && (
          <p className="fx-agent-terminal__note" data-testid="agent-terminal-output-masked">
            {t('agent.terminal.outputSecretMasked')}
          </p>
        )}

        <div className="fx-agent-terminal__actions">
          <button
            type="button"
            className="fx-agent-terminal__button"
            ref={closeRef}
            data-testid="agent-terminal-close"
            onClick={onClose}
          >
            {t('agent.terminal.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** コマンド名・引数（1つずつ）・場所。 */
function CommandDetails({
  command
}: {
  readonly command: SafeTerminalCommandDisplay
}): JSX.Element {
  const { t } = useI18n()

  return (
    <dl className="fx-agent-terminal__details">
      <dt>{t('agent.terminal.commandLabel')}</dt>
      <dd className="fx-agent-terminal__code" data-testid="agent-terminal-command">
        {command.commandName}
      </dd>

      <dt>{t('agent.terminal.argsLabel', { count: command.commandArgs.length })}</dt>
      <dd>
        {command.commandArgs.length === 0 ? (
          <span className="fx-agent-terminal__muted">{t('agent.terminal.noArgs')}</span>
        ) : (
          <ol className="fx-agent-terminal__args" data-testid="agent-terminal-args">
            {command.commandArgs.map((arg, index) => (
              <li key={index} className="fx-agent-terminal__arg">
                <span className="fx-agent-terminal__arg-index">{index + 1}</span>
                {arg === '' ? (
                  <span className="fx-agent-terminal__muted">{t('agent.terminal.emptyArg')}</span>
                ) : (
                  <span className="fx-agent-terminal__code">{arg}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </dd>

      <dt>{t('agent.terminal.cwdLabel')}</dt>
      <dd className="fx-agent-terminal__code" data-testid="agent-terminal-cwd">
        {command.workspacePath ?? t('agent.terminal.workspaceRoot')}
      </dd>
    </dl>
  )
}

function statusText(result: SafeTerminalRunResult, t: ReturnType<typeof useI18n>['t']): string {
  switch (result.status) {
    case 'completed':
      return result.exitCode === null
        ? t('agent.terminal.status.completedUnknown')
        : t('agent.terminal.status.completed', { code: result.exitCode })

    case 'timed-out':
      return t('agent.terminal.status.timedOut')

    case 'failed':
      return t('agent.terminal.status.failed')
  }
}
