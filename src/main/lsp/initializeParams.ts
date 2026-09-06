/**
 * `initialize` に載せるもの（依存なし・テスト対象）。
 *
 * ## 何ができるかを、先に互いに申告する
 *
 * LSP では、最初の1往復（`initialize` → 応答 → `initialized`）が済むまで
 * **他の要求も通知も送れない**。サーバはここで「クライアントは何を扱えるか」を知り、
 * その範囲でしか機能を出さなくなる。
 *
 * したがって申告は**実装済みのものだけ**にする。持っていない機能を名乗ると、
 * サーバはそれを前提に動き（例えば差分だけを送ってくる・設定を尋ねてくる）、
 * こちらが応じられないまま黙って噛み合わなくなる。
 *
 * ## 名乗るのは文書同期と診断（Session 5-2 / 5-3）
 *
 * ```
 * 名乗る       … textDocument.synchronization（didOpen / didChange / didSave / didClose）
 * 名乗る       … textDocument.publishDiagnostics（Session 5-3）
 * 名乗らない   … completion・definition・rename・formatting（Session 5-4 以降）
 * 名乗らない   … workspace.configuration（応じる口が無い。jsonRpcConnection.ts が断る）
 * ```
 *
 * `dynamicRegistration` をどれも false にしてあるのは、
 * `client/registerCapability` に応じる口がまだ無いため
 * ── 応じられないものを「受け付ける」と言わない、という同じ線になる。
 *
 * ## 診断は「名乗らないと来ない」
 *
 * Session 5-2 の時点では `publishDiagnostics` を名乗っていなかった。
 * **typescript-language-server は、この申告が無いと診断を1通も送ってこない。**
 * 実際に繋いで確かめた結果で、仕様の上では省略できることになっているが、
 * 送るかどうかを申告で決めるサーバがある以上、受け取る側は名乗る必要がある。
 *
 * 名乗る中身も、実装に合わせて選んである。
 *
 * ```
 * relatedInformation: false  … 関連する別の位置は、まだ描いていない（Session 5-4 以降）
 * versionSupport: true       … 版を見て古い指摘を捨てる（main/lsp/diagnostics.ts）
 * tagSupport                 … unnecessary / deprecated を Monaco の印に写す
 * ```
 *
 * ## `rootUri` は動かせない
 *
 * サーバはこれを見てプロジェクトの範囲を決め、以後変えられない。
 * だから Workspace が切り替わったらサーバごと終わらせる
 * （main/lsp/languageServers.ts）。`workspaceFolders` にも同じ1つだけを載せる
 * ── 複数フォルダの Workspace は v1 の対象外（DESIGN.md §3）。
 *
 * ## `processId` を渡す理由
 *
 * これを受け取ったサーバは、その pid が消えたときに自分も終わる。
 * こちらの片付け（stopLanguageServers）が何かの理由で届かなくても、
 * **孤児のサーバが残り続けない**ための保険になる。
 */

export interface LanguageServerInitializeInput {
  /** このアプリのプロセス id。サーバの孤児化を防ぐために渡す。 */
  readonly processId: number | null
  readonly clientName: string
  readonly clientVersion: string
  /** Workspace root の URI（main/lsp/documentUri.ts）。 */
  readonly rootUri: string
  /** Workspace の表示名。サーバのログにしか出ない。 */
  readonly rootName: string
}

export function createInitializeParams(
  input: LanguageServerInitializeInput
): Record<string, unknown> {
  return {
    processId: input.processId,
    clientInfo: { name: input.clientName, version: input.clientVersion },
    /*
      文字の位置を UTF-16 の符号単位で数える、と明示する。既定も UTF-16 だが、
      pyright のように UTF-8 を好むサーバがあるため、こちらの数え方を先に言う
      ── 送る差分の桁は Monaco が数えたもの（＝ UTF-16）で、
      ここがずれると日本語を含む行の変更位置が1文字ずつ狂う。
    */
    capabilities: {
      general: { positionEncodings: ['utf-16'] },
      textDocument: {
        synchronization: {
          dynamicRegistration: false,
          /*
            保存の**前**には知らせない。保存を止めたり書き換えたりする経路
            （willSaveWaitUntil）を作らないため ── 保存は利用者の操作で、
            サーバの応答待ちで遅れてよいものではない。
          */
          willSave: false,
          willSaveWaitUntil: false,
          didSave: true
        },
        /*
          診断を受け取れる、という申告（Session 5-3。上記）。
          中身は実装に合わせてある ── 描いていないもの（relatedInformation）は
          false のままにする。名乗れば、サーバはそれを前提に送ってくる。
        */
        publishDiagnostics: {
          relatedInformation: false,
          versionSupport: true,
          tagSupport: { valueSet: [1, 2] }
        },
        completion: {
          dynamicRegistration: false,
          contextSupport: true,
          completionItem: {
            snippetSupport: true,
            commitCharactersSupport: true,
            documentationFormat: ['markdown', 'plaintext'],
            deprecatedSupport: false,
            preselectSupport: true
          }
        }
      },
      workspace: {
        /*
          Workspace は常に1つ。それでも申告するのは、`workspaceFolders` を
          載せた `initialize` を送るため（載せておいて「扱えない」と言うと、
          サーバによっては rootUri の側だけを見る）。
        */
        workspaceFolders: true,
        configuration: false,
        didChangeConfiguration: { dynamicRegistration: false }
      }
    },
    rootUri: input.rootUri,
    workspaceFolders: [{ uri: input.rootUri, name: input.rootName }]
  }
}
