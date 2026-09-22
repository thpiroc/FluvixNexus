import type {
  McpConfigProblem,
  McpConnectionFailure,
  McpConnectionStatus,
  McpConnectionTestResult,
  McpSecretSourceId
} from '@shared/mcp'
import type { TranslationKey } from '../i18n/messages'

/**
 * 接続の状態を、画面に出す1行へまとめる（§21.9。React 非依存・テスト対象）。
 *
 * 判断をここへ出したのは、settingsCatalog.ts を分けてあるのと同じ理由になる
 * ── **「どの状態のときに何が出るか」だけを、画面を起動せずに試せるように
 * するため**にほかならない。「無効なのに『token がありません』と出る」
 * のような取り違えは、見た目ではなくこの対応表の誤りにあたる。
 */

/** 出し方（色と記号を決めるのは CSS の側）。 */
export type McpStatusTone =
  /** 繋がった。 */
  | 'connected'
  /** 設定は揃っている（まだ試していない）。 */
  | 'ready'
  /** 使わないと決めてある。 */
  | 'disabled'
  /** 利用者の次の一手がある（token が無い等）。 */
  | 'attention'
  /** 揃っていたのに繋がらなかった。 */
  | 'failed'
  /** 今試している・まだ分からない。 */
  | 'busy'

export interface McpStatusSummary {
  readonly tone: McpStatusTone
  readonly messageKey: TranslationKey
}

const PROBLEM_KEYS: Readonly<Record<McpConfigProblem, TranslationKey>> = {
  disabled: 'settings.mcp.status.disabled',
  'token-missing': 'settings.mcp.status.tokenMissing',
  'token-invalid': 'settings.mcp.status.tokenInvalid',
  'node-not-found': 'settings.mcp.status.nodeNotFound',
  'server-not-installed': 'settings.mcp.status.serverNotInstalled',
  'command-not-found': 'settings.mcp.status.commandNotFound',
  'arguments-unsupported': 'settings.mcp.status.argumentsUnsupported',
  'secret-missing': 'settings.mcp.status.secretMissing'
}

const FAILURE_KEYS: Readonly<Record<McpConnectionFailure, TranslationKey>> = {
  'spawn-failed': 'settings.mcp.failure.spawnFailed',
  timeout: 'settings.mcp.failure.timeout',
  'server-exited': 'settings.mcp.failure.serverExited',
  'protocol-error': 'settings.mcp.failure.protocolError',
  'unsupported-protocol': 'settings.mcp.failure.unsupportedProtocol',
  rejected: 'settings.mcp.failure.rejected'
}

const SECRET_SOURCE_KEYS: Readonly<Record<McpSecretSourceId, TranslationKey>> = {
  stored: 'settings.mcp.secret.source.stored',
  environment: 'settings.mcp.secret.source.environment',
  none: 'settings.mcp.secret.source.none'
}

/**
 * 今の状態の1行。
 *
 * 見る順序に意味がある。
 *
 * 1. **まだ読めていない** … 何も言えない
 * 2. **試している最中** … 出したばかりの結果より、今の動きを先に出す
 * 3. **足りないもの** … 利用者の次の一手。`disabled` もここに入る
 * 4. **直近の結末** … 設定は揃っている状態での、最後に分かったこと
 * 5. 揃っているが、まだ試していない
 *
 * 3 を 4 より先に見るのは、**設定を変えた後も古い結果が残る**ため
 * ── token を消した直後に「繋がりました」と出続けてはいけない。
 */
export function summarizeMcpStatus(status: McpConnectionStatus | null): McpStatusSummary {
  if (status === null) {
    return { tone: 'busy', messageKey: 'settings.mcp.status.loading' }
  }

  if (status.testing) {
    return { tone: 'busy', messageKey: 'settings.mcp.status.testing' }
  }

  const [problem] = status.problems

  if (problem !== undefined) {
    return {
      tone: problem === 'disabled' ? 'disabled' : 'attention',
      messageKey: PROBLEM_KEYS[problem]
    }
  }

  if (status.lastTest !== null) {
    return summarizeTestResult(status.lastTest)
  }

  return { tone: 'ready', messageKey: 'settings.mcp.status.ready' }
}

/** 接続テスト1回分の結末。 */
export function summarizeTestResult(result: McpConnectionTestResult): McpStatusSummary {
  switch (result.outcome) {
    case 'connected':
      return { tone: 'connected', messageKey: 'settings.mcp.status.connected' }

    case 'not-configured': {
      const [problem] = result.problems

      return {
        tone: problem === 'disabled' ? 'disabled' : 'attention',
        messageKey:
          problem === undefined ? 'settings.mcp.status.notConfigured' : PROBLEM_KEYS[problem]
      }
    }

    case 'failed':
      return { tone: 'failed', messageKey: FAILURE_KEYS[result.failure] }
  }
}

/** token がどこから来ているか（値は扱わない）。 */
export function secretSourceKey(source: McpSecretSourceId): TranslationKey {
  return SECRET_SOURCE_KEYS[source]
}

/**
 * 保存した token を消せるか。
 *
 * 環境変数から来ている token は**このアプリが消せるものではない**
 * ── 押せる形にしておくと、押しても何も変わらない操作ができてしまう。
 */
export function canClearStoredSecret(status: McpConnectionStatus | null): boolean {
  return status !== null && status.secret.source === 'stored'
}

/**
 * 接続テストを押せるか。
 *
 * 無効なときは押せない ── 押しても「無効です」が返るだけで、
 * それは押す前から画面に出ている。
 */
export function canTestConnection(status: McpConnectionStatus | null): boolean {
  return status !== null && status.enabled && !status.testing
}
