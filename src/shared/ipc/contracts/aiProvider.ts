import type {
  AiProviderCredentialResult,
  AiProviderCredentialStatus
} from '../../aiProvider/credential'
import type { SupportedProviderId } from '../../aiProvider/providers'

/**
 * ai-provider ドメインの IPC 契約（FN Agent の AI Provider の API Key。STEP10-5）。
 *
 * ## 3本だけ
 *
 * ```
 * ai-provider:has-credential     Key が設定済みか（状態だけ。Key は返さない）
 * ai-provider:set-credential     Key を設定 / 置き換える（Renderer → Main の一方向）
 * ai-provider:delete-credential  Key を消す
 * ```
 *
 * **Key を Renderer へ返すチャンネルは無い**（取得・読み出し・復号・書き出しのどれも）。
 * 応答に載るのは状態（設定済み / 未設定 / 使えない）・保存できるか・失敗の分類だけで、Key の
 * 長さ・先頭・末尾・伏せ字も載らない。Endpoint を変える口・任意の名前の Credential を扱う口・
 * Credential Store そのものへ届く口も無い。
 *
 * ## Provider は閉じた集合の名前だけ
 *
 * 要求の `providerId` は正式な Provider（`SupportedProviderId`。今は `openai` だけ）でなければ
 * Main が INVALID_REQUEST で拒む（`scripted`・任意の文字列を含む）。Key の形も Main が
 * 確かめ直す（Renderer の検証は信じない）。
 *
 * Provider / Model の**選択**はここではなく設定の `aiProvider` section（ユーザー設定だけ）が持ち、
 * 既存の `settings:save-section` で保存する。
 */

export interface AiProviderCredentialRequest {
  readonly providerId: SupportedProviderId
}

export interface SetAiProviderCredentialRequest {
  readonly providerId: SupportedProviderId
  /** 新しい Key。保存した後、Main も Renderer もこの値を持ち続けない。 */
  readonly apiKey: string
}

export interface AiProviderIpcContract {
  'ai-provider:has-credential': {
    request: AiProviderCredentialRequest
    response: AiProviderCredentialStatus
  }
  'ai-provider:set-credential': {
    request: SetAiProviderCredentialRequest
    response: AiProviderCredentialResult
  }
  'ai-provider:delete-credential': {
    request: AiProviderCredentialRequest
    response: AiProviderCredentialResult
  }
}
