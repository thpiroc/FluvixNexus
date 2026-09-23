import { isAgentPermissionMode, type AgentPermissionMode } from '@shared/security'
import type { WorkspaceBoundaryDenial } from '../boundary/workspaceBoundary'
import {
  SECURITY_ACTION_KINDS,
  type SecurityActionKind,
  type SecurityDecisionReason,
  type SecurityVerdict
} from '../policy/securityDecision'
import type { SecretCategory } from '../secret/secretPatterns'

/**
 * Security Audit Event の型（Security Core v1 の STEP4。Electron にも fs にも依存しない）。
 *
 * Audit Log は「FN Agent / Security Core が**何を通し、何を拒んだか**」を後から辿るためのもので、
 * 通常のログ（main/logger/）とは目的が違う ── あちらは不具合を追うための出力で、こちらは
 * Security 上の判断の記録にあたる。同じファイル・同じ API へは寄せない（DESIGN.md §6.4）。
 *
 * ## 種別は閉じた集合
 *
 * `type` は**ここに並べたものだけ。** Renderer / Agent から自由文字列の event 名を受け取る
 * 設計にはしない ── 名前を自由にできると、Activity や後の集計が「知らない種別」を
 * 数え落とすか、偽の種別で埋められる。知らない種別が来たときは、その種別として
 * 記録せず `audit.unrecognized-event` に倒す（auditRecord.ts）。
 *
 * ## 生の Secret を持てない形にする
 *
 * 欄はほとんどが**閉じた集合の値・数・真偽値**で、文字列を取るのは3つだけ。
 *
 * ```
 * subject        Tool 名・設定の key のような短い名前（引数・本文は入れない）
 * workspacePath  Workspace root からの相対位置（絶対パスは入れない）
 * error          Error そのもの（Audit 側が describeErrorWithoutSecrets を通す）
 * ```
 *
 * この3つも「呼び出し側が安全にして渡す」ことは当てにしない。書き込みの直前に
 * Audit 自身が Mask する（auditRecord.ts の sanitizeAuditEvent が最終の境界）。
 *
 * **Prompt 全文・ファイル全文・Terminal の出力・MCP の raw input / output・Provider への
 * 要求と応答を入れる欄は、型にも無い。** 「デバッグのため」でも足さない。
 */

/** 判定の結論。STEP1 の Security Decision と同じ語を使う。 */
export type AuditDecision = SecurityVerdict

/** 操作の結果。 */
export type AuditOutcome = 'success' | 'failure'

/** 記録の分類（Activity の絞り込みに使える粒度）。 */
export type AuditCategory =
  | 'policy'
  | 'boundary'
  | 'secret'
  | 'external-send'
  | 'approval'
  | 'file-write'
  | 'terminal'
  | 'mcp-tool'
  | 'security-settings'
  /** Audit 自身のこと（記録できなかった・知らない種別が来た）。 */
  | 'audit'

/**
 * 記録する種別（閉じた集合）。
 *
 * STEP5 以降で実際に記録する側を作る。ここに並んでいることは「その機能がある」ことを
 * 意味しない ── 後の STEP が同じ語で記録できるように、名前だけ先に決めてある。
 */
export type AuditEventType =
  /** Security Decision（STEP1）が allow / ask / deny を決めた。 */
  | 'policy.decided'
  /** Workspace Boundary（STEP2）が拒んだ。 */
  | 'boundary.denied'
  /** Secret Detection（STEP3）が本文の一部を伏せた。 */
  | 'secret.masked'
  /** 外部 Provider への送信（STEP5）。 */
  | 'external-send.allowed'
  | 'external-send.denied'
  /** 承認（STEP6）。 */
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.denied'
  /** File Write Gate（STEP7）。 */
  | 'file-write.requested'
  | 'file-write.approved'
  | 'file-write.denied'
  | 'file-write.failed'
  /** Terminal / Command Runner。 */
  | 'terminal.requested'
  | 'terminal.approved'
  | 'terminal.denied'
  | 'terminal.failed'
  /** MCP Gateway。 */
  | 'mcp-tool.requested'
  | 'mcp-tool.allowed'
  | 'mcp-tool.denied'
  | 'mcp-tool.failed'
  /** Security 設定が変わった。 */
  | 'security-settings.changed'

/** Audit 自身が付ける種別。**呼び出し側からは渡せない**（`AuditEvent['type']` に無い）。 */
export type AuditInternalEventType = 'audit.unrecognized-event'

/** Log に現れる種別。 */
export type AuditRecordEventType = AuditEventType | AuditInternalEventType

/**
 * 種別 → 分類。
 *
 * `Record` で受けているため、種別を足してここへ書き忘れると型検査で落ちる
 * （分類の無い種別が Log に現れない）。**Audit 自身の種別はここに無い** ──
 * 呼び出し側から名乗られても、知らない種別として扱うため。
 */
const CATEGORY_OF_EVENT: Readonly<Record<AuditEventType, AuditCategory>> = Object.freeze({
  'policy.decided': 'policy',
  'boundary.denied': 'boundary',
  'secret.masked': 'secret',
  'external-send.allowed': 'external-send',
  'external-send.denied': 'external-send',
  'approval.requested': 'approval',
  'approval.approved': 'approval',
  'approval.denied': 'approval',
  'file-write.requested': 'file-write',
  'file-write.approved': 'file-write',
  'file-write.denied': 'file-write',
  'file-write.failed': 'file-write',
  'terminal.requested': 'terminal',
  'terminal.approved': 'terminal',
  'terminal.denied': 'terminal',
  'terminal.failed': 'terminal',
  'mcp-tool.requested': 'mcp-tool',
  'mcp-tool.allowed': 'mcp-tool',
  'mcp-tool.denied': 'mcp-tool',
  'mcp-tool.failed': 'mcp-tool',
  'security-settings.changed': 'security-settings'
})

/** Audit 自身が付ける種別と、その分類。 */
export const AUDIT_UNRECOGNIZED_EVENT = 'audit.unrecognized-event' satisfies AuditInternalEventType
export const AUDIT_INTERNAL_CATEGORY = 'audit' satisfies AuditCategory

/** 記録を頼むときに使える種別（名前順）。Audit 自身の種別は含まない。 */
export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = Object.freeze(
  (Object.keys(CATEGORY_OF_EVENT) as AuditEventType[]).sort()
)

/**
 * 記録してよい理由。
 *
 * STEP1 の `SecurityDecisionReason`・STEP2 の `WorkspaceBoundaryDenial` を**そのまま**使う
 * （Audit のためだけの別の語彙を作ると、判定した理由と記録した理由がずれる）。
 * どちらも Secret も引数も含まない閉じた集合として作られている。
 */
export type AuditReason =
  | SecurityDecisionReason
  | WorkspaceBoundaryDenial
  /** 知らない種別の event が届いた。 */
  | 'unrecognized-event'
  /** 記録する値を安全にできなかった。 */
  | 'sanitize-failed'
  /** 1 件が大きすぎて、最小限の記録へ落とした。 */
  | 'record-too-large'
  /** External Send Gate（STEP5）が検査を通して送った。 */
  | 'context-sanitized'
  /** Payload の形が違う。 */
  | 'invalid-payload'
  /** Provider の識別子として受け付けない。 */
  | 'invalid-provider'
  /** 送るものが無い。 */
  | 'empty-context'
  /** 知らない Context の種類。 */
  | 'unknown-context-kind'
  /** Context が上限を超えている。 */
  | 'context-too-large'
  /** 送れない形の中身（binary など）。 */
  | 'unsupported-context'
  /** Gate の処理の途中で例外が出た。 */
  | 'gate-failed'
  /** Approval Manager（STEP6）: 利用者が Main の Native 確認で承認した。 */
  | 'user-approved'
  /** 利用者が取り消した（Renderer の取り消し・Native の取り消し・× で閉じた）。 */
  | 'user-cancelled'
  /** 有効期限を過ぎていた。 */
  | 'approval-expired'
  /** その承認が無い（知らない id・すでに片付いた）。 */
  | 'approval-not-found'
  /** すでに1回使われている。 */
  | 'approval-already-used'
  /** その承認の今の状態では行えない（未承認のまま consume・確認中に再度続行）。 */
  | 'approval-state-invalid'
  /** 承認したときと、実行しようとしているものが違う。 */
  | 'binding-mismatch'
  /** fingerprint を作れなかった。 */
  | 'fingerprint-failed'
  /** Native の確認を出せなかった。 */
  | 'dialog-failed'
  /** 確認を出すウィンドウが無い / 失われた。 */
  | 'window-unavailable'

/**
 * 理由の一覧。
 *
 * `Record<AuditReason, true>` で受けているため、STEP1 / STEP2 が理由を足すと
 * **ここが型検査で落ちる** ── 知らない理由が `null` になって消えることを防ぐ。
 */
const KNOWN_REASONS: Readonly<Record<AuditReason, true>> = Object.freeze({
  // STEP1（securityDecision.ts）
  'read-allowed': true,
  'approval-required': true,
  'read-only-mode': true,
  'outside-workspace': true,
  'secret-file': true,
  'hard-link-write': true,
  'mcp-not-allowlisted': true,
  'mcp-allowlisted-read': true,
  'mcp-write-disabled': true,
  'git-not-available': true,
  'unknown-action': true,
  // STEP2（workspaceBoundary.ts）
  'invalid-request': true,
  'no-workspace': true,
  'invalid-path': true,
  'not-found': true,
  'not-a-file': true,
  'parent-not-directory': true,
  'unsupported-type': true,
  'dangling-link': true,
  unverifiable: true,
  'target-changed': true,
  // STEP4（この module）
  'unrecognized-event': true,
  'sanitize-failed': true,
  'record-too-large': true,
  // STEP5（externalSend/externalSendDecision.ts）
  'context-sanitized': true,
  'invalid-payload': true,
  'invalid-provider': true,
  'empty-context': true,
  'unknown-context-kind': true,
  'context-too-large': true,
  'unsupported-context': true,
  'gate-failed': true,
  // STEP6（approval/approvalManager.ts）
  'user-approved': true,
  'user-cancelled': true,
  'approval-expired': true,
  'approval-not-found': true,
  'approval-already-used': true,
  'approval-state-invalid': true,
  'binding-mismatch': true,
  'fingerprint-failed': true,
  'dialog-failed': true,
  'window-unavailable': true
})

/** 知っている理由（名前順）。 */
export const AUDIT_REASONS: readonly AuditReason[] = Object.freeze(
  (Object.keys(KNOWN_REASONS) as AuditReason[]).sort()
)

/**
 * 記録を頼む側が渡すもの。
 *
 * `type` 以外はすべて任意で、**分かっている安全な metadata だけ**を渡す。
 * 渡した値が閉じた集合から外れていれば、その欄は記録されない（捨てられる）。
 */
export interface AuditEvent {
  readonly type: AuditEventType
  /** allow / ask / deny。 */
  readonly decision?: AuditDecision
  /** なぜそう決めたか。 */
  readonly reason?: AuditReason
  /** 実際に行った操作が成功したか。 */
  readonly outcome?: AuditOutcome
  /** 判定にかけた操作の種類（STEP1）。 */
  readonly actionKind?: SecurityActionKind
  /** そのとき効いていた Permission。 */
  readonly permissionMode?: AgentPermissionMode
  /**
   * 対象を指す**短い名前だけ**（MCP の Tool 名・設定の key・Provider 名。最大 120 文字）。
   *
   * **Prompt 本文・ファイル本文・Terminal の stdout / stderr・MCP Tool の raw input /
   * output・Provider の request / response をここへ入れることは禁止する**
   * （DESIGN.md §6.4。2026-09-23 確定）。縮めて入れる、もしない ── 本文を載せられる欄が
   * 1つでもあれば、Audit Log はいずれ本文の置き場所になるため。
   */
  readonly subject?: string
  /**
   * Workspace root からの相対位置だけ（最大 256 文字）。**絶対パスは渡さない**
   * （渡っても記録側で `<path>` へ伏せる）。
   */
  readonly workspacePath?: string
  /** 伏せたものの種別（STEP3 の `SecretMaskResult.categories`）。 */
  readonly secretCategories?: readonly SecretCategory[]
  /** 伏せた箇所の数（STEP3 の `SecretMaskResult.maskedCount`）。 */
  readonly maskedCount?: number
  /** 利用者へ知らせるべきか（STEP3 の `SecretMaskResult.userNoticeRequired`）。 */
  readonly userNoticeRequired?: boolean
  /** 失敗した原因。**Audit 側が Secret を除いた1行にする**（呼び出し側で整形しない）。 */
  readonly error?: unknown
}

/**
 * 種別に対する分類。**知らない種別と Audit 自身の種別は `null`。**
 *
 * `Object.hasOwn` で見るのは、`toString` のような prototype の名前を
 * 「知っている種別」と読まないため。
 */
export function auditEventCategory(type: unknown): AuditCategory | null {
  if (typeof type !== 'string' || !Object.hasOwn(CATEGORY_OF_EVENT, type)) {
    return null
  }

  return CATEGORY_OF_EVENT[type as AuditEventType]
}

/** 知っている理由か。 */
export function isAuditReason(value: unknown): value is AuditReason {
  return typeof value === 'string' && Object.hasOwn(KNOWN_REASONS, value)
}

/** 知っている判定か。 */
export function isAuditDecision(value: unknown): value is AuditDecision {
  return value === 'allow' || value === 'ask' || value === 'deny'
}

/** 知っている結果か。 */
export function isAuditOutcome(value: unknown): value is AuditOutcome {
  return value === 'success' || value === 'failure'
}

/** 知っている操作の種類か（STEP1 の一覧で確かめる）。 */
export function isAuditActionKind(value: unknown): value is SecurityActionKind {
  return typeof value === 'string' && SECURITY_ACTION_KINDS.includes(value as SecurityActionKind)
}

/** 知っている Permission か（@shared/security の判定をそのまま使う）。 */
export function isAuditPermissionMode(value: unknown): value is AgentPermissionMode {
  return isAgentPermissionMode(value)
}
