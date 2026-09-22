import { isAgentPermissionMode, type AgentPermissionMode } from '@shared/security'
import type { SecurityPolicy } from './securityPolicy'

/**
 * Security Decision（Security Core v1 の STEP1。Electron にも fs にも依存しない）。
 *
 * FN Agent の操作1件を、Policy と**固定の規則**に照らして
 * `allow`（そのまま実行してよい）/ `ask`（Main 側の承認が要る）/ `deny`（実行しない）の
 * どれかにする。後の STEP の各 Gate（File Write・Command Runner・MCP Gateway …）は
 * すべてここを通してから動く。
 *
 * ## 固定の規則（Policy では変えられない）
 *
 * | 操作                       | read（読み取り専用） | ask            |
 * | -------------------------- | -------------------- | -------------- |
 * | Workspace の中を読む       | allow                | allow          |
 * | Workspace の中へ書く       | deny                 | ask            |
 * | Terminal でコマンドを実行  | deny                 | ask（毎回）    |
 * | MCP の読み取り（Allowlist 済み） | allow          | allow          |
 * | MCP の読み取り（Allowlist 外）   | deny           | deny           |
 * | MCP の書き込み・副作用     | deny                 | deny           |
 * | Git の Commit / Push       | deny                 | deny           |
 * | Workspace の外（読み書きとも） | deny             | deny           |
 * | Secret ファイル（読み書きとも） | deny            | deny           |
 * | hard link を通した書き込み | deny                 | deny           |
 * | 知らない操作               | deny                 | deny           |
 *
 * **`ask` は「自動で許可する」ではない。** 承認を求めてよい、という意味で、
 * 実際に通すかは Main が保持する承認（Renderer の Diff ＋ Main の Native 確認。
 * 後の STEP の Approval Manager）が決める。承認の仕組みが無い間、`ask` の操作は
 * 実行できない。
 *
 * Secret ファイルを読む操作も拒むのは、Secret を Context から除く方針
 * （DESIGN.md §6.4）による。`.env.example` のような雛形を Secret ファイルと
 * 見なさないこと、本文の Secret を Mask することは Secret Detection（STEP3）が持つ。
 *
 * ## 事実は Main の Gate が確かめて渡す
 *
 * Workspace の中か・Secret ファイルか・hard link か、は**この関数では調べない。**
 * 調べるのは Main の Gate（Workspace Boundary・Secret Detection）で、ここは渡された
 * 事実を読むだけ。その代わり、**真偽値として確かめられていない事実は拒む側へ倒す**
 * ── `insideWorkspace` が `true` でなければ外、`secretFile` / `hardLink` が
 * `false` でなければ該当、と読む。欄を書き忘れた Gate は、許可ではなく拒否に行き着く。
 *
 * ## ここに無いもの
 *
 * Security Core を止める・規則を飛ばす・判定を上書きする引数も関数も無い。
 * 操作に余計な欄（`force` / `bypass` など）を付けても、読まれない。
 */

/** 判定の結論。 */
export type SecurityVerdict = 'allow' | 'ask' | 'deny'

/** 判定の理由（Audit Log・Activity の要約に使う。Secret も引数も含めない）。 */
export type SecurityDecisionReason =
  | 'read-allowed'
  | 'approval-required'
  | 'read-only-mode'
  | 'outside-workspace'
  | 'secret-file'
  | 'hard-link-write'
  | 'mcp-not-allowlisted'
  | 'mcp-allowlisted-read'
  | 'mcp-write-disabled'
  | 'git-not-available'
  | 'unknown-action'

export interface SecurityDecision {
  readonly verdict: SecurityVerdict
  readonly reason: SecurityDecisionReason
}

/** Workspace の中のファイル1件について、Main の Gate が確かめた事実。 */
export interface FileTargetFacts {
  /** 実体（realpath）が Workspace の中にあるか。 */
  readonly insideWorkspace: boolean
  /** Secret ファイル（`.env`・秘密鍵・資格情報など）か。 */
  readonly secretFile: boolean
}

/** 書き込み先について、Main の Gate が確かめた事実。 */
export interface FileWriteTargetFacts extends FileTargetFacts {
  /** hard link（リンク数が 2 以上）か。 */
  readonly hardLink: boolean
}

/** 判定する操作（閉じた集合。ここに無い種類は `unknown-action` で拒む）。 */
export type SecurityAction =
  | { readonly kind: 'file.read'; readonly target: FileTargetFacts }
  | { readonly kind: 'file.write'; readonly target: FileWriteTargetFacts }
  | { readonly kind: 'terminal.run' }
  | { readonly kind: 'mcp.read'; readonly allowlisted: boolean }
  | { readonly kind: 'mcp.write' }
  | { readonly kind: 'git.commit' }
  | { readonly kind: 'git.push' }

export type SecurityActionKind = SecurityAction['kind']

/** 知っている操作の種類。 */
export const SECURITY_ACTION_KINDS: readonly SecurityActionKind[] = Object.freeze([
  'file.read',
  'file.write',
  'terminal.run',
  'mcp.read',
  'mcp.write',
  'git.commit',
  'git.push'
])

/**
 * 操作1件を判定する。
 *
 * `policy` も `action` も型を名乗っているだけとして読む ── Permission が読めなければ
 * `read`、操作が読めなければ `unknown-action`。どちらも拒む側へ倒れる。
 */
export function decideSecurityAction(
  policy: SecurityPolicy,
  action: SecurityAction
): SecurityDecision {
  const mode = effectiveMode(policy)
  const raw: unknown = action

  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    return DECISIONS.unknownAction
  }

  switch (raw.kind) {
    case 'file.read':
      return decideFileRead(raw.target)

    case 'file.write':
      return decideFileWrite(mode, raw.target)

    case 'terminal.run':
      return mode === 'ask' ? DECISIONS.approvalRequired : DECISIONS.readOnly

    case 'mcp.read':
      // サーバーの自己申告（readOnlyHint など）ではなく、Security Core の Allowlist だけを見る。
      return raw.allowlisted === true ? DECISIONS.mcpAllowlistedRead : DECISIONS.mcpNotAllowlisted

    case 'mcp.write':
      return DECISIONS.mcpWriteDisabled

    case 'git.commit':
    case 'git.push':
      // Agent からは行わない。利用者が Git パネルから手動で操作する（DESIGN.md §6.4）。
      return DECISIONS.gitNotAvailable

    default:
      return DECISIONS.unknownAction
  }
}

function decideFileRead(target: unknown): SecurityDecision {
  if (!isRecord(target) || target.insideWorkspace !== true) {
    return DECISIONS.outsideWorkspace
  }

  if (target.secretFile !== false) {
    return DECISIONS.secretFile
  }

  return DECISIONS.readAllowed
}

/** 書き込みは、固定の規則をすべて通ってから Permission を見る（read なら拒む）。 */
function decideFileWrite(mode: AgentPermissionMode, target: unknown): SecurityDecision {
  if (!isRecord(target) || target.insideWorkspace !== true) {
    return DECISIONS.outsideWorkspace
  }

  if (target.hardLink !== false) {
    return DECISIONS.hardLinkWrite
  }

  if (target.secretFile !== false) {
    return DECISIONS.secretFile
  }

  return mode === 'ask' ? DECISIONS.approvalRequired : DECISIONS.readOnly
}

/** Policy が読めなければ、最も厳しい `read` として扱う（既定の `ask` へは倒さない）。 */
function effectiveMode(policy: unknown): AgentPermissionMode {
  const mode = isRecord(policy) ? policy.permissionMode : undefined

  return isAgentPermissionMode(mode) ? mode : 'read'
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decision(verdict: SecurityVerdict, reason: SecurityDecisionReason): SecurityDecision {
  return Object.freeze({ verdict, reason })
}

/** 返す判定はすべてここにある凍結済みの値（受け取った側が書き換えても効かない）。 */
const DECISIONS = Object.freeze({
  readAllowed: decision('allow', 'read-allowed'),
  approvalRequired: decision('ask', 'approval-required'),
  readOnly: decision('deny', 'read-only-mode'),
  outsideWorkspace: decision('deny', 'outside-workspace'),
  secretFile: decision('deny', 'secret-file'),
  hardLinkWrite: decision('deny', 'hard-link-write'),
  mcpAllowlistedRead: decision('allow', 'mcp-allowlisted-read'),
  mcpNotAllowlisted: decision('deny', 'mcp-not-allowlisted'),
  mcpWriteDisabled: decision('deny', 'mcp-write-disabled'),
  gitNotAvailable: decision('deny', 'git-not-available'),
  unknownAction: decision('deny', 'unknown-action')
})
