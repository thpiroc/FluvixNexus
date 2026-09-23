import type { AgentPermissionMode } from '@shared/security'
import type { AuditEvent, AuditReason } from '../audit/auditEvent'
import type { SafeTerminalOutput } from './terminalOutput'

/**
 * Terminal の判断と結果を、Audit Event 1件にする（Security Core v1 の STEP8。Electron に依存しない）。
 *
 * ```
 * 渡す     種別（requested / approved / denied / completed / failed）・判定・理由・
 *          効いていた Permission・操作の種類（terminal.run）・コマンドの名前（subject）・
 *          作業ディレクトリの Workspace 相対 Path・出力で伏せた数 / 種別
 * 渡さない 引数・stdout / stderr・終了コード以外の結果・実行ファイルの絶対パス・
 *          作業ディレクトリの絶対パス・環境変数・fingerprint・Approval の id・提案の id
 * ```
 *
 * **引数は1つも載せない。** 引数には Secret（`--token …`）も、利用者が書いた本文
 * （`-m "…"`）も入りうる。Audit Log は本文の置き場所ではない（DESIGN.md §6.4）。
 * `subject` に入るのは PATH 上の名前（`npm` / `git`）だけで、Audit 側でもう一度
 * Mask と長さの制限が掛かる。
 *
 * 出力の中身も載せない。載せるのは「伏せたか・いくつ・どの種類か」だけ。
 */

/** 実行を求められた（判定の前）。 */
export function terminalRequestedEvent(
  command: string | null,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return event(
    'terminal.requested',
    'ask',
    'approval-required',
    command,
    workspacePath,
    permissionMode
  )
}

/** 承認が通り、これから起動する。 */
export function terminalApprovedEvent(
  command: string,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return event(
    'terminal.approved',
    'allow',
    'user-approved',
    command,
    workspacePath,
    permissionMode
  )
}

/** 起動しなかった（判定・承認・事前の確認のどこかで止まった）。 */
export function terminalDeniedEvent(
  reason: AuditReason,
  command: string | null,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return event('terminal.denied', 'deny', reason, command, workspacePath, permissionMode)
}

/**
 * 起動して、終了した。
 *
 * 終了コードが 0 なら success、それ以外は failure（`non-zero-exit`）。
 * 終了コードそのものは載せない（欄が無い。成否で足りる）。
 */
export function terminalCompletedEvent(
  exitCode: number | null,
  output: SafeTerminalOutput,
  command: string,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  const succeeded = exitCode === 0

  return Object.freeze({
    ...event(
      'terminal.completed',
      'allow',
      succeeded ? 'user-approved' : 'non-zero-exit',
      command,
      workspacePath,
      permissionMode
    ),
    outcome: succeeded ? ('success' as const) : ('failure' as const),
    ...outputMetadata(output)
  })
}

/**
 * 承認は通ったが、起動できなかった・時間切れで終了させた。
 *
 * `denied`（起動しなかった）と分けてあるのは、時間切れの場合は**起動して何かをした後**
 * だから ── 後から辿るときに「拒否されただけ」と区別できる必要がある。
 */
export function terminalFailedEvent(
  reason: AuditReason,
  output: SafeTerminalOutput | null,
  command: string | null,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode,
  error?: unknown
): AuditEvent {
  return Object.freeze({
    ...event('terminal.failed', 'deny', reason, command, workspacePath, permissionMode),
    outcome: 'failure' as const,
    ...(output === null ? {} : outputMetadata(output)),
    ...(error === undefined ? {} : { error })
  })
}

function outputMetadata(output: SafeTerminalOutput): Partial<AuditEvent> {
  if (!output.secretMasked) {
    return {}
  }

  return {
    secretCategories: output.categories,
    maskedCount: output.maskedCount,
    userNoticeRequired: true
  }
}

function event(
  type: AuditEvent['type'],
  decision: 'allow' | 'ask' | 'deny',
  reason: AuditReason,
  command: string | null,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return Object.freeze({
    type,
    decision,
    reason,
    actionKind: 'terminal.run' as const,
    permissionMode,
    ...(command === null ? {} : { subject: command }),
    // Workspace root は '' ── 空の Path は載せない（「root」を表す語は Audit に無い）。
    ...(workspacePath === null || workspacePath === '' ? {} : { workspacePath })
  })
}
