import type { LanguageServerId } from './server'

/**
 * Language Server が今どうなっているか（Renderer へ渡す形。Session 5-4）。
 *
 * ## Renderer へ渡すのは、この2語だけ
 *
 * ```
 * 渡すもの     … 表の行の名前（typescript / python / csharp）と、下の状態1つ
 * 渡さないもの … 実行ファイル・引数・作業ディレクトリ・絶対パス・URI・pid・終了コード
 * ```
 *
 * 「立たなかった」ことは伝わるが、**何が立たなかったのかは伝わらない。**
 * 画面に出したいのは「TypeScript の言語機能が今使えるか」であって、
 * どの実行ファイルが PATH のどこに無かったか、ではない
 * ── 後者は Main のログの持ち物になる（main/lsp/languageServers.ts）。
 *
 * ## 状態は、既にある事実から**導く**
 *
 * Session 5-4 で新しい状態の持ち主は作っていない。下の5つは
 * main/lsp/languageServers.ts が既に持っているもの
 * （立っているサーバの表・`ready` の印・立て直し待ち・起動の結末）から
 * そのまま読めるもので、`disabled` だけが設定（shared/lsp/serverSettings.ts）
 * から乗る ── だから型も2段に分けてある。
 */

/**
 * プロセスとして今どうなっているか。
 *
 * ```
 * stopped     … 立っていない（まだ立てていない・終わらせた）
 * starting    … 立てたが、まだ話せない（initialize 待ち）／立て直し待ち
 * ready       … 電文を送れる
 * unavailable … 表にはあるが、この PC に入っていない
 * failed      … 立て続けに落ちたので、もう立て直さない／起動そのものに失敗した
 * ```
 *
 * `unavailable` と `failed` を分けてあるのは、**利用者の次の一手が違う**ため。
 * 前者は「入れれば使える」で、後者は「入っているが動かない」にあたる。
 */
export type LanguageServerRuntimeStatus =
  'stopped' | 'starting' | 'ready' | 'unavailable' | 'failed'

/** 画面に出す状態。プロセスの状態に、設定で切った状態（`disabled`）が乗る。 */
export type LanguageServerStatusId = LanguageServerRuntimeStatus | 'disabled'

/**
 * 並べる順（設定画面・ステータスバーの説明で使う）。
 *
 * 意味の重さの順ではない ── 重さの順は `summarizeLanguageServerStatuses` が持つ。
 */
export const LANGUAGE_SERVER_STATUS_IDS = [
  'disabled',
  'unavailable',
  'starting',
  'ready',
  'failed',
  'stopped'
] as const satisfies readonly LanguageServerStatusId[]

/** サーバ1本ぶんの状態。 */
export interface LanguageServerStatus {
  readonly serverId: LanguageServerId
  readonly status: LanguageServerStatusId
}

/**
 * プロセスの状態と設定から、画面に出す状態を決める。
 *
 * **設定で切ってあれば、プロセスの状態は見ない。** 切った直後はまだ
 * 終了処理の途中でありうるが、そこで一瞬 `stopped` や `starting` を出しても
 * 利用者に伝わるものが無い ── 押した操作の結果がそのまま出る方がよい。
 */
export function resolveLanguageServerStatus(
  runtime: LanguageServerRuntimeStatus,
  enabled: boolean
): LanguageServerStatusId {
  return enabled ? runtime : 'disabled'
}

/**
 * 複数のサーバの状態を、1つにまとめる（ステータスバー用）。
 *
 * ## 重い方を出す、ではなく「良い方」を先に出す
 *
 * 順序は `ready → starting → failed → unavailable → stopped → disabled`。
 * **1本でも答えているなら Ready と出す**のが要点にあたる ── Python が
 * 入っていない PC で TypeScript を書いている人に「Not installed」と
 * 出しても、その人の画面では診断が普通に出ている（嘘になる）。
 *
 * 逆に、どれも答えていない場合だけ理由が前に出る。そのとき知りたいのは
 * 「入れれば直るのか（`unavailable`）」「入っているのに動かないのか（`failed`）」で、
 * 落ちている方を先に出す。
 *
 * `disabled` が最後なのは、**言語ごとに切った場合に全体まで切れて見えない**
 * ようにするため。全部切ってあるときだけ、他の状態が1つも無いので
 * ここへ落ちてくる。
 */
export function summarizeLanguageServerStatuses(
  statuses: readonly LanguageServerStatus[]
): LanguageServerStatusId {
  const found = new Set(statuses.map((entry) => entry.status))

  for (const candidate of SUMMARY_ORDER) {
    if (found.has(candidate)) {
      return candidate
    }
  }

  // 1本も無い（まだ状態が届いていない）。立っていないのと同じ扱いで足りる。
  return 'stopped'
}

/** まとめるときの重さの順（上記）。 */
const SUMMARY_ORDER = [
  'ready',
  'starting',
  'failed',
  'unavailable',
  'stopped',
  'disabled'
] as const satisfies readonly LanguageServerStatusId[]
