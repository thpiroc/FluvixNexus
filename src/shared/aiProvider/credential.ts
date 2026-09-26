import type { SupportedProviderId } from './providers'

/**
 * AI Provider の API Key（Credential）について、Renderer が知ってよいこと（STEP10-5）。
 *
 * ## Key は入れる方向にしか流れない
 *
 * ```
 * Renderer → Main   新しい Key（設定 / 置き換え）・消して・設定済みか
 * Main → Renderer   設定済みか（下の3つの状態）・この PC で保存できるか・保存の結末の分類
 * ```
 *
 * **保存した Key を Renderer へ返す口は無い**（取得・読み出し・復号・書き出しのどれも）。
 * 状態にも Key の長さ・先頭・末尾・伏せ字の数のような、Key から推し量れるものは載せない。
 * 変えたいときは新しい Key を入れて置き換える。
 */

/**
 * 保存した Key の状態。
 *
 * ```
 * set        保存してあり、この PC で復号できて、形も通る
 * not-set    保存していない
 * unusable   保存はあるが使えない（ファイルが壊れている・版や Provider が読めない・復号できない・
 *            この PC で OS の暗号化が使えない）。新しい Key で置き換えるか、削除する
 * ```
 *
 * `unusable` の中身（どう壊れていたか・OS の Error の本文）は Renderer へ渡さない。
 */
export type AiProviderCredentialState = 'set' | 'not-set' | 'unusable'

export interface AiProviderCredentialStatus {
  readonly providerId: SupportedProviderId
  readonly state: AiProviderCredentialState
  /** この PC で Key を暗号化して保存できるか（OS の暗号化が使えるか）。 */
  readonly canStore: boolean
}

/**
 * 保存・削除できなかった理由（閉じた集合）。
 *
 * ```
 * encryption-unavailable  この PC では OS の暗号化が使えない・暗号化に失敗した（平文では保存しない）
 * value-invalid           Key の形が通らない（空・長すぎる・空白や制御文字を含む）
 * write-failed            ファイルへ書けなかった・消せなかった
 * ```
 */
export type AiProviderCredentialFailure =
  'encryption-unavailable' | 'value-invalid' | 'write-failed'

export type AiProviderCredentialResult =
  | { readonly ok: true; readonly status: AiProviderCredentialStatus }
  | {
      readonly ok: false
      readonly failure: AiProviderCredentialFailure
      readonly status: AiProviderCredentialStatus
    }

/**
 * Key の文字数の上限。今の OpenAI の Key は 200 文字に満たない。これを超えるものは
 * Key ではない何か（誤って貼った文章など）として受け付けない。
 */
export const AI_PROVIDER_API_KEY_MAX_LENGTH = 1024

/**
 * 入力された Key を、保存してよい形として読む。通らなければ null。
 *
 * - 前後の空白・改行は落とす（貼り付けで付いてくる）
 * - 中に空白・制御文字・ASCII の外の文字があれば通さない（Header に載せられない）
 * - 形の先頭（`sk-` など）は見ない ── Provider ごとの Key の形は STEP10-6 の Adapter が決める
 *
 * Renderer の事前の案内と Main の再検証が同じこの関数を通る（Main は Renderer の検証を信じない）。
 * **値を Error・ログに含めない**（返すのは読めた値か null だけ）。
 */
export function readAiProviderApiKey(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > AI_PROVIDER_API_KEY_MAX_LENGTH * 2) {
    return null
  }

  const value = raw.trim()

  if (value.length === 0 || value.length > AI_PROVIDER_API_KEY_MAX_LENGTH) {
    return null
  }

  // 表示できる ASCII（! 〜 ~）だけ。空白・制御文字・全角は Key に含まれない。
  return /^[\x21-\x7e]+$/.test(value) ? value : null
}
