import type { ApprovalActionKind } from '@shared/security'
import { redactSecretText } from '../secret/secretMasking'
import type { NormalizedApprovalAction } from './approvalAction'

/**
 * 承認の画面と記録に出してよい要約（Security Core v1 の STEP6。Electron に依存しない）。
 *
 * Renderer の確認・Main の Native 確認・Audit Log の3か所は、**この要約しか見ない。**
 * 本文も raw なコマンドも渡らない。
 *
 * ```
 * 出す     操作の種類・Workspace 相対の対象・Mask 済みのコマンドの1行
 * 出さない 書き込む本文・Diff 本文・コマンドの出力・絶対パス・Secret
 * ```
 *
 * ## 表示用と binding 用を分ける
 *
 * ここが作るのは**表示のための文字列**で、承認と実行を結び付けるのは
 * fingerprint（approvalFingerprint.ts）の方。分けてあるのが要点で、
 *
 *   - 表示は Mask を通る（Secret を画面にも Log にも出さない）
 *   - binding は Mask を通らない（実行する exact な command / args と突き合わせる）
 *
 * を同時に満たす。**Mask 済みの文字列を突き合わせに使わない** ── 伏せた後の
 * `***REDACTED***` は元の値を1つに定めないため、違うコマンドが同じ表示になりうる。
 *
 * ## コマンドは必ず Mask を通す
 *
 * `npm publish --token ghp_…` のように、コマンドそのものに Secret が混ざることがある
 * （DESIGN.md §6.4）。Renderer へ送る前・Native 確認に出す前・Audit へ渡す前の
 * すべてで、STEP3 の `redactSecretText()` を通した後の文字列だけを使う。
 *
 * ## 長さで切る
 *
 * 承認の画面は「何が起きるか」を1目で読めることが要る。切った跡は `…` で残す。
 * **切ったことで承認の対象が変わることはない**（対象を決めるのは fingerprint）。
 */

/** 対象名（相対 Path・コマンド名）の上限。Audit の `subject` と同じ長さ。 */
export const APPROVAL_SUBJECT_MAX_LENGTH = 120

/** 表示するコマンドの1行の上限。 */
export const APPROVAL_COMMAND_SUMMARY_MAX_LENGTH = 200

/** 切ったことを示す印。 */
export const APPROVAL_TRUNCATION_MARK = '…'

/** 画面と記録に出してよい要約。**Secret も本文も絶対パスも持たない。** */
export interface ApprovalSafeSummary {
  readonly actionKind: ApprovalActionKind
  /** 短い対象名（File Write は Workspace 相対 Path、Terminal はコマンド名）。 */
  readonly subject: string
  /** Workspace 相対の位置（Terminal は `cwd`。root は `null`）。 */
  readonly workspacePath: string | null
  /** Mask 済みのコマンドの1行（File Write は `null`）。 */
  readonly commandSummary: string | null
}

/** 操作1件の安全な要約。**例外を投げない。** */
export function approvalSafeSummary(action: NormalizedApprovalAction): ApprovalSafeSummary {
  if (action.kind === 'file.write') {
    const path = safeText(action.canonicalRelativePath, APPROVAL_SUBJECT_MAX_LENGTH)

    return Object.freeze({
      actionKind: 'file.write' as const,
      subject: path,
      workspacePath: path,
      commandSummary: null
    })
  }

  return Object.freeze({
    actionKind: 'terminal.run' as const,
    subject: safeText(action.command, APPROVAL_SUBJECT_MAX_LENGTH),
    workspacePath: action.cwd === '' ? null : safeText(action.cwd, APPROVAL_SUBJECT_MAX_LENGTH),
    commandSummary: safeText(
      commandLine(action.command, action.args),
      APPROVAL_COMMAND_SUMMARY_MAX_LENGTH
    )
  })
}

/**
 * 表示するコマンドの1行を組み立てる。
 *
 * 空白を含む引数は `"` で囲む ── 囲まないと、1つの引数と2つの引数が同じに見える。
 * **これは表示のための整形で、実行する形ではない**（実行するのは Command Runner が
 * 受け取る command / args そのもの）。
 */
function commandLine(command: string, args: readonly string[]): string {
  const parts = [command, ...args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))]

  return parts.join(' ')
}

/** Secret を伏せてから、長さで切る。 */
function safeText(value: string, maxLength: number): string {
  let masked: string

  try {
    masked = redactSecretText(value)
  } catch {
    // 伏せられなかった。何が入っていたか分からない以上、そのままは出さない。
    return APPROVAL_TRUNCATION_MARK
  }

  if (masked.length <= maxLength) {
    return masked
  }

  // 切った端で文字が割れないよう、コードポイントの単位で数える。
  const kept = [...masked].slice(0, maxLength - APPROVAL_TRUNCATION_MARK.length).join('')

  return `${kept}${APPROVAL_TRUNCATION_MARK}`
}
