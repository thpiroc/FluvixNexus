import { decideSecurityAction } from '../policy/securityDecision'
import type { SecurityPolicy } from '../policy/securityPolicy'
import { agentFileReadFacts } from '../secret/secretFileFacts'
import { maskSecretText, type SecretMaskResult } from '../secret/secretMasking'
import { SECRET_CATEGORIES, type SecretCategory } from '../secret/secretPatterns'
import {
  EXTERNAL_SEND_ITEM_MAX_CHARS,
  EXTERNAL_SEND_LABEL_MAX_LENGTH,
  EXTERNAL_SEND_MAX_ITEMS,
  EXTERNAL_SEND_TOTAL_MAX_CHARS,
  isExternalContextKind,
  isExternalProviderId,
  type ExternalContextKind
} from './externalSendContext'
import {
  issueSafeExternalPayload,
  type ExternalSendNotice,
  type SafeExternalContextPart,
  type SafeExternalPayload
} from './safeExternalPayload'

/**
 * External Send Gate の判定（Security Core v1 の STEP5。Electron にも fs にも依存しない）。
 *
 * Agent / FN Engine が組み立てた未検査の Context を、**Provider へ渡す直前に Main 側で
 * もう一度検査して**、送ってよい Payload（`SafeExternalPayload`）にするか、拒むかを決める。
 *
 * ```
 * 1. 形      request / items / kind / text / label / source を1つずつ読む（型を名乗っているだけとして）
 * 2. 大きさ  件数・1件の文字数・合計の文字数（伏せる前）
 * 3. 実体    workspace-file は Boundary（STEP2）＋ Secret ファイルの判定（STEP3）＋ STEP1 を通す
 * 4. 伏せる  すべての本文と label を maskSecretText（STEP3）へ通す
 * 5. 発行    検査しきれた本文だけで SafeExternalPayload を作る
 * ```
 *
 * ## 何も信じない
 *
 * Renderer が名乗る「sanitized 済み」、Agent が名乗る「Secret なし」、LLM の判断、
 * MCP Server の自己申告、Renderer 側で伏せたという主張 ── **どれも読まない。**
 * 読む欄は上の5つだけで、それ以外の欄は付いていても捨てられる。
 *
 * ## 検査しきれなかった文字は送らない（fail closed）
 *
 * Masking が `unscanned` を立てた（検出が例外で落ちた）・`truncated` を立てた
 * （上限を超えて後ろを捨てた）・返り値の形が壊れている、のどれでも**その送信ごと拒む。**
 * 「伏せられなかった部分だけ落として残りを送る」形にはしない ── 落とした範囲に何が
 * あったか分からないまま、残りを「検査済み」として外へ出すことになるため。
 *
 * 例外が出たときも同じで、raw の Payload へ落ちる経路は無い（`gate-failed` で拒む）。
 */

/** 拒んだ理由（Audit の `AuditReason` に含まれる語だけを使う）。 */
export type ExternalSendDenial =
  /** 形が違う（object でない・text が文字列でない・label が長すぎる・余計な source がある）。 */
  | 'invalid-payload'
  /** Provider の識別子として受け付けない。 */
  | 'invalid-provider'
  /** 送るものが無い（items が空・本文がすべて空）。 */
  | 'empty-context'
  /** 知らない Context の種類。 */
  | 'unknown-context-kind'
  /** 件数・文字数の上限を超えた。 */
  | 'context-too-large'
  /** 送れない形の中身（binary など）。 */
  | 'unsupported-context'
  /** Secret ファイルの中身が含まれる（STEP3）。 */
  | 'secret-file'
  /** Workspace の外・Boundary が発行した対象ではない（STEP2）。 */
  | 'outside-workspace'
  /** Workspace の検証に必要な情報を安全に取れない。 */
  | 'unverifiable'
  /** 伏せる処理が最後まで通らなかった。 */
  | 'sanitize-failed'
  /** 判定の途中で例外が出た。 */
  | 'gate-failed'

/** 許可したときの理由（Audit に載せる語）。 */
export const EXTERNAL_SEND_ALLOWED_REASON = 'context-sanitized'

export type ExternalSendDecision =
  | {
      readonly decision: 'allow'
      readonly reason: typeof EXTERNAL_SEND_ALLOWED_REASON
      readonly payload: SafeExternalPayload
    }
  | { readonly decision: 'deny'; readonly reason: ExternalSendDenial }

/**
 * 送信1回ぶんを判定する。**例外を投げない。**
 *
 * `policy` は Main が保存から読み直した今の Policy（STEP1）。Permission は
 * **外部送信の可否そのものは変えない** ── `read`（読み取り専用）でも Agent は AI と
 * 対話できる必要があり、Permission が守るのは副作用のある操作（書き込み・コマンド実行）
 * にあたるため。Policy を渡しているのは、`workspace-file` の可否を STEP1 の
 * `decideSecurityAction` で決めるのと、Audit に効いていた Permission を残すため。
 */
export function decideExternalSend(policy: SecurityPolicy, request: unknown): ExternalSendDecision {
  try {
    return decide(policy, request)
  } catch {
    // 何が起きたか分からない。未検査の Payload を送る経路は作らない。
    return deny('gate-failed')
  }
}

function decide(policy: SecurityPolicy, request: unknown): ExternalSendDecision {
  if (!isRecord(request)) {
    return deny('invalid-payload')
  }

  const { providerId, items } = request

  if (!isExternalProviderId(providerId)) {
    return deny('invalid-provider')
  }

  if (!Array.isArray(items)) {
    return deny('invalid-payload')
  }

  if (items.length === 0) {
    return deny('empty-context')
  }

  if (items.length > EXTERNAL_SEND_MAX_ITEMS) {
    return deny('context-too-large')
  }

  const parts: SafeExternalContextPart[] = []
  const categories = new Set<SecretCategory>()
  let maskedCount = 0
  let userNoticeRequired = false
  let rawChars = 0

  for (const item of items) {
    const checked = checkItem(policy, item)

    if (!checked.ok) {
      return deny(checked.reason)
    }

    rawChars += checked.text.length + checked.label.length

    if (rawChars > EXTERNAL_SEND_TOTAL_MAX_CHARS) {
      return deny('context-too-large')
    }

    const text = sanitize(checked.text)

    if (text === null) {
      return deny('sanitize-failed')
    }

    let label: SecretMaskResult | null = null

    if (checked.label.length > 0) {
      label = sanitize(checked.label)

      if (label === null) {
        return deny('sanitize-failed')
      }
    }

    for (const result of label === null ? [text] : [text, label]) {
      maskedCount += result.maskedCount
      userNoticeRequired ||= result.userNoticeRequired

      for (const category of result.categories) {
        categories.add(category)
      }
    }

    parts.push(
      Object.freeze({
        kind: checked.kind,
        label: label === null ? null : label.text,
        text: text.text
      })
    )
  }

  if (rawChars === 0) {
    // 形は通ったが、送るものが1文字も無い。
    return deny('empty-context')
  }

  const notice: ExternalSendNotice = {
    secretsMasked: maskedCount > 0,
    maskedCount,
    categories: [...categories].sort(),
    userNoticeRequired
  }

  return Object.freeze({
    decision: 'allow' as const,
    reason: EXTERNAL_SEND_ALLOWED_REASON,
    payload: issueSafeExternalPayload(providerId, parts, notice)
  })
}

interface CheckedItem {
  readonly ok: true
  readonly kind: ExternalContextKind
  readonly text: string
  /** 空文字なら label 無し。 */
  readonly label: string
}

type ItemCheck = CheckedItem | { readonly ok: false; readonly reason: ExternalSendDenial }

/**
 * Context 1件を読む。
 *
 * `workspace-file` だけが `source` を持てる。他の種類に `source` が付いていれば拒む ──
 * 「ファイルの中身を `tool-result` として渡せば Boundary を通らない」形を作らないため、
 * 種類と検査の対応を1対1にしておく。
 */
function checkItem(policy: SecurityPolicy, item: unknown): ItemCheck {
  if (!isRecord(item)) {
    return { ok: false, reason: 'invalid-payload' }
  }

  const { kind, text, label, source } = item

  if (!isExternalContextKind(kind)) {
    return { ok: false, reason: 'unknown-context-kind' }
  }

  if (typeof text !== 'string') {
    return { ok: false, reason: 'invalid-payload' }
  }

  if (text.length > EXTERNAL_SEND_ITEM_MAX_CHARS) {
    return { ok: false, reason: 'context-too-large' }
  }

  if (label !== undefined && typeof label !== 'string') {
    return { ok: false, reason: 'invalid-payload' }
  }

  if (typeof label === 'string' && label.length > EXTERNAL_SEND_LABEL_MAX_LENGTH) {
    return { ok: false, reason: 'invalid-payload' }
  }

  if (kind !== 'workspace-file') {
    return source === undefined
      ? { ok: true, kind, text, label: label ?? '' }
      : { ok: false, reason: 'invalid-payload' }
  }

  const denial = checkWorkspaceSource(policy, source)

  return denial === null
    ? { ok: true, kind, text, label: label ?? '' }
    : { ok: false, reason: denial }
}

/**
 * Workspace のファイルを載せてよいか。
 *
 * **申告は読まない。** 読むのは Boundary（STEP2）が発行した対象だけで、そこから
 * `agentFileReadFacts`（STEP3）が事実を作り、`decideSecurityAction`（STEP1）が決める。
 * `{ insideWorkspace: true, secretFile: false }` のようなオブジェクトも、Boundary の
 * 対象を写したものも、`isVerifiedWorkspaceTarget` が偽になるため
 * `outside-workspace` に行き着く。
 */
function checkWorkspaceSource(policy: SecurityPolicy, source: unknown): ExternalSendDenial | null {
  const verdict = decideSecurityAction(policy, {
    kind: 'file.read',
    target: agentFileReadFacts(source)
  })

  if (verdict.verdict === 'allow') {
    return null
  }

  switch (verdict.reason) {
    case 'secret-file':
      return 'secret-file'

    case 'outside-workspace':
      return 'outside-workspace'

    default:
      // STEP1 が理由を足した場合も、外部送信では安全側へ倒す。
      return 'unverifiable'
  }
}

/**
 * 文字列1つを伏せる。**検査しきれなかったものは `null`。**
 *
 * 返り値の形まで見るのは、Masking が想定外の値を返したときに
 * 「伏せたことになっている未検査の文字」が先へ進まないようにするため。
 */
function sanitize(text: string): SecretMaskResult | null {
  const result: unknown = maskSecretText(text)

  if (!isMaskResult(result) || result.truncated || result.categories.includes('unscanned')) {
    return null
  }

  return result
}

function isMaskResult(value: unknown): value is SecretMaskResult {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.text === 'string' &&
    typeof value.secretsFound === 'boolean' &&
    typeof value.maskedCount === 'number' &&
    Number.isInteger(value.maskedCount) &&
    value.maskedCount >= 0 &&
    typeof value.userNoticeRequired === 'boolean' &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.categories) &&
    value.categories.every((category: unknown) =>
      SECRET_CATEGORIES.includes(category as SecretCategory)
    )
  )
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deny(reason: ExternalSendDenial): ExternalSendDecision {
  return DENIALS[reason]
}

const DENIALS: Readonly<Record<ExternalSendDenial, ExternalSendDecision>> = Object.freeze({
  'invalid-payload': frozenDenial('invalid-payload'),
  'invalid-provider': frozenDenial('invalid-provider'),
  'empty-context': frozenDenial('empty-context'),
  'unknown-context-kind': frozenDenial('unknown-context-kind'),
  'context-too-large': frozenDenial('context-too-large'),
  'unsupported-context': frozenDenial('unsupported-context'),
  'secret-file': frozenDenial('secret-file'),
  'outside-workspace': frozenDenial('outside-workspace'),
  unverifiable: frozenDenial('unverifiable'),
  'sanitize-failed': frozenDenial('sanitize-failed'),
  'gate-failed': frozenDenial('gate-failed')
})

function frozenDenial(reason: ExternalSendDenial): ExternalSendDecision {
  return Object.freeze({ decision: 'deny' as const, reason })
}
