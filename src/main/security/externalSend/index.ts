/**
 * External Send Gate の API（Security Core v1 の STEP5）。
 *
 * FN Agent / FN Engine が組み立てた Context を、**外部 AI Provider へ渡す直前に
 * Main 側でもう一度検査して伏せる**、最後の境界。
 *
 * ```
 * Agent / FN Engine
 *   ↓ RawExternalSendRequest（未検査。ここから先へはそのまま進めない）
 * sendThroughExternalGate()        Policy（STEP1）→ Boundary（STEP2）→ Secret（STEP3）→ Audit（STEP4）
 *   ↓ SafeExternalPayload（Gate だけが作れる・1回きり）
 * Provider Adapter                 受け取れるのはこの型だけ
 * ```
 *
 * ```
 * sendThroughExternalGate(request, deliver)  送信1回。allow のときだけ deliver を呼ぶ
 * workspaceFileContext(target, bytes)        Workspace のファイルを Context にする接続点
 * isSafeExternalPayload(value)               Adapter が送る直前に確かめる実行時の検査
 * EXTERNAL_CONTEXT_KINDS                     載せられる Context の種類（閉じた集合）
 * ```
 *
 * ## ここに無いもの
 *
 * **検査を飛ばす・判定を上書きする・未検査の Payload を送る API は無い。**
 * `externalSendUnsafe()`・`skipSecurity`・`bypassGate`・`alreadySanitized`・
 * `trustRenderer` にあたるものは、引数にも返り値にも無い。Safe Payload を作るだけの
 * 関数も公開しない ── 作って返せば、その Payload を後から別の送信へ使い回せるため、
 * 作ると送るは1つの呼び出しの中で完結させる。
 *
 * **Renderer へ公開する IPC も Preload の API も作らない**（externalSendSurface.test.ts が
 * 見ている）。Provider Credential（API Key）はここを通らない ── 認証は Adapter が
 * Header で行うもので、Context とは別物にあたる。
 *
 * 公開する名前は externalSendSurface.test.ts が固定している。
 */
export { sendThroughExternalGate } from './currentExternalSendGate'
export {
  EXTERNAL_CONTEXT_KINDS,
  EXTERNAL_PROVIDER_ID_MAX_LENGTH,
  EXTERNAL_SEND_ITEM_MAX_CHARS,
  EXTERNAL_SEND_LABEL_MAX_LENGTH,
  EXTERNAL_SEND_MAX_ITEMS,
  EXTERNAL_SEND_TOTAL_MAX_CHARS
} from './externalSendContext'
export { isSafeExternalPayload } from './safeExternalPayload'
export { workspaceFileContext } from './workspaceFileContext'

export type {
  ExternalContextKind,
  RawExternalContextItem,
  RawExternalSendRequest
} from './externalSendContext'
export type { ExternalSendDenial } from './externalSendDecision'
export type { ExternalSendDelivery, ExternalSendOutcome } from './externalSendGate'
export type {
  ExternalSendNotice,
  SafeExternalContextPart,
  SafeExternalPayload
} from './safeExternalPayload'
export type { WorkspaceFileContextResult } from './workspaceFileContext'
