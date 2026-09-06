import type { TextDocumentContentChange } from '@shared/lsp'
import type { LspLanguageId } from './documentLanguage'

/**
 * 文書同期の通知1通ぶんを組み立てる（依存なし・テスト対象）。
 *
 * jsonRpcMessage.ts が「電文の枠」を、jsonRpcConnection.ts が「要求と返事」を
 * 相手にしているのに対し、ここが持つのは **LSP の `textDocument/*` の形**だけになる。
 * 送る手段（プロセス・接続）は知らないので、組み立ての正しさだけを試せる。
 *
 * ## 4つの通知は、載せるものが違う
 *
 * ```
 * didOpen   … uri + languageId + version + 全文
 * didChange … uri + version + 変更の並び
 * didSave   … uri のみ
 * didClose  … uri のみ
 * ```
 *
 * `didSave` に版が載らないのは**仕様どおり**（`TextDocumentIdentifier`）で、
 * かつ意味の上でも正しい ── 保存は中身を変えないため版が動かない。
 * ここを取り違えて「保存済みの版」を送ると、未保存かどうかという
 * 別の話（Undo で戻る数）が LSP の版へ混ざる（shared/ipc/contracts/lsp.ts）。
 *
 * `didSave` に本文を載せていないのは、`initialize` で
 * `didSave: { includeText: false }` と申告しているため
 * （main/lsp/initializeParams.ts）。載せるかどうかを決めるのは
 * こちらの申告であって、都合ではない。
 *
 * ## 差分は「そのままの並び」で渡す
 *
 * `contentChanges` は前から順に適用される。並べ替えも束ねもしない
 * ── 送り元（Monaco の編集イベント）が既に適用できる順で返しており、
 * 途中に手を入れると、複数カーソルの編集がずれる。
 */

export const LSP_DID_OPEN = 'textDocument/didOpen'
export const LSP_DID_CHANGE = 'textDocument/didChange'
export const LSP_DID_SAVE = 'textDocument/didSave'
export const LSP_DID_CLOSE = 'textDocument/didClose'

export function createDidOpenParams(
  uri: string,
  languageId: LspLanguageId,
  version: number,
  text: string
): Record<string, unknown> {
  return {
    textDocument: { uri, languageId, version, text }
  }
}

export function createDidChangeParams(
  uri: string,
  version: number,
  changes: readonly TextDocumentContentChange[]
): Record<string, unknown> {
  return {
    textDocument: { uri, version },
    /*
      範囲を持たない変更は `range` の欄そのものを落とす（＝全文の置き換え）。
      `range: null` を載せる形は仕様に無く、受け取ったサーバの振る舞いが分かれる。
    */
    contentChanges: changes.map((change) =>
      change.range === null ? { text: change.text } : { range: change.range, text: change.text }
    )
  }
}

export function createDidSaveParams(uri: string): Record<string, unknown> {
  return { textDocument: { uri } }
}

export function createDidCloseParams(uri: string): Record<string, unknown> {
  return { textDocument: { uri } }
}
