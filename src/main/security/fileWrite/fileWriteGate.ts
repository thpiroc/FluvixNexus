import type { SafeFileWriteDiff } from '@shared/security'
import { isAgentPermissionMode } from '@shared/security'
import type { AuditEvent, AuditReason } from '../audit/auditEvent'
import type { ApprovalConsumeResult, ApprovalOutcome } from '../approval/approvalManager'
import {
  isVerifiedWorkspaceTarget,
  type VerifiedWorkspaceTarget,
  type WorkspaceBoundaryResult
} from '../boundary/workspaceBoundary'
import { decideSecurityAction } from '../policy/securityDecision'
import { FAIL_CLOSED_SECURITY_POLICY, type SecurityPolicy } from '../policy/securityPolicy'
import { agentFileWriteFacts } from '../secret/secretFileFacts'
import type { SideEffectAcquireResult } from '../sideEffect/sideEffectLock'
import { isStopRequested } from '../sideEffect/stopSignal'
import {
  fileWriteApprovedEvent,
  fileWriteDeniedEvent,
  fileWriteFailedEvent,
  fileWriteRequestedEvent,
  fileWriteSucceededEvent
} from './fileWriteAudit'
import { prepareFileWriteContent } from './fileWriteContent'
import type { ReadCurrentFileResult, WriteFileResult } from './fileWriteIo'
import { createSafeFileWriteDiff } from './safeFileWriteDiff'

/**
 * FN Agent の File Write Gate（Security Core v1 の STEP7。Electron にも fs にも依存しない）。
 *
 * **Workspace の中のファイルを Agent の求めで書き換えられる、唯一の経路。**
 * ここを通らない書き込みは作らない（`fs.writeFile` への fallback も、既存の
 * `files:write-file` への転送も無い）。
 *
 * ```
 * Agent が書き込みを提案する（相対 Path ＋ 本文）
 *   ↓ Workspace Boundary（STEP2）        Main がディスクを見て確かめる
 *   ↓ Secret ファイルの判定（STEP3）      名前から Secret ファイルなら拒否
 *   ↓ Security Policy（STEP1）            read なら deny。ask のときだけ先へ
 *   ↓ 本文の検査                          大きさ・binary・UTF-8 の往復
 *   ↓ 今の中身を読む（既存のみ）          ハンドルを confirm してから読む
 *   ↓ Diff を作る（Main 側）              Mask して切った安全な Diff を Renderer へ
 *   ↓ Approval Manager（STEP6）           Renderer の確認 → Main の Native Dialog
 *   ↓ consume                             これから書くもので1回だけ使い切る
 *   ↓ Boundary をもう一度                 recheck（identity・リンク数・alias・欠け）
 *   ↓ open → confirm → 書く               確かめたハンドル越しにだけ書く
 *   ↓ 書いた結果を確かめる                読み直して一致するか・対象のままか
 *   ↓ Audit（STEP4）
 * ```
 *
 * ## 信じないもの
 *
 * Renderer の `insideWorkspace` / `approved`、Agent の `safe` / canonical path /
 * fingerprint、LLM の「安全です」。**受け取るのは相対 Path の綴りと本文の2つだけ**で、
 * 残りはすべて Main がディスクと Policy から作り直す。承認の binding も Renderer から
 * 戻ってきた値ではなく、**Main が持ち続けている提案本文**から作る。
 *
 * ## v1 は1件ずつ
 *
 * 同時に2件の File Write を承認にかけない。**画面に出ている Diff と、承認しようと
 * している変更が別物になる**ことを防ぐためで、2件目は `write-in-progress` で拒否する。
 * Agent Loop が並行して書きたくなった場合も、v1 では順番に通す。
 *
 * STEP9 からは **Terminal（STEP8）と共有のロック**（sideEffect/）で数える。Terminal の
 * 承認待ち・実行中に File Write を提案しても `side-effect-in-progress` で拒む
 * （副作用のある操作は、種類をまたいで同時に1件だけ）。
 *
 * ## Human の保存とは別の経路
 *
 * 利用者が Editor で保存する経路（`files:write-file` → files/writeWorkspaceFile.ts）は
 * **そのまま。** あちらは「利用者が今開いて編集したファイルを書き戻す」操作で、
 * 承認も Diff も要らない。こちらは「Agent が提案した変更」で、承認が要る。
 * 2つを1つの関数にまとめない ── まとめると、片方の都合で緩めた条件がもう片方にも効く。
 */

/** 書き込みの結果。 */
export type FileWriteOutcome =
  | { readonly ok: true; readonly workspacePath: string }
  | { readonly ok: false; readonly reason: AuditReason }

/** Renderer へ送る提案の知らせ（IPC の payload と同じ形）。 */
export interface FileWriteProposalNotice {
  readonly proposalId: string
  readonly workspacePath: string
  readonly newFile: boolean
  readonly diff: SafeFileWriteDiff
}

/** Gate が使う、Main 側の道具。 */
export interface FileWriteGateDependencies {
  /** 今効いている Policy（STEP1）。要求のたびに読み直す。 */
  readonly readPolicy: () => SecurityPolicy
  /** Audit Event を1件記録する（STEP4）。成否は返さない。 */
  readonly recordEvent: (event: AuditEvent) => void
  /** Workspace Boundary（STEP2）で確かめる。 */
  readonly resolveTarget: (relativePath: unknown) => Promise<WorkspaceBoundaryResult>
  /** 書き込みの直前に、同じ対象をもう一度確かめる（STEP2）。 */
  readonly recheckTarget: (target: VerifiedWorkspaceTarget) => Promise<WorkspaceBoundaryResult>
  /** 既存ファイルの今の中身を、確かめたハンドル越しに読む。 */
  readonly readCurrent: (target: VerifiedWorkspaceTarget) => Promise<ReadCurrentFileResult>
  /** 確かめたハンドル越しに書く。 */
  readonly writeFile: (
    target: VerifiedWorkspaceTarget,
    bytes: Buffer,
    expectedContentHash: string | null
  ) => Promise<WriteFileResult>
  /**
   * 承認を求める（STEP6）。二段階が終わるまで解決しない。
   * `signal` が止まっていれば承認を作らず、待っている間に止まればその承認を失効させる。
   */
  readonly requestApproval: (raw: unknown, signal?: AbortSignal) => Promise<ApprovalOutcome>
  /** 実行の直前に1回だけ使い切る（STEP6）。 */
  readonly consumeApproval: (approvalId: unknown, raw: unknown) => ApprovalConsumeResult
  /** Renderer へ提案を知らせる。 */
  readonly notifyProposed: (notice: FileWriteProposalNotice) => void
  /** Renderer へ、その提案が終わったことを知らせる。 */
  readonly notifySettled: (proposalId: string) => void
  /** 提案の識別子を作る。 */
  readonly createProposalId: () => string
  /** 副作用のある操作の共有ロックを取る（STEP9。Terminal と共有）。 */
  readonly acquireSideEffect: (kind: 'file.write') => SideEffectAcquireResult
}

export interface FileWriteGate {
  /**
   * Workspace の中のファイル1件を書き換える（承認を通してから）。
   *
   * `signal` は求めた側（Agent の作業）が止まったこと。止まった後は、**新しい承認を作らず・
   * 書かない**（`agent-stopped`）。止まる向きにしか働かず、確認を省く口にはならない。
   */
  readonly write: (
    relativePath: unknown,
    content: unknown,
    signal?: AbortSignal
  ) => Promise<FileWriteOutcome>
}

export function createFileWriteGate(deps: FileWriteGateDependencies): FileWriteGate {
  function record(event: AuditEvent): void {
    try {
      deps.recordEvent(event)
    } catch {
      // 記録できなかったことで allow / deny が変わってはいけない。
    }
  }

  /** 書かずに終わる。 */
  function deny(
    reason: AuditReason,
    workspacePath: string | null,
    mode: SecurityPolicy['permissionMode']
  ): FileWriteOutcome {
    record(fileWriteDeniedEvent(reason, workspacePath, mode))

    return Object.freeze({ ok: false as const, reason })
  }

  /** 書き込みに手を付けた後で終わる。 */
  function fail(
    reason: AuditReason,
    workspacePath: string | null,
    mode: SecurityPolicy['permissionMode']
  ): FileWriteOutcome {
    record(fileWriteFailedEvent(reason, workspacePath, mode))

    return Object.freeze({ ok: false as const, reason })
  }

  async function write(
    relativePath: unknown,
    content: unknown,
    signal?: AbortSignal
  ): Promise<FileWriteOutcome> {
    const policy = readPolicy(deps)
    const mode = policy.permissionMode

    // 求めた側がもう止まっている。ロックも取らない。
    if (isStopRequested(signal)) {
      return deny('agent-stopped', null, mode)
    }

    /*
      副作用のある操作は、種類をまたいで同時に1件だけ（STEP9）。相手が File Write なら
      STEP7 と同じ write-in-progress、Terminal なら side-effect-in-progress。
      **取れたか分からない（例外）も拒む。**
    */
    const acquired = acquireLock(deps)

    if (!acquired.ok) {
      return deny(
        acquired.heldBy === 'file.write' ? 'write-in-progress' : 'side-effect-in-progress',
        null,
        mode
      )
    }

    try {
      return await run(policy, relativePath, content, signal)
    } catch (cause) {
      /*
        想定していない例外。**「分からないから書く」は無い。** ここへ来た時点で
        書き込みへ進んでいないか、進んだとしても io 側が結果を返している。
      */
      record(fileWriteFailedEvent('gate-failed', null, mode, cause))

      return Object.freeze({ ok: false as const, reason: 'gate-failed' as const })
    } finally {
      acquired.lease.release()
    }
  }

  async function run(
    policy: SecurityPolicy,
    relativePath: unknown,
    content: unknown,
    signal: AbortSignal | undefined
  ): Promise<FileWriteOutcome> {
    const mode = policy.permissionMode

    // 1. Workspace Boundary（STEP2）。Agent の綴りはここでしか解かない。
    const resolved = await deps.resolveTarget(relativePath)

    if (!resolved.ok) {
      return deny(resolved.denial, null, mode)
    }

    const target = resolved.target

    if (!isVerifiedWorkspaceTarget(target) || target.access !== 'write') {
      return deny('invalid-request', null, mode)
    }

    const workspacePath = target.canonicalRelativePath

    if (workspacePath === '') {
      return deny('not-a-file', null, mode)
    }

    record(fileWriteRequestedEvent(workspacePath, mode))

    // 2. v1 で書ける形か（Boundary が返した事実をここで使う）。
    const shape = checkTargetShape(target)

    if (shape !== null) {
      return deny(shape, workspacePath, mode)
    }

    /*
      3. Security Policy（STEP1）。Secret ファイル（STEP3）・Workspace の外・hard link は
      ここで deny になる。**read の Permission では ask にもならない**ため、
      Diff を作ることも Renderer へ知らせることもしない。
    */
    const decision = decideSecurityAction(policy, {
      kind: 'file.write',
      target: agentFileWriteFacts(target)
    })

    if (decision.verdict !== 'ask') {
      return deny(decision.reason, workspacePath, mode)
    }

    // 4. 今ディスクにある中身（既存のみ）。Diff の左と、変更検知の材料になる。
    const current = await readCurrentIfExists(target)

    if (!current.ok) {
      return deny(current.denial, workspacePath, mode)
    }

    // 5. 提案された本文。書き戻す形は「今ディスクにある形」に合わせる（BOM）。
    const prepared = prepareFileWriteContent(content, current.encoding)

    if (!prepared.ok) {
      return deny(prepared.denial, workspacePath, mode)
    }

    // 6. Diff は Main が作る。作れなければ書かない（内容を見ずに承認させない）。
    const diff = createSafeFileWriteDiff(current.text, prepared.content)

    if (diff === null) {
      return deny('diff-failed', workspacePath, mode)
    }

    /*
      ロックを取ってからここまでの I/O（Boundary・今の中身）の間に、求めた側が止まっている
      ことがある（利用者の停止・Workspace の切り替え）。**Diff も承認も見せずに終える** ──
      止めた時点ではまだ承認が無いため、止めたときの取り消しでは消せない（2026-09-24 の修正）。
    */
    if (isStopRequested(signal)) {
      return deny('agent-stopped', workspacePath, mode)
    }

    const proposalId = deps.createProposalId()

    try {
      deps.notifyProposed(
        Object.freeze({
          proposalId,
          workspacePath,
          newFile: current.contentHash === null,
          diff
        })
      )
    } catch {
      // 見せられない変更を承認させない。
      return deny('window-unavailable', workspacePath, mode)
    }

    try {
      return await approveAndWrite(
        target,
        workspacePath,
        prepared,
        current.contentHash,
        mode,
        signal
      )
    } finally {
      settle(proposalId)
    }
  }

  /**
   * 承認を取り、書く。
   *
   * 承認へ渡すのも、使い切るときに渡すのも**同じ `target` と同じ本文**。
   * Renderer から戻ってきた値は1つも混ぜない（混ぜた時点で、承認したものと
   * 書くものが別の出どころになる）。
   */
  async function approveAndWrite(
    target: VerifiedWorkspaceTarget,
    workspacePath: string,
    prepared: { readonly content: string; readonly bytes: Buffer },
    expectedContentHash: string | null,
    mode: SecurityPolicy['permissionMode'],
    signal: AbortSignal | undefined
  ): Promise<FileWriteOutcome> {
    const request = { kind: 'file.write' as const, target, content: prepared.content }
    // 待っている間に止まれば、Manager がその承認を失効させる（deny で解ける）。
    const outcome = await deps.requestApproval(request, signal)

    if (outcome.decision !== 'approved') {
      return deny(outcome.reason, workspacePath, mode)
    }

    /*
      7. 承認から実際に書くまでの間に、ディスクが変わっていることがある。
      **consume の前に**確かめる ── 通らないと分かっている書き込みのために
      承認を使い切らせない（使い切れば、利用者はもう一度承認からやり直しになる）。
    */
    const rechecked = await deps.recheckTarget(target)

    if (!rechecked.ok) {
      return deny(rechecked.denial, workspacePath, mode)
    }

    const shape = checkTargetShape(rechecked.target)

    if (shape !== null) {
      return deny(shape, workspacePath, mode)
    }

    /*
      recheck が返すのは**新しい対象**（同じ実体・同じ identity であることは確かめ済み）。
      Secret ファイルの判定も、承認の前と同じようにもう一度通す ── 承認を見せている間に
      `.env` へ改名された場合、綴りが変わっている。
    */
    const facts = agentFileWriteFacts(rechecked.target)

    if (!facts.insideWorkspace) {
      return deny('outside-workspace', workspacePath, mode)
    }

    if (facts.secretFile) {
      return deny('secret-file', workspacePath, mode)
    }

    if (facts.hardLink) {
      return deny('hard-link-write', workspacePath, mode)
    }

    if (rechecked.target.canonicalRelativePath !== workspacePath) {
      return deny('target-changed', workspacePath, mode)
    }

    /*
      承認の後の recheck の間に止まった。承認を使い切らず、書かない。
      ここから書き始めるまでに await は無い（consume → 記録 → writeFile の呼び出しまで同期）。
    */
    if (isStopRequested(signal)) {
      return deny('agent-stopped', workspacePath, mode)
    }

    // 8. 使い切る。**これから書くもの**で binding を照合する（STEP6）。
    const used = deps.consumeApproval(outcome.approvalId, request)

    if (!used.ok) {
      return deny(used.reason, workspacePath, mode)
    }

    record(fileWriteApprovedEvent(workspacePath, mode))

    // 9. 開く → confirm → ハンドル越しに書く → 書いた結果を確かめる。
    const written = await deps.writeFile(rechecked.target, prepared.bytes, expectedContentHash)

    if (!written.ok) {
      return fail(written.denial, workspacePath, mode)
    }

    record(fileWriteSucceededEvent(workspacePath, mode))

    return Object.freeze({ ok: true as const, workspacePath })
  }

  /** 既存ファイルなら今の中身を読む。新しいファイルなら空。 */
  async function readCurrentIfExists(target: VerifiedWorkspaceTarget): Promise<
    | {
        readonly ok: true
        readonly text: string
        readonly encoding: 'utf8' | 'utf8-bom'
        /** 既存ファイルの中身の指紋。新しいファイルは `null`。 */
        readonly contentHash: string | null
      }
    | { readonly ok: false; readonly denial: AuditReason }
  > {
    if (target.state.kind === 'missing') {
      return Object.freeze({
        ok: true as const,
        text: '',
        encoding: 'utf8' as const,
        contentHash: null
      })
    }

    const current = await deps.readCurrent(target)

    if (!current.ok) {
      return Object.freeze({ ok: false as const, denial: current.denial })
    }

    return Object.freeze({
      ok: true as const,
      text: current.text,
      encoding: current.encoding,
      contentHash: current.contentHash
    })
  }

  function settle(proposalId: string): void {
    try {
      deps.notifySettled(proposalId)
    } catch {
      // 知らせられなかった。結論は変えない。
    }
  }

  return { write }
}

/**
 * v1 の File Write が扱える形か（Boundary が返した事実を読むだけ）。
 *
 * 書けない形なら理由を、書ける形なら `null` を返す。**Boundary の結果を
 * 読み替えることはしない** ── `aliased` / `missingSegments` は STEP2 が
 * ディスクを見て決めた事実にあたる。
 */
function checkTargetShape(target: VerifiedWorkspaceTarget): AuditReason | null {
  /*
    symlink / ジャンクション（や 8.3 の短い名前）を通した書き込みは拒否する
    （DESIGN.md §6.4。Workspace の中を指すものも含めて v1 では通さない）。
  */
  if (target.aliased) {
    return 'aliased-target'
  }

  switch (target.state.kind) {
    case 'file':
      // hard link は Policy（STEP1）が hard-link-write で拒む。ここでは形だけ見る。
      return null

    case 'missing':
      // 途中のディレクトリは作らない。既存のディレクトリの中の1件だけ許す。
      return target.state.missingSegments.length === 1 ? null : 'missing-directory'

    case 'directory':
      return 'not-a-file'
  }
}

/** 共有ロックを取る（STEP9）。**例外・形の違う返り値は「取れなかった」に倒す。** */
function acquireLock(deps: FileWriteGateDependencies): SideEffectAcquireResult {
  try {
    const result = deps.acquireSideEffect('file.write')

    if (result.ok) {
      return typeof result.lease?.release === 'function' ? result : LOCK_UNAVAILABLE
    }

    return result
  } catch {
    return LOCK_UNAVAILABLE
  }
}

const LOCK_UNAVAILABLE: SideEffectAcquireResult = Object.freeze({ ok: false, heldBy: null })

/** Policy が読めなければ、最も厳しい Policy として扱う（STEP1 / STEP5 / STEP6 と同じ倒し方）。 */
function readPolicy(deps: FileWriteGateDependencies): SecurityPolicy {
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
