import type { LspLanguageId } from './documentLanguage'
import type { LanguageServerId } from './languageServerCatalog'

/**
 * どの文書が開いていて、どれをサーバへ伝え終えたか（依存なし・テスト対象）。
 *
 * documentSync.ts が持つ状態のうち、**判断だけをここへ分けてある**
 * （restartPolicy.ts と languageServers.ts の分け方と同じ）。
 * プロセスも IPC も知らないので、立ち上がり・落下・切り替えの噛み合わせを
 * そのまま試せる。
 *
 * ## 本文は持たない
 *
 * 持つのは「開いている」という事実と行き先だけで、**中身は1文字も持たない**。
 * 正本は Monaco の Model（Renderer）1つに保つ ── 控えると、差分を当てる処理が
 * Main にもう1つできることになり、必ずどこかで食い違う。
 *
 * そのぶん、サーバへ送り直す必要が出たときは Renderer へ頼む
 * （shared/ipc/events/lsp.ts の `lsp:sync-requested`）。
 *
 * ## 「開いている」と「送り終えた」を分ける
 *
 * ```
 * synced = false … Editor では開いているが、サーバはまだ知らない
 * synced = true  … didOpen を送り終えた
 * ```
 *
 * 分けてあるのは、**この2つがずれる時間が必ずある**ため。
 *
 *   - サーバの初期化が終わるまで（立ち上げ中に開いた文書）
 *   - サーバが落ちてから立ち直るまで（プロセスが変われば、知っている文書も消える）
 *
 * ずれている間に届いた `didChange` は捨てる（送っても、開いていない文書への
 * 変更としてサーバに断られるだけ）。埋めるのは開き直しで、
 * そのとき送るのは **`synced` が false のものだけ**になる ──
 * 既に届いている文書へ2度目の `didOpen` を送るのは仕様違反にあたる。
 */

/** 開いている文書1件。 */
export interface OpenLspDocument {
  readonly relativePath: string
  readonly serverId: LanguageServerId
  readonly languageId: LspLanguageId
  /** 文書の URI（main/lsp/documentUri.ts が組み立てたもの）。 */
  readonly uri: string
  /** その文書を担当するサーバへ `didOpen` を送り終えたか。 */
  readonly synced: boolean
}

/** 登録するときに渡すもの（`synced` は必ず false から始まる）。 */
export type OpenLspDocumentInput = Omit<OpenLspDocument, 'synced'>

export class OpenDocumentRegistry {
  /** 鍵は relativePath。中身の同一性は Workspace 内の位置で決まる（documentStore.ts と同じ）。 */
  private readonly documents = new Map<string, OpenLspDocument>()

  /**
   * 文書を開いたものとして控える。
   *
   * 既に同じ位置が控えられていた場合は**上書きしない**。2度目の `didOpen` は
   * 送り直しの依頼（`lsp:sync-requested`）に対する返事であることが多く、
   * そこで `synced` を false へ戻すと、既に届いている文書をもう一度開いてしまう。
   *
   * 戻り値は控えた後の状態。
   */
  register(input: OpenLspDocumentInput): OpenLspDocument {
    const existing = this.documents.get(input.relativePath)

    /*
      行き先が同じなら、そのまま。違う場合（拡張子の変わる改名）は控え直すが、
      **改名は close → open で届く**ため通常ここへは来ない
      （renderer/src/editor/monaco/documentStore.ts の rekey）。
      来た場合は新しい行き先で始め直す ── 古い行き先のサーバには
      既に didClose が届いている。
    */
    if (existing !== undefined && existing.serverId === input.serverId) {
      return existing
    }

    const document: OpenLspDocument = { ...input, synced: false }

    this.documents.set(input.relativePath, document)

    return document
  }

  get(relativePath: string): OpenLspDocument | null {
    return this.documents.get(relativePath) ?? null
  }

  /** `didOpen` を送り終えたことを控える。 */
  markSynced(relativePath: string): void {
    const document = this.documents.get(relativePath)

    if (document === undefined || document.synced) {
      return
    }

    this.documents.set(relativePath, { ...document, synced: true })
  }

  /**
   * そのサーバが持っていた文書を「まだ伝えていない」へ戻す。
   *
   * 呼ぶのはサーバが終わったとき（落ちた・こちらから終わらせた）。
   * **控えそのものは消さない** ── Editor ではまだ開いており、
   * 立ち直った後に開き直す対象になるため。
   */
  markServerStopped(serverId: LanguageServerId): void {
    for (const [relativePath, document] of this.documents) {
      if (document.serverId === serverId && document.synced) {
        this.documents.set(relativePath, { ...document, synced: false })
      }
    }
  }

  /** そのサーバへまだ伝えていない文書があるか（開き直しを頼むかの判断）。 */
  hasUnsynced(serverId: LanguageServerId): boolean {
    for (const document of this.documents.values()) {
      if (document.serverId === serverId && !document.synced) {
        return true
      }
    }

    return false
  }

  /** 控えから外す（閉じた）。外れたものを返す。 */
  remove(relativePath: string): OpenLspDocument | null {
    const document = this.documents.get(relativePath)

    if (document === undefined) {
      return null
    }

    this.documents.delete(relativePath)

    return document
  }

  /**
   * すべて外す（Workspace の切り替え）。
   *
   * 外したものを返すのは、呼び出し側が `didClose` を送るかどうかを
   * 自分で決められるようにするため ── 切り替えではサーバごと終わっているので
   * 送る相手が居ない。
   */
  clear(): readonly OpenLspDocument[] {
    const removed = [...this.documents.values()]

    this.documents.clear()

    return removed
  }

  /** 控えている文書（順序は登録順）。 */
  list(): readonly OpenLspDocument[] {
    return [...this.documents.values()]
  }
}
