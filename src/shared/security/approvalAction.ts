/**
 * 承認の対象になる操作の種類（Security Core v1 の STEP6）。
 *
 * Main と Renderer の**両方**が読む。Renderer は「何の承認を求められているか」で
 * 表示を変えるため（File Write なら変更の内容、Terminal ならコマンド）、
 * 種類の名前だけを shared に置く。
 *
 * **判定はここに無い。** 承認してよいか・承認が成立したかを決めるのは Main だけで
 * （main/security/approval/）、ここにあるのは閉じた集合の名前と、その読み方まで。
 *
 * ## v1 で承認の対象になるもの
 *
 * ```
 * file.write    Workspace の中のファイルへ書き込む
 * terminal.run  Terminal でコマンドを実行する
 * ```
 *
 * **他の操作はここに足さない。** MCP の書き込み・Git の Commit / Push は v1 では
 * Policy（STEP1）が deny にするため、承認を求めるところまで進まない。外部 Provider への
 * 送信（STEP5）は承認の対象外（DESIGN.md §6.4）で、`external-send` にあたる名前も無い。
 * 種類を足すことは「承認さえ通れば実行できる操作」を増やすことにあたるため、
 * Policy 側の規則と対で見直す。
 */

/** 承認の対象になる操作の種類。 */
export type ApprovalActionKind = 'file.write' | 'terminal.run'

/** 承認の対象になる操作（名前順・凍結済み）。 */
export const APPROVAL_ACTION_KINDS: readonly ApprovalActionKind[] = Object.freeze([
  'file.write',
  'terminal.run'
])

/**
 * 承認の対象として知っている種類か。
 *
 * `Array.includes` で一覧と照らすだけで、`toString` のような prototype の名前は通らない。
 */
export function isApprovalActionKind(value: unknown): value is ApprovalActionKind {
  return typeof value === 'string' && (APPROVAL_ACTION_KINDS as readonly string[]).includes(value)
}
