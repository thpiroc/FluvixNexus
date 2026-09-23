import type { SecretCategory } from '../secret/secretPatterns'
import type { ExternalContextKind } from './externalSendContext'

/**
 * Gate を通った後の Payload（Security Core v1 の STEP5。Electron にも fs にも依存しない）。
 *
 * **Provider Adapter が受け取ってよいのはこの型だけ。** 未検査の
 * `RawExternalSendRequest` を直に受け取る Adapter は作らない（externalSendGate.ts が
 * Adapter を呼ぶ側になっており、Adapter に渡るのはここで発行した Payload に限られる）。
 *
 * ## 偽造できない形にする（2つ重ねる）
 *
 * ```
 * 型   … 外へ出していない unique symbol を欄に持つ。外の module はその名前を書けないため、
 *        同じ形のオブジェクトリテラルを SafeExternalPayload として通せない
 * 実行 … この module が発行したものだけを WeakSet で覚える（isSafeExternalPayload）
 * ```
 *
 * **型だけでは Security Boundary にならない。** `as` ひとつで名乗れてしまううえ、
 * IPC・JSON を通ったオブジェクトには型が残らない。送信の直前に必ず
 * `isSafeExternalPayload()` で確かめる（externalSendGate.ts）。
 *
 * ## 1回きり
 *
 * 発行した Payload は、Provider Adapter へ渡した後に**取り消す**
 * （`revokeSafeExternalPayload`）。取り消した後の `isSafeExternalPayload` は偽になり、
 * 同じ Payload を別の送信へ使い回すことはできない ── 使い回せると、1度 Gate を通した
 * Payload が「検査済みの入れ物」として後から中身を運ぶ形が生まれる。
 *
 * ## Secret の値は入らない
 *
 * `text` は伏せた後の本文だけ。`notice` が持つのは「あったか・いくつか・どの種類か・
 * 知らせるべきか」までで、**元の Secret の値を持つ欄は型にも無い**（STEP3 と同じ）。
 * Provider Credential（API Key）もここには入らない ── 認証は Adapter が Header で
 * 行うもので、Context とは別物にあたる（DESIGN.md §6.4）。
 */

/** この module の外では書けない印（値としては存在しない。実行時の確認は WeakSet が行う）。 */
declare const safeExternalPayloadBrand: unique symbol

/** 利用者へ「一部を伏せた」と知らせるための metadata（値は含まない）。 */
export interface ExternalSendNotice {
  /** 1つでも伏せたか。 */
  readonly secretsMasked: boolean
  /** 伏せた箇所の数。 */
  readonly maskedCount: number
  /** 伏せたものの種別（重複なし・名前順）。 */
  readonly categories: readonly SecretCategory[]
  /** 利用者へ知らせるべきか（STEP3 の `userNoticeRequired` をそのまま畳んだもの）。 */
  readonly userNoticeRequired: boolean
}

/** 送ってよい Context 1件。 */
export interface SafeExternalContextPart {
  readonly kind: ExternalContextKind
  readonly label: string | null
  /** 伏せた後の本文。 */
  readonly text: string
}

/** Gate を通った Payload。 */
export interface SafeExternalPayload {
  /** この印は外の module からは書けない（偽造の型検査での歯止め）。 */
  readonly [safeExternalPayloadBrand]: true
  readonly providerId: string
  readonly parts: readonly SafeExternalContextPart[]
  /** 伏せた後の合計の文字数。 */
  readonly totalChars: number
  readonly notice: ExternalSendNotice
}

/** この module が発行し、まだ使われていない Payload。 */
const issued = new WeakSet<object>()

/** Gate が組み立てた中身を、送ってよい Payload として発行する（この folder の中だけで呼ぶ）。 */
export function issueSafeExternalPayload(
  providerId: string,
  parts: readonly SafeExternalContextPart[],
  notice: ExternalSendNotice
): SafeExternalPayload {
  const frozenParts = Object.freeze(
    parts.map((part) => Object.freeze({ kind: part.kind, label: part.label, text: part.text }))
  )

  const payload = Object.freeze({
    providerId,
    parts: frozenParts,
    totalChars: frozenParts.reduce((total, part) => total + part.text.length, 0),
    notice: Object.freeze({
      secretsMasked: notice.secretsMasked,
      maskedCount: notice.maskedCount,
      categories: Object.freeze([...notice.categories]),
      userNoticeRequired: notice.userNoticeRequired
    })
  }) as SafeExternalPayload

  issued.add(payload)

  return payload
}

/**
 * Gate が発行し、まだ使われていない Payload か。
 *
 * **Provider Adapter は、送る直前にこれで確かめる。** 手で組んだオブジェクト・
 * 写し（`{ ...payload }`）・JSON を通したもの・prototype に据えたものは、すべて偽になる。
 */
export function isSafeExternalPayload(value: unknown): value is SafeExternalPayload {
  return typeof value === 'object' && value !== null && issued.has(value)
}

/** 使い終わった Payload を取り消す（以後 `isSafeExternalPayload` は偽になる）。 */
export function revokeSafeExternalPayload(payload: unknown): void {
  if (typeof payload === 'object' && payload !== null) {
    issued.delete(payload)
  }
}
