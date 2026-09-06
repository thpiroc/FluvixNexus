import type { TextDocumentRange } from './document'

/**
 * Language Server から届いた指摘1件の形（Session 5-3）。
 *
 * ## なぜ shared に置くか
 *
 * 診断は **Main が受け取り、Renderer が描く**。間に境界が1つあるので、
 * 運ぶ値の形をどちらも同じに読む必要がある（shared/lsp/document.ts と同じ立ち位置）。
 *
 * ここに置くのは型と上限だけで、LSP も Monaco も import しない。
 *
 * ## 生の LSP の形をそのまま運ばない
 *
 * サーバが送ってくるのは JSON で、`severity` は 1〜4 の数、`code` は
 * 文字列にも数にもなり、`tags` も数の配列になる。**それを Renderer まで
 * 持ち込まない。**
 *
 * ```
 * サーバ            Main（正規化）        Renderer
 * severity: 1   →   'error'          →   MarkerSeverity.Error
 * code: 2304    →   '2304'           →   marker.code
 * tags: [1]     →   ['unnecessary']  →   MarkerTag.Unnecessary
 * ```
 *
 * 理由は2つある。
 *
 *   - **境界の外から届いた値**なので、どのみち Main で確かめる必要がある
 *     （main/lsp/publishDiagnostics.ts）。確かめたなら、確かめ終えた形で渡す
 *   - 数のままだと、Renderer 側で「LSP の 1 は error」という LSP の知識が要る。
 *     Renderer は URI も知らない層で、そこへ仕様の細部を持ち込まない
 *
 * ## 位置は 0 起点（document.ts と同じ）
 *
 * `TextDocumentRange` を使い回す。Monaco の 1 起点へ直すのは Renderer 側
 * （renderer/src/editor/lsp/diagnosticMarkers.ts）で、**変換の向きは
 * Session 5-2 と同じ1方向**に保つ。
 */

/**
 * 1つの文書に載せる指摘の数の上限。
 *
 * 上限があるのは、**これが境界の外から届く配列**であるため。
 * 設定を間違えたプロジェクト（`tsconfig.json` が壊れている等）では、
 * 1ファイルに数万件の指摘が付くことが実際にある。そのまま運ぶと
 * IPC の payload が膨らみ、Monaco も同じ数の marker を持つことになる。
 *
 * 溢れたぶんは捨てる ── **先頭から採る**ので、行の若い側から残る。
 * 数万件の状態で全部を出す意味は無く、上の方を直せば次の版で計算し直される。
 */
export const LSP_DIAGNOSTICS_MAX_PER_DOCUMENT = 1000

/** 1件の本文の長さの上限。これを超える指摘は切り詰める。 */
export const LSP_DIAGNOSTIC_MESSAGE_MAX_LENGTH = 2000

/**
 * 深刻度。
 *
 * LSP の 1〜4（Error / Warning / Information / Hint）に対応する。
 * **省略された場合は `error` として扱う**（仕様上はクライアントが決めてよい）。
 */
export type LspDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

/**
 * 指摘の種類を表す印。
 *
 * `unnecessary` は使われていないコード（薄く表示する）、
 * `deprecated` は非推奨（取り消し線）。どちらも Monaco が同じ意味の印を持つ。
 */
export type LspDiagnosticTag = 'unnecessary' | 'deprecated'

export interface LspDiagnostic {
  /** 指摘の範囲（0 起点・UTF-16 の符号単位）。 */
  readonly range: TextDocumentRange
  readonly severity: LspDiagnosticSeverity
  readonly message: string
  /**
   * どの道具が出した指摘か（`ts` / `pyright` など）。無ければ null。
   *
   * 画面では本文の脇に出る。**Monaco 内蔵の指摘と見分ける手掛かり**にもなるが、
   * 見分けを利用者の目に頼らないための仕組みは別にある
   * （marker の owner を分ける。renderer/src/editor/monaco/markers.ts）。
   */
  readonly source: string | null
  /** サーバが付けた番号や記号。数で来ても文字列にして運ぶ。無ければ null。 */
  readonly code: string | null
  readonly tags: readonly LspDiagnosticTag[]
}
