import { resolveLspDocumentLanguage } from './documentLanguage'
import { getOpenLspDocument } from './documentSync'
import { resolveWorkspaceDocumentUri } from './documentUri'
import type { LanguageServerId } from './languageServerCatalog'
import { isLanguageServerAllowed } from './languageServerSettings'
import { supportsLanguageServerFeature } from './languageServers'
import type { LanguageServerFeature } from './serverCapabilities'
import type { TextDocumentPosition } from '@shared/lsp'

/**
 * 「この文書へこの要求を出してよいか」を1箇所で確かめる（Session 5-10）。
 *
 * ## 5つの機能が同じ6段を踏んでいた
 *
 * Session 5-5 〜 5-9 で足した補完・Hover・定義 / 参照・整形・Rename は、
 * どれも要求を出す前にまったく同じことを確かめていた。
 *
 * ```
 * 1. Workspace が開いているか
 * 2. 相対位置が Workspace の中か        → 外なら outside-workspace
 * 3. その拡張子に担当サーバがあるか
 * 4. その言語が設定で切られていないか
 * 5. その文書をサーバへ伝え終えているか
 * 6. Renderer が見ている版と同じか      → 違えば stale
 * ```
 *
 * 5つのファイルに同じ判断が5回あると、**足りない行がどこかにできる**
 * ── 実際 3 は「TypeScript か」を直に書いていたので、Python を足すには
 * 5箇所を同じように直す必要があった。Session 5-10 でそれを1つにまとめ、
 * **言語を増やしても触るのはこのファイルだけ**にしてある。
 *
 * ## サーバを名指しする欄は、ここにも無い
 *
 * 受け取るのは相対位置と版と（機能によっては）位置だけで、
 * 行き先は `resolveLspDocumentLanguage` が拡張子から決める
 * （main/lsp/documentLanguage.ts）。Session 5-1 から引いてきた線
 * ── Renderer は「どのサーバへ送るか」を言えない ── はここでも動いていない。
 *
 * ## 7段目：サーバがその機能を出すか
 *
 * Session 5-10 で足した段になる（main/lsp/serverCapabilities.ts）。
 * Pyright は `documentFormattingProvider` を出さないため、Python の整形は
 * ここで `unavailable` になり、**要求そのものが送られない。**
 *
 * 送っても `-32601` が返るだけで壊れはしないが、出さないと言われたものを
 * 毎回尋ねる形にはしない ── 名乗りを読む意味がそこにある。
 */

/** 確かめた結果。`ready` 以外はそのまま応答の `status` になる。 */
export type PreparedLspDocumentRequest =
  | {
      readonly status: 'ready'
      /** Workspace root の絶対パス（返ってきた URI を相対位置へ戻すのに要る）。 */
      readonly rootPath: string
      /** 要求に載せる文書の URI。 */
      readonly uri: string
      readonly serverId: LanguageServerId
    }
  | { readonly status: 'outside-workspace' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'stale' }

/** どの機能も持っている、要求の最小の形。 */
export interface LspDocumentRequestInput {
  readonly relativePath: string
  readonly version: number
  readonly position?: TextDocumentPosition
}

/**
 * 上記の7段。通れば `ready`。
 *
 * `feature` を要るようにしてあるのは、**名乗りを見ない経路を作らない**ため
 * ── 省略できるようにすると、足した機能がうっかり見ないまま通る。
 */
export function prepareLspDocumentRequest(
  request: LspDocumentRequestInput,
  feature: LanguageServerFeature,
  getWorkspaceFolder: () => { readonly rootPath: string } | null
): PreparedLspDocumentRequest {
  const workspace = getWorkspaceFolder()

  if (workspace === null) {
    return { status: 'unavailable' }
  }

  const uri = resolveWorkspaceDocumentUri(workspace.rootPath, request.relativePath)

  if (uri === null) {
    return { status: 'outside-workspace' }
  }

  const language = resolveLspDocumentLanguage(request.relativePath)

  // その拡張子に対応するサーバが表に無い（`.md` / `.txt` など）。
  if (language === null) {
    return { status: 'unavailable' }
  }

  // 設定で切られている（Session 5-4）。
  if (!isLanguageServerAllowed(language.serverId)) {
    return { status: 'unavailable' }
  }

  const document = getOpenLspDocument(request.relativePath)

  /*
    伝え終えていない文書へ位置を尋ねない。`serverId` まで見るのは、
    設定を戻した直後など、控えと表の行き先が食い違いうるため。
  */
  if (document === null || !document.synced || document.serverId !== language.serverId) {
    return { status: 'unavailable' }
  }

  // サーバがその機能を出さない（Session 5-10。上記）。
  if (!supportsLanguageServerFeature(language.serverId, feature)) {
    return { status: 'unavailable' }
  }

  if (document.version !== request.version) {
    return { status: 'stale' }
  }

  return { status: 'ready', rootPath: workspace.rootPath, uri, serverId: language.serverId }
}

/**
 * 応答を待っている間に文書が動かなかったか。
 *
 * 動いていれば `stale`（そのまま応答になる）、動いていなければ null。
 * **要求の前後で2度見る**のが要点で、前だけを見ると
 * 「打鍵の途中の位置に対する答え」を今の文書へ当てることになる。
 */
export function checkLspDocumentFreshness(request: {
  readonly relativePath: string
  readonly version: number
}): { readonly status: 'stale' } | null {
  const current = getOpenLspDocument(request.relativePath)

  return current === null || current.version !== request.version ? { status: 'stale' } : null
}
