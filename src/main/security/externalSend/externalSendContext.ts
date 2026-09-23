import { maskSecretText, SECRET_SCAN_MAX_CHARS } from '../secret/secretMasking'

/**
 * External Send Gate へ渡す**未検査の**Context（Security Core v1 の STEP5）。
 *
 * Electron にも fs にも依存しない。ここにあるのは「Agent / FN Engine が組み立てた、
 * まだ何も確かめていない材料」の形だけで、**この型のまま Provider へ渡せる経路は無い**
 * （Provider Adapter が受け取れるのは `SafeExternalPayload` だけ。safeExternalPayload.ts）。
 *
 * ```
 * Agent / FN Engine
 *   ↓ RawExternalSendRequest（この module）
 * External Send Gate（externalSendDecision.ts）
 *   ↓ SafeExternalPayload（Gate だけが作れる）
 * Provider Adapter
 * ```
 *
 * ## 種類は閉じた集合
 *
 * `kind` は下に並べたものだけ。**知らない種類は拒む**（`unknown-context-kind`）──
 * 自由文字列にすると、後から足した経路が Gate の知らない形で本文を載せられる。
 *
 * ここに **raw Terminal stdout / stderr・raw MCP input / output・File 全文を
 * 無制限に載せる種類は無い。** Terminal / MCP の生の出力は、要約（`tool-result` /
 * `mcp-read-result`）にしてから渡す ── 要約する責務は Agent / FN Engine 側にあり
 * （DESIGN.md §6.3 の Context の選択・最適化）、Gate は「渡された文字列を検査して
 * 伏せる」ところだけを持つ。Workspace のファイルは `workspace-file` として、
 * **Boundary（STEP2）が発行した対象と一緒に**渡す（workspaceFileContext.ts）。
 *
 * ## 上限は Security 上の上限であって、Token Budget ではない
 *
 * ここで決めるのは「**検査にかけてよい大きさ**」の上限で、Provider へ何文字送るのが
 * 妥当かという判断（Token Budget）は FN Engine が持つ（DESIGN.md §6.3）。Gate は
 * 安全側の天井だけを持ち、それを超えたものは縮めずに**拒む**（縮めると、落とした部分に
 * あった Secret が「検査した」ことになってしまう）。
 */

/** Context 1件の種類（閉じた集合）。 */
export type ExternalContextKind =
  /** 利用者が入力した指示。 */
  | 'user-prompt'
  /** Agent / System の指示文。 */
  | 'agent-instruction'
  /** Workspace の中のファイルの内容（Boundary が発行した対象が要る）。 */
  | 'workspace-file'
  /** Tool の実行結果の**要約**（raw stdout / stderr ではない）。 */
  | 'tool-result'
  /** MCP の読み取り結果の**要約**（raw input / output ではない）。 */
  | 'mcp-read-result'
  /** Error の1行の説明。 */
  | 'error-summary'

/** 知っている種類（名前順）。 */
export const EXTERNAL_CONTEXT_KINDS: readonly ExternalContextKind[] = Object.freeze([
  'agent-instruction',
  'error-summary',
  'mcp-read-result',
  'tool-result',
  'user-prompt',
  'workspace-file'
])

/** 1回の送信に載せられる Context の件数。 */
export const EXTERNAL_SEND_MAX_ITEMS = 256

/**
 * Context 1件の文字数の上限。
 *
 * **STEP3 の `SECRET_SCAN_MAX_CHARS`（1,000,000 文字）と同じ値にしてある** ──
 * 1件でこれを超えると、Masking が後ろを捨てて `truncated` を立てる（検査しきれない
 * 範囲が生まれる）。Gate はその状態を許さず、**超えた時点で拒む。**
 */
export const EXTERNAL_SEND_ITEM_MAX_CHARS = SECRET_SCAN_MAX_CHARS

/**
 * 1回の送信の合計の文字数の上限。
 *
 * 1件の上限と同じ値にしてある（件数を増やして合計で超える形も塞ぐ）。数えるのは
 * **伏せる前の**文字数で、伏せた後は `***REDACTED***`（14 文字）への置き換えにより
 * 最大でも 14/8 倍までしか増えない（8 文字未満の値は Secret として拾わない）。
 */
export const EXTERNAL_SEND_TOTAL_MAX_CHARS = SECRET_SCAN_MAX_CHARS

/** `label` の長さの上限（Workspace 相対のパスが入る。Audit の `workspacePath` と同じ）。 */
export const EXTERNAL_SEND_LABEL_MAX_LENGTH = 256

/** Provider の識別子の長さの上限。 */
export const EXTERNAL_PROVIDER_ID_MAX_LENGTH = 40

/**
 * Provider の識別子の形。
 *
 * **短い名前（`anthropic` / `openai-compatible`）だけ。** URL も API Key も Model の
 * 設定も通さない。Audit の `subject` に載る唯一の文字列にあたるため、ここで形を絞る
 * （載せる側でも Audit が Mask を通す。auditRecord.ts）。
 */
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Provider の識別子として受け付ける形か。
 *
 * 形が通っても、**STEP3 の検出が Secret と見なすものは受け付けない**
 * （`sk-ant-api03-…` のように、小文字とハイフンだけでできている API Key の形は
 * 上の正規表現を通ってしまう）。識別子は Audit の `subject` に載るため、
 * ここで落としておく。
 */
export function isExternalProviderId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= EXTERNAL_PROVIDER_ID_MAX_LENGTH &&
    PROVIDER_ID_PATTERN.test(value) &&
    !maskSecretText(value).secretsFound
  )
}

/** 知っている種類か。 */
export function isExternalContextKind(value: unknown): value is ExternalContextKind {
  return typeof value === 'string' && EXTERNAL_CONTEXT_KINDS.includes(value as ExternalContextKind)
}

/**
 * 未検査の Context 1件。
 *
 * **`sanitized` / `secretFree` のような「もう安全だ」と名乗る欄は無い。** 付けても
 * 読まれない ── Gate は渡された文字列を毎回自分で検査する。
 */
export interface RawExternalContextItem {
  readonly kind: ExternalContextKind
  /** 本文。空文字でもよい（空のファイルなど）。 */
  readonly text: string
  /** 何についての Context か（Tool 名・Workspace 相対のパス）。Provider へは渡るが Audit へは渡さない。 */
  readonly label?: string
  /**
   * `workspace-file` のときだけ渡す、**Boundary（STEP2）が発行した読み取りの対象。**
   * 同じ形に写したオブジェクトも、`{ insideWorkspace: true }` のような自己申告も通らない
   * （externalSendDecision.ts が `agentFileReadFacts` を通す）。
   */
  readonly source?: unknown
}

/** 未検査の送信1回ぶん。 */
export interface RawExternalSendRequest {
  readonly providerId: string
  readonly items: readonly RawExternalContextItem[]
}
