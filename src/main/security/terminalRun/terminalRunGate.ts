import type { PlatformId } from '@shared/api'
import {
  isAgentPermissionMode,
  type SafeTerminalCommandDisplay,
  type SafeTerminalRunResult
} from '@shared/security'
import type { AuditEvent, AuditReason } from '../audit/auditEvent'
import { normalizeApprovalRequest } from '../approval/approvalAction'
import type { ApprovalConsumeResult, ApprovalOutcome } from '../approval/approvalManager'
import { approvalSafeSummary } from '../approval/approvalSummary'
import {
  isVerifiedWorkspaceTarget,
  type VerifiedWorkspaceTarget,
  type WorkspaceBoundaryResult
} from '../boundary/workspaceBoundary'
import { decideSecurityAction } from '../policy/securityDecision'
import { FAIL_CLOSED_SECURITY_POLICY, type SecurityPolicy } from '../policy/securityPolicy'
import { classifySecretPath } from '../secret/secretPaths'
import type { SideEffectAcquireResult } from '../sideEffect/sideEffectLock'
import { isAcceptableCommandName, isSafeBatchArgument } from './terminalCommand'
import { isInsideWorkspaceRoot, type TerminalExecutableResult } from './terminalExecutable'
import type { TerminalLaunchSpec } from './terminalLaunch'
import {
  sanitizeTerminalOutput,
  terminalOutputDisplay,
  type SafeTerminalOutput
} from './terminalOutput'
import {
  terminalApprovedEvent,
  terminalCompletedEvent,
  terminalDeniedEvent,
  terminalFailedEvent,
  terminalRequestedEvent
} from './terminalRunAudit'
import type { ExecutableIdentity, RunProcessResult } from './terminalRunIo'

/**
 * FN Agent の Terminal Command Runner（Security Core v1 の STEP8。Electron にも fs にも
 * child_process にも依存しない ── 実際に触る部分はすべて引数で受け取る）。
 *
 * **Agent の求めでコマンドを実行できる、唯一の経路。** ここを通らない実行は作らない
 * （人間用 Terminal への書き込みも、`exec` への fallback も無い）。
 *
 * ```
 * Agent が実行を提案する（command / args / cwd）
 *   ↓ 形の検査                            STEP6 の正規化（長さ・見えない文字・全体 2,000 文字）
 *   ↓                                      ＋ PATH 上の名前だけ
 *   ↓ Security Policy（STEP1）            read なら deny。ask のときだけ先へ
 *   ↓ 作業ディレクトリ（STEP2）          Boundary で確かめる。ディレクトリ・別名でない・Secret でない
 *   ↓ 実行ファイル                        PATH を Main が辿る（Workspace の中は使わない）
 *   ↓                                      .cmd / .bat なら引数は安全な文字だけ
 *   ↓ Renderer へ提案を見せる（第1段階）  Mask 済みの command / 引数 / 場所を省略せずに
 *   ↓ Approval Manager（STEP6）           続行 → Main の Native Dialog（第2段階）
 *   ↓ もう一度確かめる                    作業ディレクトリ（recheck）・実行ファイル（実体と identity）
 *   ↓ consume                             これから実行するもので binding を照合し、1回だけ使い切る
 *   ↓ 起動                                shell を通さず・stdin を閉じて・120 秒まで
 *   ↓ 出力を伏せる                        先頭から集めて Mask（STEP3）してから、画面へは末尾を
 *   ↓ Audit（STEP4）
 * ```
 *
 * ## Security Core が保証すること / しないこと（2026-09-23 確定）
 *
 * 保証するのは、**利用者が見て承認したものだけが、そのとおりに、承認した場所で、1回だけ
 * 起動される**ことまで ── 承認の前に起動しない・拒否なら起動しない・承認した argv と
 * 起動する argv が同じ・承認の後の差し替え（cwd・実行ファイル・argv）で起動しない・
 * Workspace の中の実行ファイルを拾わない・出力の Secret を伏せる。
 *
 * **承認されたコマンドが中で何をするかは縛らない。** 起動したプロセスは利用者と同じ
 * 権限で動き、Workspace の外を読み書きすることも、通信することもできる（Workspace
 * Boundary が縛るのは作業ディレクトリと実行ファイルの解決まで）。承認は「このコマンドに
 * 利用者の権限を与える」ことにあたり、その判断は利用者が承認の画面で行う。
 *
 * ## 信じないもの
 *
 * Agent の `safe` / 絶対パス / 解決済みの実行ファイル、Renderer の `approved`、
 * LLM の「安全です」。**受け取るのは command / args / cwd の3つだけ**で、残りは
 * すべて Main が Boundary・PATH・Policy から作り直す。承認の binding も、Renderer から
 * 戻ってきた値ではなく **Main が持ち続けている argv** から作る。
 *
 * ## v1 は1件ずつ
 *
 * 提案から終了まで、同時に2件を扱わない（2件目は `run-in-progress`）。
 *
 * STEP9 からは **File Write（STEP7）と共有のロック**（sideEffect/）で数える。File Write の
 * 承認待ちにコマンドを提案しても `side-effect-in-progress` で拒み、コマンドの実行中
 * （最大 120 秒）は File Write も同じ理由で拒まれる。
 */

/** 実行の結果。 */
export type TerminalRunOutcome =
  /** 起動して、終了した（終了コードが 0 でなくても `ok: true`）。 */
  | {
      readonly ok: true
      readonly exitCode: number | null
      readonly output: SafeTerminalOutput
    }
  /** 起動しなかった・起動できなかった・時間切れで終了させた。 */
  | {
      readonly ok: false
      readonly reason: AuditReason
      /** 時間切れの場合だけ、それまでの出力（伏せた後）。 */
      readonly output: SafeTerminalOutput | null
    }

/** Renderer へ送る提案の知らせ（IPC の payload と同じ形）。 */
export interface TerminalProposalNotice {
  readonly proposalId: string
  readonly command: SafeTerminalCommandDisplay
}

/** Gate が使う、Main 側の道具。 */
export interface TerminalRunGateDependencies {
  readonly platform: PlatformId
  /** 今効いている Policy（STEP1）。要求のたびに読み直す。 */
  readonly readPolicy: () => SecurityPolicy
  /** Audit Event を1件記録する（STEP4）。成否は返さない。 */
  readonly recordEvent: (event: AuditEvent) => void
  /** 作業ディレクトリを Workspace Boundary（STEP2）で確かめる（読み取りとして）。 */
  readonly resolveCwd: (relativePath: unknown) => Promise<WorkspaceBoundaryResult>
  /** 起動の直前に、同じ作業ディレクトリをもう一度確かめる。 */
  readonly recheckCwd: (target: VerifiedWorkspaceTarget) => Promise<WorkspaceBoundaryResult>
  /** コマンドの名前を実体へ解決する（Workspace の中を指す PATH の項目は使わない）。 */
  readonly resolveExecutable: (
    command: string,
    workspaceRoots: readonly string[]
  ) => TerminalExecutableResult
  /** 実行ファイルの実体と identity。 */
  readonly inspectExecutable: (file: string) => Promise<ExecutableIdentity | null>
  /** 同じ実体か。 */
  readonly isSameExecutable: (a: ExecutableIdentity, b: ExecutableIdentity) => boolean
  /** 起動する形を組み立てる。 */
  readonly buildLaunch: (
    executable: Extract<TerminalExecutableResult, { readonly ok: true }>,
    args: readonly string[]
  ) => TerminalLaunchSpec | null
  /** 起動して、終わるまで待つ。 */
  readonly runProcess: (spec: TerminalLaunchSpec, cwd: string) => Promise<RunProcessResult>
  /** 承認を求める（STEP6）。二段階が終わるまで解決しない。 */
  readonly requestApproval: (raw: unknown) => Promise<ApprovalOutcome>
  /** 起動の直前に1回だけ使い切る（STEP6）。 */
  readonly consumeApproval: (approvalId: unknown, raw: unknown) => ApprovalConsumeResult
  /** Renderer へ提案を知らせる。 */
  readonly notifyProposed: (notice: TerminalProposalNotice) => void
  /** Renderer へ、その提案が終わったことを知らせる（実行した場合は結果も）。 */
  readonly notifySettled: (proposalId: string, result: SafeTerminalRunResult | null) => void
  /** 提案の識別子を作る。 */
  readonly createProposalId: () => string
  /** 副作用のある操作の共有ロックを取る（STEP9。File Write と共有）。 */
  readonly acquireSideEffect: (kind: 'terminal.run') => SideEffectAcquireResult
}

export interface TerminalRunGate {
  /** コマンドを1つ、承認を通してから実行する。 */
  readonly run: (request: unknown) => Promise<TerminalRunOutcome>
}

/** Main が持ち続ける、実行するもの。**Renderer から戻ってきた値は1つも入らない。** */
interface PreparedRun {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: VerifiedWorkspaceTarget
  readonly workspacePath: string
  readonly executable: Extract<TerminalExecutableResult, { readonly ok: true }>
  readonly identity: ExecutableIdentity
  readonly launch: TerminalLaunchSpec
  /** 承認へ渡すものと、使い切るときに渡すもの（同じ値）。 */
  readonly approvalRequest: {
    readonly kind: 'terminal.run'
    readonly command: string
    readonly args: readonly string[]
    readonly cwd: string
  }
}

type Step<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: AuditReason }

export function createTerminalRunGate(deps: TerminalRunGateDependencies): TerminalRunGate {
  function record(event: AuditEvent): void {
    try {
      deps.recordEvent(event)
    } catch {
      // 記録できなかったことで allow / deny が変わってはいけない。
    }
  }

  /** 起動せずに終わる。 */
  function deny(
    reason: AuditReason,
    command: string | null,
    workspacePath: string | null,
    mode: SecurityPolicy['permissionMode']
  ): TerminalRunOutcome {
    record(terminalDeniedEvent(reason, command, workspacePath, mode))

    return Object.freeze({ ok: false as const, reason, output: null })
  }

  async function run(request: unknown): Promise<TerminalRunOutcome> {
    const policy = readPolicy(deps)
    const mode = policy.permissionMode

    /*
      副作用のある操作は、種類をまたいで同時に1件だけ（STEP9）。相手が Terminal なら
      STEP8 と同じ run-in-progress、File Write なら side-effect-in-progress。
      **取れたか分からない（例外）も拒む。**
    */
    const acquired = acquireLock(deps)

    if (!acquired.ok) {
      return deny(
        acquired.heldBy === 'terminal.run' ? 'run-in-progress' : 'side-effect-in-progress',
        null,
        null,
        mode
      )
    }

    try {
      return await propose(policy, request)
    } catch (cause) {
      /*
        想定していない例外。**「分からないから実行する」は無い。** ここへ来た時点で
        起動へ進んでいないか、進んだとしても io 側が結果を返している。
      */
      record(terminalFailedEvent('gate-failed', null, null, null, mode, cause))

      return Object.freeze({ ok: false as const, reason: 'gate-failed' as const, output: null })
    } finally {
      acquired.lease.release()
    }
  }

  async function propose(policy: SecurityPolicy, request: unknown): Promise<TerminalRunOutcome> {
    const mode = policy.permissionMode

    // 1. 形。受け取るのは command / args / cwd の3つだけ（他の欄は読まない）。
    const shape = readRequest(request)

    if (!shape.ok) {
      return deny(shape.reason, null, null, mode)
    }

    const { command, args, cwd } = shape.value

    record(terminalRequestedEvent(command, cwd, mode))

    // 2. Security Policy（STEP1）。read なら承認を求めることすらしない。
    const decision = decideSecurityAction(policy, { kind: 'terminal.run' })

    if (decision.verdict !== 'ask') {
      return deny(decision.reason, command, cwd, mode)
    }

    // 3. 作業ディレクトリ・実行ファイル・起動する形。
    const prepared = await prepare(command, args, cwd)

    if (!prepared.ok) {
      return deny(prepared.reason, command, cwd, mode)
    }

    const run = prepared.value
    const display = commandDisplay(run)

    if (display === null) {
      return deny('invalid-request', command, run.workspacePath, mode)
    }

    const proposalId = deps.createProposalId()

    try {
      deps.notifyProposed(Object.freeze({ proposalId, command: display }))
    } catch {
      // 見せられないコマンドを承認させない。
      return deny('window-unavailable', command, run.workspacePath, mode)
    }

    let result: SafeTerminalRunResult | null = null

    try {
      const outcome = await approveAndRun(run, mode)

      result = outcome.result

      return outcome.outcome
    } finally {
      settle(proposalId, result)
    }
  }

  /** 作業ディレクトリと実行ファイルを確かめ、起動する形を組み立てる。 */
  async function prepare(
    command: string,
    args: readonly string[],
    cwd: string
  ): Promise<Step<PreparedRun>> {
    const resolved = await deps.resolveCwd(cwd)

    if (!resolved.ok) {
      return failed(resolved.denial)
    }

    const target = resolved.target
    const cwdProblem = checkCwd(target)

    if (cwdProblem !== null) {
      return failed(cwdProblem)
    }

    const workspacePath = target.canonicalRelativePath
    const executable = deps.resolveExecutable(command, [target.rootPath, target.realRootPath])

    if (!executable.ok) {
      return failed(executable.denial)
    }

    // cmd.exe を通るため、安全な文字だけでできた引数しか渡さない（2026-09-23 確定）。
    if (executable.kind === 'batch' && !args.every(isSafeBatchArgument)) {
      return failed('unsafe-batch-argument')
    }

    const identity = await deps.inspectExecutable(executable.file)

    if (identity === null) {
      return failed('command-not-found')
    }

    // PATH の項目の綴りが外でも、リンクで Workspace の中を指せる。実体で確かめる。
    if (isInsideWorkspaceRoot(target.realRootPath, identity.realPath, deps.platform)) {
      return failed('unsupported-command')
    }

    const launch = deps.buildLaunch(executable, args)

    if (launch === null) {
      return failed('unsupported-command')
    }

    return Object.freeze({
      ok: true as const,
      value: Object.freeze({
        command,
        args,
        cwd: target,
        workspacePath,
        executable,
        identity,
        launch,
        approvalRequest: Object.freeze({
          kind: 'terminal.run' as const,
          command,
          args,
          cwd: workspacePath
        })
      })
    })
  }

  /**
   * 承認を取り、起動する。
   *
   * 承認へ渡すのも、使い切るときに渡すのも、起動するのも**同じ `run`**。
   * Renderer から戻ってきた値は1つも混ぜない。
   */
  async function approveAndRun(
    run: PreparedRun,
    mode: SecurityPolicy['permissionMode']
  ): Promise<{
    readonly outcome: TerminalRunOutcome
    readonly result: SafeTerminalRunResult | null
  }> {
    const { command, workspacePath } = run
    const denied = (reason: AuditReason): { outcome: TerminalRunOutcome; result: null } => ({
      outcome: deny(reason, command, workspacePath, mode),
      result: null
    })

    const outcome = await deps.requestApproval(run.approvalRequest)

    if (outcome.decision !== 'approved') {
      return denied(outcome.reason)
    }

    /*
      4. 承認から起動までの間に、作業ディレクトリや実行ファイルが差し替えられていることがある。
      **consume の前に**確かめる（通らないと分かっている実行のために承認を使い切らせない）。
    */
    const rechecked = await deps.recheckCwd(run.cwd)

    if (!rechecked.ok) {
      return denied(rechecked.denial)
    }

    const cwdProblem = checkCwd(rechecked.target)

    if (cwdProblem !== null) {
      return denied(cwdProblem)
    }

    if (rechecked.target.canonicalRelativePath !== workspacePath) {
      return denied('target-changed')
    }

    const executableProblem = await recheckExecutable(run, rechecked.target)

    if (executableProblem !== null) {
      return denied(executableProblem)
    }

    // 5. 使い切る。**これから起動するもの**で binding を照合する（STEP6）。
    const used = deps.consumeApproval(outcome.approvalId, run.approvalRequest)

    if (!used.ok) {
      return denied(used.reason)
    }

    record(terminalApprovedEvent(command, workspacePath, mode))

    // 6. 起動する。作業ディレクトリは確かめ直した後の実体。
    const ran = await deps.runProcess(run.launch, rechecked.target.realPath)

    return finishRun(ran, command, workspacePath, mode)
  }

  /** 起動の直前に、実行ファイルがまだ承認したときの実体か。 */
  async function recheckExecutable(
    run: PreparedRun,
    cwd: VerifiedWorkspaceTarget
  ): Promise<AuditReason | null> {
    const executable = deps.resolveExecutable(run.command, [cwd.rootPath, cwd.realRootPath])

    // PATH が変わって別のものが選ばれるようになった場合も、変わったと読む。
    if (
      !executable.ok ||
      executable.file !== run.executable.file ||
      executable.kind !== run.executable.kind
    ) {
      return 'executable-changed'
    }

    const identity = await deps.inspectExecutable(executable.file)

    if (identity === null || !deps.isSameExecutable(identity, run.identity)) {
      return 'executable-changed'
    }

    return isInsideWorkspaceRoot(cwd.realRootPath, identity.realPath, deps.platform)
      ? 'unsupported-command'
      : null
  }

  /** 起動した結果を、伏せた形にして記録する。 */
  function finishRun(
    ran: RunProcessResult,
    command: string,
    workspacePath: string,
    mode: SecurityPolicy['permissionMode']
  ): { readonly outcome: TerminalRunOutcome; readonly result: SafeTerminalRunResult } {
    if (ran.kind === 'spawn-failed') {
      record(terminalFailedEvent('spawn-failed', null, command, workspacePath, mode, ran.error))

      return {
        outcome: Object.freeze({
          ok: false as const,
          reason: 'spawn-failed' as const,
          output: null
        }),
        result: runResult('failed', null, null)
      }
    }

    // 出力は必ず伏せてから、Agent へも画面へも渡す（Audit へは伏せた数だけ）。
    const output = sanitizeTerminalOutput(ran.output)

    if (ran.kind === 'timed-out') {
      record(terminalFailedEvent('timed-out', output, command, workspacePath, mode))

      return {
        outcome: Object.freeze({ ok: false as const, reason: 'timed-out' as const, output }),
        result: runResult('timed-out', null, output)
      }
    }

    record(terminalCompletedEvent(ran.exitCode, output, command, workspacePath, mode))

    return {
      outcome: Object.freeze({ ok: true as const, exitCode: ran.exitCode, output }),
      result: runResult('completed', ran.exitCode, output)
    }
  }

  function settle(proposalId: string, result: SafeTerminalRunResult | null): void {
    try {
      deps.notifySettled(proposalId, result)
    } catch {
      // 知らせられなかった。結論は変えない。
    }
  }

  return { run }
}

/**
 * 受け取った要求を読む。
 *
 * 形・長さ・見えない文字・コマンド全体 2,000 文字は STEP6 の正規化（承認に渡すものと
 * 同じ関数）で、PATH 上の名前だけか、はここで見る。
 */
function readRequest(
  request: unknown
): Step<{ readonly command: string; readonly args: readonly string[]; readonly cwd: string }> {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return failed('invalid-request')
  }

  const raw = request as {
    readonly command?: unknown
    readonly args?: unknown
    readonly cwd?: unknown
  }
  const normalized = normalizeApprovalRequest({
    kind: 'terminal.run',
    command: raw.command,
    args: raw.args,
    cwd: raw.cwd
  })

  if (!normalized.ok || normalized.action.kind !== 'terminal.run') {
    return failed('invalid-request')
  }

  const { command, args, cwd } = normalized.action

  if (!isAcceptableCommandName(command)) {
    return failed('unsupported-command')
  }

  return Object.freeze({ ok: true as const, value: Object.freeze({ command, args, cwd }) })
}

/**
 * 作業ディレクトリとして使ってよいか（Boundary が返した事実を読むだけ）。
 *
 * ```
 * Boundary の対象でない・読み取りとして確かめたものでない   invalid-request
 * ディレクトリでない                                      cwd-not-directory
 * symlink / ジャンクション（8.3 の短い名前）を通っている    aliased-target
 * Secret の置き場所（.ssh / .gnupg など）                  secret-file
 * ```
 *
 * 別名を通った作業ディレクトリを拒むのは File Write（STEP7）と同じ線で、
 * **承認の画面に出た場所と、実際に起動する場所が別の綴りになる**ことを防ぐため。
 */
function checkCwd(target: unknown): AuditReason | null {
  if (!isVerifiedWorkspaceTarget(target) || target.access !== 'read') {
    return 'invalid-request'
  }

  if (target.state.kind !== 'directory') {
    return 'cwd-not-directory'
  }

  if (target.aliased) {
    return 'aliased-target'
  }

  return isSecretDirectory(target) ? 'secret-file' : null
}

/** 作業ディレクトリが Secret の置き場所か（Workspace root は違う）。 */
function isSecretDirectory(target: VerifiedWorkspaceTarget): boolean {
  try {
    return [target.canonicalRelativePath, target.requestedRelativePath].some(
      (path) => path !== '' && classifySecretPath(path) === 'secret-file'
    )
  } catch {
    return true
  }
}

/** 画面に出すコマンド（承認の知らせと同じ関数で作る。Renderer はこれで2つを突き合わせる）。 */
function commandDisplay(run: PreparedRun): SafeTerminalCommandDisplay | null {
  const normalized = normalizeApprovalRequest(run.approvalRequest)

  if (!normalized.ok) {
    return null
  }

  const summary = approvalSafeSummary(normalized.action)

  if (summary.actionKind !== 'terminal.run') {
    return null
  }

  return Object.freeze({
    commandName: summary.commandName,
    commandArgs: summary.commandArgs,
    commandSummary: summary.commandSummary,
    workspacePath: summary.workspacePath,
    viaBatch: run.executable.kind === 'batch',
    secretMasked: summary.secretMasked
  })
}

function runResult(
  status: SafeTerminalRunResult['status'],
  exitCode: number | null,
  output: SafeTerminalOutput | null
): SafeTerminalRunResult {
  return Object.freeze({
    status,
    exitCode,
    output:
      output === null
        ? Object.freeze({
            lines: Object.freeze([]),
            truncated: false,
            secretMasked: false,
            withheld: false
          })
        : terminalOutputDisplay(output)
  })
}

function failed<T>(reason: AuditReason): Step<T> {
  return Object.freeze({ ok: false as const, reason })
}

/** 共有ロックを取る（STEP9）。**例外・形の違う返り値は「取れなかった」に倒す。** */
function acquireLock(deps: TerminalRunGateDependencies): SideEffectAcquireResult {
  try {
    const result = deps.acquireSideEffect('terminal.run')

    if (result.ok) {
      return typeof result.lease?.release === 'function' ? result : LOCK_UNAVAILABLE
    }

    return result
  } catch {
    return LOCK_UNAVAILABLE
  }
}

const LOCK_UNAVAILABLE: SideEffectAcquireResult = Object.freeze({ ok: false, heldBy: null })

/** Policy が読めなければ、最も厳しい Policy として扱う（STEP1 / STEP5 / STEP6 / STEP7 と同じ倒し方）。 */
function readPolicy(deps: TerminalRunGateDependencies): SecurityPolicy {
  try {
    const policy: unknown = deps.readPolicy()

    if (typeof policy !== 'object' || policy === null) {
      return FAIL_CLOSED_SECURITY_POLICY
    }

    const mode = (policy as { readonly permissionMode?: unknown }).permissionMode

    return isAgentPermissionMode(mode) ? (policy as SecurityPolicy) : FAIL_CLOSED_SECURITY_POLICY
  } catch {
    return FAIL_CLOSED_SECURITY_POLICY
  }
}
