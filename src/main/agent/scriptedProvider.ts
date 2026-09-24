import {
  isSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import type { AgentProvider } from './agentProvider'

/**
 * 開発ビルド専用の Scripted Provider（Security Core v1 の STEP9）。
 *
 * **実際の AI ではない。** 決まった手順で Action を返し、Agent Loop を End-to-End で
 * 動かすための相手（2026-09-23 確定: STEP9 は実 Provider を接続しない。実 Provider と
 * Credential Store は STEP10）。配布ビルドでは作られない（currentAgentLoop.ts）。
 *
 * それでも**本物の Provider と同じ境界**を通る。受け取るのは External Send Gate が発行した
 * `SafeExternalPayload` だけで（受け取ったものが Gate の発行したものでない・自分宛てでなければ
 * 投げる）、Agent Loop からは実 Provider と同じ `callAgentProvider`（STEP10-2。providerId の照合・
 * abort / timeout・応答の上限）を通して呼ばれ、返す Action は Agent Loop の Schema で確かめられ、
 * Security Core の Gate を通る ── Scripted だからといって飛ばせる検査は1つも無い。
 *
 * ## 手順（指示の中の印で選ぶ）
 *
 * ```
 * （印なし）  E2E: workspace_status → workspace_list → file_search → file_write（承認）
 *             → file_read → terminal_run（承認）→ complete
 * #secret     .env を読もうとする → 同じ Action をもう一度（repeated-action）→ complete
 * #invalid    壊れた出力・並列の Action・知らない種類・知らない欄を混ぜる → complete
 * #broken     壊れた出力だけを返し続ける（too-many-invalid-actions で止まる）
 * #loop       complete を返さない（Loop の上限 20 → 続けるか尋ねる）
 * ```
 *
 * 前の結果は Payload の中の Tool の結果（`status:` / `reason:` / `exit code:` の行）から読む。
 */

/** Scripted Provider の識別子（External Send Gate の providerId）。 */
export const SCRIPTED_PROVIDER_ID = 'fn-scripted-dev'

/** Scripted Provider の Context Window（Token）。Context の畳み方も動かせる小ささにしてある。 */
export const SCRIPTED_CONTEXT_WINDOW_TOKENS = 32_000

/** E2E で書くファイル（Workspace root の直下。途中のフォルダは作らない）。 */
export const SCRIPTED_E2E_FILE = 'fn-agent-e2e.mjs'

export const SCRIPTED_E2E_CONTENT = [
  '// FN Agent STEP9 E2E: written by the Scripted Provider after your approval.',
  "console.log('FN Agent E2E: OK')",
  ''
].join('\n')

type Scenario = 'e2e' | 'secret' | 'invalid' | 'broken' | 'loop'

/** 直前の Tool の結果（Payload から読んだもの）。 */
interface LastResult {
  readonly action: string | null
  readonly status: string | null
  readonly reason: string | null
  readonly exitCode: string | null
  readonly text: string
}

export function createScriptedProvider(): AgentProvider {
  let scenario: Scenario | null = null
  let step = 0

  return Object.freeze({
    id: SCRIPTED_PROVIDER_ID,
    contextWindowTokens: SCRIPTED_CONTEXT_WINDOW_TOKENS,
    async next(payload: SafeExternalPayload, signal: AbortSignal): Promise<unknown> {
      // 本物の Provider Adapter と同じく、送る直前に Gate の発行したものかを確かめる。
      if (!isSafeExternalPayload(payload)) {
        throw new Error('the payload was not issued by the External Send Gate')
      }

      // 別の Provider 宛ての Payload には答えない（callAgentProvider も照合する。二重にしてある）。
      if (payload.providerId !== SCRIPTED_PROVIDER_ID) {
        throw new Error('the payload is addressed to another provider')
      }

      if (signal.aborted) {
        throw new Error('aborted')
      }

      scenario ??= pickScenario(payload)

      const output = respond(scenario, step, lastResult(payload))

      step += 1

      return output
    }
  })
}

function respond(scenario: Scenario, step: number, last: LastResult): unknown {
  switch (scenario) {
    case 'e2e':
      return e2e(step, last)
    case 'secret':
      return secret(step, last)
    case 'invalid':
      return invalid(step)
    case 'broken':
      return 'this is not a JSON action'
    case 'loop':
      return action({ type: 'workspace_status' })
  }
}

function e2e(step: number, last: LastResult): unknown {
  switch (step) {
    case 0:
      return action({ type: 'workspace_status' })
    case 1:
      return action({ type: 'workspace_list', path: '' })
    case 2:
      return action({ type: 'file_search', query: 'TODO' })
    case 3:
      return action({ type: 'file_write', path: SCRIPTED_E2E_FILE, content: SCRIPTED_E2E_CONTENT })
    case 4:
      if (last.status !== 'ok') {
        return complete(
          `ファイルは書き込まれませんでした（理由: ${last.reason ?? '不明'}）。同じ変更は提案せずに終了します。`
        )
      }

      return action({ type: 'file_read', path: SCRIPTED_E2E_FILE })
    case 5:
      return action({ type: 'terminal_run', command: 'node', args: [SCRIPTED_E2E_FILE], cwd: '' })
    default: {
      if (last.action !== 'terminal_run' || last.status !== 'ok') {
        return complete(
          `${SCRIPTED_E2E_FILE} を作成しましたが、コマンドは実行されませんでした（理由: ${last.reason ?? '不明'}）。`
        )
      }

      const printed =
        last.text.split('\n').find((line) => line.includes('FN Agent E2E')) ?? '(出力なし)'

      return complete(
        [
          'End-to-End の確認を終えました（Scripted Provider）。',
          `- ${SCRIPTED_E2E_FILE} を作成しました（承認済み）。`,
          `- node ${SCRIPTED_E2E_FILE} を実行しました（承認済み・終了コード ${last.exitCode ?? '不明'}）。`,
          `- 出力: ${printed.trim()}`
        ].join('\n')
      )
    }
  }
}

function secret(step: number, last: LastResult): unknown {
  switch (step) {
    case 0:
    case 1:
      // 2回目は、拒否された Action をそのまま出し直す（Agent Loop が repeated-action で拒む）。
      return action({ type: 'file_read', path: '.env' })
    default:
      return complete(
        `.env は読めませんでした（最後の理由: ${last.reason ?? '不明'}）。Secret ファイルは Agent から読めないことを確認しました。`
      )
  }
}

function invalid(step: number): unknown {
  switch (step) {
    case 0:
      return 'this is not a JSON action'
    case 1:
      return { actions: [{ type: 'workspace_status' }, { type: 'workspace_list', path: '' }] }
    case 2:
      return action({ type: 'workspace_status' })
    case 3:
      return action({ type: 'git_push' })
    case 4:
      return action({ type: 'workspace_status', approved: true })
    default:
      return complete(
        '壊れた出力・並列の Action・知らない種類・知らない欄は、どれも実行されませんでした。'
      )
  }
}

function action(value: Record<string, unknown>): unknown {
  return { action: value }
}

function complete(answer: string): unknown {
  return action({ type: 'complete', answer })
}

function pickScenario(payload: SafeExternalPayload): Scenario {
  const prompt = payload.parts.find((part) => part.kind === 'user-prompt')?.text.toLowerCase() ?? ''

  for (const scenario of ['secret', 'invalid', 'broken', 'loop'] as const) {
    if (prompt.includes(`#${scenario}`)) {
      return scenario
    }
  }

  return 'e2e'
}

/** Payload の中の最後の Tool の結果を読む。 */
function lastResult(payload: SafeExternalPayload): LastResult {
  const part = [...payload.parts]
    .reverse()
    .find(
      (candidate) =>
        (candidate.kind === 'tool-result' || candidate.kind === 'error-summary') &&
        /^action: /m.test(candidate.text)
    )

  if (part === undefined) {
    return { action: null, status: null, reason: null, exitCode: null, text: '' }
  }

  const field = (name: string): string | null =>
    new RegExp(`^${name}: (\\S+)`, 'm').exec(part.text)?.[1] ?? null

  return {
    action: field('action'),
    status: field('status'),
    reason: field('reason'),
    exitCode: field('exit code'),
    text: part.text
  }
}
