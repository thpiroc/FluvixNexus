import {
  isAtOrUnder,
  rebaseRelativePath,
  type FileEncoding,
  type FileLineEnding,
  type FileRevision,
  type WorkspaceFileChange
} from '@shared/files'
import type { TextDocumentContentChange } from '@shared/lsp'
// 型だけ。実体を import すると、このモジュールを読むだけで Monaco が読み込まれる（下記）。
import type * as monaco from 'monaco-editor'
import { resolveEditorTabState, type EditorTabState } from '../editorTabState'
import { toTextDocumentContentChanges } from './documentChanges'

/**
 * 開いているファイルの Monaco Model を持つ層。
 *
 * ## Editor Tab とは責務が違う
 *
 * | 層                  | 持つもの                                           | 単位          |
 * | ------------------- | -------------------------------------------------- | ------------- |
 * | editorTabsModel.ts  | どのファイルを開いていて、どれが手前か、印を出すか | タブ（id）    |
 * | ここ                | その中身・編集履歴・カーソル・保存済みの版         | ファイル（位置） |
 *
 * 2つを分けているのは**同一性の基準が違う**ため。タブの同一性は発番した id で、
 * リネームされても同じタブであり続ける（ARCHITECTURE.md §10.3）。
 * 一方、中身の同一性は**Workspace 内の位置**で決まる ── 同じファイルを
 * 2通りの経路から開いても、編集内容が2つに分かれてはいけない。
 *
 * したがってここの鍵は `relativePath` で、タブ id は出てこない。
 *
 * ## React の外に置く
 *
 * このストアの持ち主は EditorProvider（Workspace Shell の**外側**）で、
 * Monaco のエディタ本体（MonacoEditor.tsx）ではない。
 *
 * Editor パネルは View メニューから閉じられる（§7.7）し、Dock で動かせば
 * React から見て作り直される。エディタ本体が Model を持っていると、
 * **パネルを閉じただけで未保存の編集が消える。**
 * Model がここに居れば、消えるのはエディタの器だけになる。
 *
 * ```
 * EditorProvider          ← Model の持ち主（Workspace が変わるまで生きる）
 *   └── WorkspaceShell
 *         └── Editor パネル
 *               └── MonacoEditor  ← 器。閉じても Model は残る
 * ```
 *
 * ## Model を2つ作らない
 *
 * `acquire` は同じ位置に対して常に同じ Model を返す。既にあれば**中身を入れ直さない**
 * （入れ直すと、タブを切り替えて戻っただけで編集が捨てられる）。
 * 読み直しは呼び出し側が `release` してから `acquire` する。
 *
 * ## ディスク側の事実もここが持つ
 *
 * 「未保存か」に加えて「読み込んだ後にディスク側が変わったか」「消えたか」も
 * ここが持つ。中身の同一性を持っている層が**中身の食い違い**も持つのが素直で、
 * タブ側（editorTabsModel.ts）はその結果を状態として写すだけになる
 * （editorTabState.ts が導き方を持つ）。
 *
 * ```
 * savedVersionId  ←→ model.getAlternativeVersionId()   未保存か
 * revision                                             最後にディスクで確かめた版
 * externalRevision                                     外で書き換えられた後の版（無ければ null）
 * missing                                              ディスクから消えたか
 * ```
 *
 * ## Monaco を「型としてしか」使わない
 *
 * このファイルは `import type` だけで Monaco を参照し、**Model の作り方は
 * 呼び出し側から関数として受け取る**（`EditorModelFactory`）。
 *
 * ストアの持ち主は EditorProvider で、アプリの起動と同時に作られる。実体を
 * import すると、その時点で Monaco（React 本体より一桁大きい）が読み込まれ、
 * MonacoEditor.tsx を遅延させている意味が無くなる。
 *
 * 分担としても素直になる ── ここが持つのは**持ち物の管理**（何を開いていて、
 * 未保存か、どこを見ていたか）で、Monaco の作法を知っているのは器の側だけになる。
 *
 * ## Language Server への同期も、ここから起こす（Session 5-2）
 *
 * `didOpen` / `didChange` / `didSave` / `didClose` の4つは、**Model の生き死にと
 * 1対1で対応する**。それを知っているのはこの層しか無い ── 画面の部品は
 * 「今どのタブが手前か」しか知らず、Model が作られた / 捨てられた瞬間を持っていない。
 *
 * ```
 * acquire（新しく作った）  → opened
 * onDidChangeContent       → changed
 * markSaved                → saved
 * release                  → closed
 * rekey（改名・別名で保存） → closed（元の位置）→ opened（新しい位置）
 * ```
 *
 * それでも IPC はここから呼ばない。出すのは出来事だけで、送るのは
 * つなぐ側（editor/lsp/useDocumentSync.ts）にする ── この層が IPC を知ると、
 * Monaco を持ち込まずに試せるという性質（下の「Monaco を型としてしか使わない」）が
 * そのまま失われる。
 *
 * ### 改名は「移す」ではなく「閉じて開く」
 *
 * 鍵の付け替え（`rekey`）では Model を作り直さない ── Undo 履歴を保つためで、
 * その判断は変わらない。だが **Language Server から見た文書は URI で決まる**ので、
 * 位置が変われば別の文書になる。移動を伝える通知は LSP に無く、
 * 閉じて開き直すのが唯一の伝え方になる。
 *
 * ### 版番号は2つある。混ぜない
 *
 * ```
 * getAlternativeVersionId() … 未保存かの判定に使う。**Undo で戻る**
 * getVersionId()            … LSP の版として送る。編集のたびに増え、戻らない
 * ```
 *
 * 前者を LSP へ送ると、Undo した瞬間に「古い版が後から来た」ことになり、
 * サーバはそれ以降の変更を捨てる。**未保存かどうかと、何版目かは別の話**にあたる。
 */

/**
 * Model の作り方。
 *
 * 言語の決定・URI の発番・改行の設定は Monaco に触れるため、
 * これを渡す側（monaco/MonacoEditor.tsx）が持つ。
 */
export type EditorModelFactory = (
  relativePath: string,
  source: EditorDocumentSource
) => monaco.editor.ITextModel

/** 開いたときにディスクから読めたもの。Model を作る材料。 */
export interface EditorDocumentSource {
  readonly content: string
  readonly lineEnding: FileLineEnding
  /** 読み込んだ時点の文字コード。保存でそのまま書き戻す。 */
  readonly encoding: FileEncoding
  /** 読み込んだ時点の版。保存の起点になる。 */
  readonly revision: FileRevision | null
}

/** 保存のために取り出す一式。 */
export interface EditorSaveSnapshot {
  readonly content: string
  /**
   * この中身に対応する版番号（Monaco の alternativeVersionId）。
   *
   * 保存が終わった時点ではなく**取り出した時点**の番号を後で渡し直す。
   * 書き込んでいる間に打たれた文字が「保存済み」に含まれないようにするため。
   */
  readonly versionId: number
  /** 前回ディスクで確かめた版。Main 側が外部変更の検出に使う。 */
  readonly baseRevision: FileRevision | null
  /** 読み込んだときの文字コード。保存でそのまま書き戻す。 */
  readonly encoding: FileEncoding
}

interface DocumentEntry {
  readonly model: monaco.editor.ITextModel
  /**
   * 今この Model が対応している位置（＝ Map の鍵と同じもの）。
   *
   * **鍵を2箇所に持っているのは、購読が位置を知る必要があるため。**
   * 中身の変化の購読はここが張る（下の `subscription`）が、知らせる相手（タブ）の
   * 鍵も位置なので、通知には「今の位置」が要る。
   *
   * これを持たずに `acquire` の引数を閉じ込めると、**位置が変わった後も
   * 古い位置を知らせ続ける**。そこにはもうタブが居ないため通知は捨てられ、
   * 打っても未保存の印が出ないタブができる ── 印が出ないだけで中身は
   * 未保存のままなので、閉じる前の確認にも並ばず、黙って失われる。
   *
   * 付け替えるのは `rekey` の1箇所だけ（鍵と必ず一緒に動く）。
   */
  relativePath: string
  /** 中身の変化を見る購読。Model と一緒に捨てる。 */
  subscription: monaco.IDisposable
  /**
   * 最後にディスクと一致していた版番号。
   *
   * `model.getAlternativeVersionId()` と比べて dirty を導く。**この方式にすると
   * 「打った文字を Undo で戻した」場合に未保存が解けた状態へ戻る**
   * （中身の文字列を毎回比べる形では、比較の費用が中身の大きさに比例する）。
   */
  savedVersionId: number
  /** 最後にディスクで確かめた版。 */
  revision: FileRevision | null
  /** 読み込んだときの文字コード。 */
  encoding: FileEncoding
  /**
   * アプリの外で書き換えられた後の版。食い違いが無ければ null。
   *
   * 入るのは2つの経路から。どちらも「ディスク側が読み込み後に変わった」という
   * 同じ事実で、**同じ1つの欄で表す**（気づいた経路ごとに状態を分けると、
   * どちらを見て判断するかが場所ごとにずれる）。
   *
   *   ファイル監視    … `files:changed` の 'modified'（useEditorSession.ts）
   *   保存しようとして … `files:write-file` の 'stale'
   */
  externalRevision: FileRevision | null
  /** ディスクから消えたか。 */
  missing: boolean
  /** カーソル・選択・スクロール位置。タブを切り替えたときに戻す。 */
  viewState: monaco.editor.ICodeEditorViewState | null
}

/** タブの状態が変わったことの通知。 */
export type DocumentStateListener = (relativePath: string, state: EditorTabState) => void

/**
 * Model の生き死に（Session 5-2）。
 *
 * LSP の4つの通知と1対1で対応するが、**この型は LSP を知らない**
 * ── 運ぶのは相対位置・版・中身だけで、URI もサーバも出てこない
 * （それらを決めるのは Main。main/lsp/documentSync.ts）。
 */
export type EditorDocumentSyncEvent =
  | {
      readonly kind: 'opened'
      readonly relativePath: string
      /** Model の版（`getVersionId()`。未保存かの判定に使う数とは別物）。 */
      readonly version: number
      readonly content: string
    }
  | {
      readonly kind: 'changed'
      readonly relativePath: string
      /** 変更を適用した**後**の版。 */
      readonly version: number
      readonly changes: readonly TextDocumentContentChange[]
    }
  /** 版を持たない ── 保存は中身を変えないため（shared/ipc/contracts/lsp.ts）。 */
  | { readonly kind: 'saved'; readonly relativePath: string }
  | { readonly kind: 'closed'; readonly relativePath: string }

export type DocumentSyncListener = (event: EditorDocumentSyncEvent) => void

/** 開いている文書を送り直すときの一式（`lsp:sync-requested` への返事）。 */
export interface EditorDocumentSnapshot {
  readonly relativePath: string
  readonly version: number
  readonly content: string
}

/**
 * 同じ版か。
 *
 * mtime と size の組で見るのは shared/files/content.ts の判断そのままで、
 * Main 側（writeWorkspaceFile.ts）と同じ比べ方をする。ここが食い違うと、
 * 「Main は同じと判断して書いたのに Renderer は食い違いだと思っている」が起きる。
 */
function isSameRevision(a: FileRevision, b: FileRevision): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size
}

export class EditorDocumentStore {
  private readonly entries = new Map<string, DocumentEntry>()
  private readonly stateListeners = new Set<DocumentStateListener>()
  private readonly syncListeners = new Set<DocumentSyncListener>()

  /**
   * 今エディタに載っているエディタ本体。
   *
   * 中身を差し替える（Reload・外部変更の取り込み）ときに、
   * カーソルとスクロール位置を控えて戻すために要る。**持ち主ではない**
   * （器は MonacoEditor.tsx が作って捨てる）ので、参照だけを預かる。
   */
  private editor: monaco.editor.ICodeEditor | null = null

  /* ------------------------------------------------------------ 取得 */

  /**
   * その位置の Model を得る。無ければ `createModel` で作る。
   *
   * **既にあれば中身を入れ直さない。** タブを切り替えて戻ったときに
   * 編集内容・Undo 履歴・カーソル位置が失われないようにするため
   * （`createModel` も呼ばれない）。
   */
  acquire(
    relativePath: string,
    source: EditorDocumentSource,
    createModel: EditorModelFactory
  ): monaco.editor.ITextModel {
    const existing = this.entries.get(relativePath)

    if (existing !== undefined) {
      return existing.model
    }

    const model = createModel(relativePath, source)

    const entry: DocumentEntry = {
      model,
      relativePath,
      // 張り直すのは下（entry を作ってからでないと「今の位置」を読めない）。
      subscription: { dispose: () => undefined },
      // 作られた直後の状態を「ディスクと同じ」の基準にする。
      savedVersionId: model.getAlternativeVersionId(),
      revision: source.revision,
      encoding: source.encoding,
      externalRevision: null,
      missing: false,
      viewState: null
    }

    /*
      引数の `relativePath` を閉じ込めず、**entry が持つ「今の位置」を読む**。
      閉じ込めると、位置が変わった後も古い位置を知らせ続ける
      （DocumentEntry.relativePath の但し書き）。
    */
    entry.subscription = model.onDidChangeContent((event) => {
      /*
        差分を先に出す。未保存の印（notifyState）は自動保存のタイマーを張り直す
        入口でもあり、**保存より先に変更が届いている**方が順として素直になる。
      */
      this.emitSync(() => ({
        kind: 'changed',
        relativePath: entry.relativePath,
        version: entry.model.getVersionId(),
        changes: toTextDocumentContentChanges(event, () => entry.model.getValue())
      }))

      this.notifyState(entry.relativePath)
    })

    this.entries.set(relativePath, entry)

    this.emitSync(() => this.toSnapshotEvent(entry))

    return model
  }

  /**
   * 鍵を付け替える（`rename` と `applyFileChanges` の改名が共有する1箇所）。
   *
   * **Map の鍵と `entry.relativePath` は必ず一緒に動く。** 片方だけを動かすと、
   * 中身は新しい位置にあるのに通知は古い位置へ飛ぶ状態ができる
   * ── その状態のタブは、打っても未保存の印が出ない。
   *
   * 行き先が埋まっていないことは呼ぶ側が確かめる（何をするかが2つで違うため）。
   */
  private rekey(fromRelativePath: string, toRelativePath: string): void {
    const entry = this.entries.get(fromRelativePath)

    if (entry === undefined) {
      return
    }

    this.entries.delete(fromRelativePath)
    entry.relativePath = toRelativePath
    this.entries.set(toRelativePath, entry)

    /*
      Language Server から見れば、**位置が変わった時点で別の文書**になる
      （文書を指すのは URI で、移動を伝える通知は LSP に無い）。
      閉じて開き直すのが唯一の伝え方で、それをここで起こす
      ── 鍵が動く経路はこの1箇所に集めてあるので、`rename` からも
      アプリの外での改名（`applyFileChanges`）からも同じ結果になる。

      Model は作り直していない（Undo 履歴はそのまま）。**開き直すのは
      サーバから見た文書だけ**で、利用者から見た編集の連続性は切れない。
    */
    this.emitSync(() => ({ kind: 'closed', relativePath: fromRelativePath }))
    this.emitSync(() => this.toSnapshotEvent(entry))
  }

  /** その位置の Model。開いていなければ null。 */
  getModel(relativePath: string): monaco.editor.ITextModel | null {
    return this.entries.get(relativePath)?.model ?? null
  }

  /**
   * 今のエディタ本体を預かる / 返す。
   *
   * 呼ぶのは MonacoEditor.tsx（作った直後と、捨てる前）。
   * 中身を差し替えるときに見ていた位置を保つのに使う。
   */
  attachEditor(editor: monaco.editor.ICodeEditor | null): void {
    this.editor = editor
  }

  /* ------------------------------------------------------------ 状態 */

  /** ディスクの内容と食い違っているか。 */
  isDirty(relativePath: string): boolean {
    const entry = this.entries.get(relativePath)

    if (entry === undefined) {
      return false
    }

    return entry.model.getAlternativeVersionId() !== entry.savedVersionId
  }

  /**
   * その位置の今の状態（editorTabState.ts）。
   *
   * 開いていなければ `clean`（Model が無い ＝ 失うものが無い）。
   */
  getState(relativePath: string): EditorTabState {
    const entry = this.entries.get(relativePath)

    if (entry === undefined) {
      return 'clean'
    }

    return resolveEditorTabState({
      dirty: entry.model.getAlternativeVersionId() !== entry.savedVersionId,
      externalChange: entry.externalRevision !== null,
      missing: entry.missing
    })
  }

  /** 未保存の変更を持つ位置（閉じる前の確認・終了時の判断で使う）。 */
  listDirtyPaths(): readonly string[] {
    return [...this.entries.keys()].filter((relativePath) => this.isDirty(relativePath))
  }

  /**
   * 状態が変わったときに呼ばれる。
   *
   * 戻り値が解除の関数（Main → Renderer のイベントと同じ形。§3.3）。
   */
  onStateChange(listener: DocumentStateListener): () => void {
    this.stateListeners.add(listener)

    return () => {
      this.stateListeners.delete(listener)
    }
  }

  private notifyState(relativePath: string): void {
    const state = this.getState(relativePath)

    for (const listener of this.stateListeners) {
      listener(relativePath, state)
    }
  }

  /* --------------------------------------------- Language Server への同期 */

  /**
   * Model の生き死にを受け取る（Session 5-2）。
   *
   * 戻り値が解除の関数（`onStateChange` と同じ形）。
   * 受け取った側が IPC で Main へ渡す（editor/lsp/useDocumentSync.ts）。
   */
  onDocumentSync(listener: DocumentSyncListener): () => void {
    this.syncListeners.add(listener)

    return () => {
      this.syncListeners.delete(listener)
    }
  }

  /**
   * 出来事を配る。**受け手が居なければ組み立てない。**
   *
   * 引数が値ではなく関数なのはそのため。`changed` の組み立ては
   * 打鍵1回ごとに走り、全文の置き換えでは Model の全行を連結することになる
   * ── 聞いている相手が居ないときにその費用を払う理由が無い
   * （Editor は Language Server を使わない設定でも、Model を持たない環境でも動く）。
   */
  private emitSync(build: () => EditorDocumentSyncEvent | null): void {
    if (this.syncListeners.size === 0) {
      return
    }

    const event = build()

    if (event === null) {
      return
    }

    for (const listener of this.syncListeners) {
      listener(event)
    }
  }

  /** 今の中身を「開いた」の形にする（新しく作ったとき・鍵を移したとき）。 */
  private toSnapshotEvent(entry: DocumentEntry): EditorDocumentSyncEvent {
    return {
      kind: 'opened',
      relativePath: entry.relativePath,
      version: entry.model.getVersionId(),
      content: entry.model.getValue()
    }
  }

  /**
   * 開いている文書の一式（送り直しの依頼に応えるため）。
   *
   * 中身を持っているのはこの層だけなので、Main から
   * 「もう一度開いて」と頼まれたときに答えられるのもここになる
   * （shared/ipc/events/lsp.ts）。
   */
  listOpenDocuments(): readonly EditorDocumentSnapshot[] {
    return [...this.entries.values()].map((entry) => ({
      relativePath: entry.relativePath,
      version: entry.model.getVersionId(),
      content: entry.model.getValue()
    }))
  }

  /* ------------------------------------------------------------- 保存 */

  /** 保存に必要なものを取り出す。開いていなければ null。 */
  readForSave(relativePath: string): EditorSaveSnapshot | null {
    const entry = this.entries.get(relativePath)

    if (entry === undefined) {
      return null
    }

    return {
      // Model の EOL で連結されるため、開いたときの改行がそのまま出る。
      content: entry.model.getValue(),
      versionId: entry.model.getAlternativeVersionId(),
      baseRevision: entry.revision,
      encoding: entry.encoding
    }
  }

  /**
   * 保存できたことを反映する。
   *
   * `versionId` には**書き込みを始めた時点**の番号を渡すこと（readForSave の戻り値）。
   * 書き込んでいる間に文字が打たれていれば、それは未保存のまま残る。
   *
   * 書けた時点でディスクの内容はこちらのものになったため、食い違いと
   * 「消えていた」は解消する（Overwrite で書けた場合もここを通る）。
   */
  markSaved(relativePath: string, versionId: number, revision: FileRevision): void {
    const entry = this.entries.get(relativePath)

    if (entry === undefined) {
      return
    }

    entry.savedVersionId = versionId
    entry.revision = revision
    entry.externalRevision = null
    entry.missing = false

    /*
      ディスクへ書けたことを知らせる（Session 5-2）。**版は載せない** ──
      保存は中身を変えないので Model の版は動かず、ここで渡している `versionId`
      は未保存かの判定に使う別の数（Undo で戻る）にあたる。
    */
    this.emitSync(() => ({ kind: 'saved', relativePath }))

    this.notifyState(relativePath)
  }

  /**
   * 中身の鍵を別の位置へ付け替える（別名で保存。Session 4-2）。
   *
   * 改名の追従（`applyFileChanges` の `renamed`）と同じことをするが、
   * 入口を分けてある理由は `editorTabsModel.moveTabToPath` と同じ
   * ── あちらは届いた変化を写す経路で、こちらは利用者の操作から直に呼ばれる。
   *
   * ## Model を作り直さない
   *
   * 移すのは鍵だけで、Model はそのまま使い続ける。作り直すと Undo 履歴が消え、
   * **別名で保存した瞬間に、それまでの編集を取り消せなくなる**。
   * 改名で作り直さないのと同じ判断（このクラスの `applyFileChanges`）。
   *
   * ## 見ていた位置を、移す前に控える
   *
   * 今エディタに載っているのがこの Model なら、`viewState` をここで控える。
   * 控えないと、器の側（MonacoEditor.tsx）が「離れる前に控える」ときには
   * 既に鍵が変わっていて控え先が無く、**保存した拍子にカーソルが先頭へ戻る。**
   *
   * ## 行き先が埋まっていれば移さない
   *
   * 同じ位置に2つの Model が対応する状態を作らない。呼ぶ側（useEditorSession.ts）が
   * タブの側で同じ判断をしてから呼ぶため通常は起きないが、
   * **この不変条件はこの層が自分で守る**（守れないなら移さない）。
   * 戻り値は移せたかどうか。
   *
   * ## 状態は知らせない
   *
   * `notifyState` を呼ばない。知らせる相手（タブ）の鍵も位置で、
   * **この瞬間だけは2つの層の位置がずれている**（Model は移り、タブはまだ元の位置）。
   * ここで知らせると、移す前のタブへ移した後の状態が届く。
   * 移し終えた後に揃えるのは、2つの層をつなぐ側の仕事（useEditorSession.ts）。
   */
  rename(fromRelativePath: string, toRelativePath: string): boolean {
    if (fromRelativePath === toRelativePath) {
      return true
    }

    const entry = this.entries.get(fromRelativePath)

    if (entry === undefined || this.entries.has(toRelativePath)) {
      return false
    }

    if (this.editor !== null && this.editor.getModel() === entry.model) {
      entry.viewState = this.editor.saveViewState()
    }

    this.rekey(fromRelativePath, toRelativePath)

    return true
  }

  /* --------------------------------------------- ディスク側との食い違い */

  /**
   * アプリの外でディスク側が変わったことを控える。
   *
   * 呼ぶのは2つの経路から（DocumentEntry.externalRevision）。
   * **中身には触れない。** 未保存の変更を持っている以上、
   * どちらを採るかを決めるのは利用者であって、この層ではない。
   *
   * 今ディスクにある版と、既に知っている版が同じなら何もしない。
   * **自分の保存でもファイル監視は発火する**ため、これが無いと
   * 保存のたびに自分自身と食い違ったことになる。
   */
  markExternalChange(relativePath: string, revision: FileRevision): void {
    const entry = this.entries.get(relativePath)

    if (entry === undefined) {
      return
    }

    if (entry.revision !== null && isSameRevision(entry.revision, revision)) {
      return
    }

    if (entry.externalRevision !== null && isSameRevision(entry.externalRevision, revision)) {
      return
    }

    entry.externalRevision = revision
    this.notifyState(relativePath)
  }

  /** ディスクから消えたことを控える（中身は残す）。 */
  markMissing(relativePath: string): void {
    const entry = this.entries.get(relativePath)

    if (entry === undefined || entry.missing) {
      return
    }

    entry.missing = true
    this.notifyState(relativePath)
  }

  /** 食い違いが起きたときの、ディスク側の版。無ければ null。 */
  getExternalRevision(relativePath: string): FileRevision | null {
    return this.entries.get(relativePath)?.externalRevision ?? null
  }

  /**
   * ディスクの内容を Model へ取り込む（Reload と、未保存でない場合の自動追従）。
   *
   * ## 作り直さない
   *
   * Model もタブも作り直さず、**中身だけを差し替える**。作り直すと、
   *   - タブが React から見て別物になり、開き直しと同じ見え方になる
   *   - Undo 履歴が消える
   *   - 言語サービスがそのファイルを開き直す
   * ことになる。差し替えなら、どれも起きない。
   *
   * ## 見ていた場所を保つ
   *
   * 全体を1回の編集として置き換え、その前後でカーソル・選択・スクロール位置を
   * 控えて戻す。編集として適用しているので **Undo で戻せる**（読み込み直しで
   * 意図せず消えた編集を、その場で取り返せる）。
   */
  replaceContent(relativePath: string, source: EditorDocumentSource): void {
    const entry = this.entries.get(relativePath)

    if (entry === undefined) {
      return
    }

    const { model } = entry
    const editorShowsThis = this.editor !== null && this.editor.getModel() === model
    const viewState = editorShowsThis ? this.editor!.saveViewState() : entry.viewState

    if (model.getValue() !== source.content) {
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: source.content }],
        () => null
      )
    }

    entry.encoding = source.encoding
    entry.revision = source.revision
    entry.externalRevision = null
    entry.missing = false
    // 取り込んだ内容が「ディスクと同じ」の新しい基準になる。
    entry.savedVersionId = model.getAlternativeVersionId()

    if (viewState !== null) {
      entry.viewState = viewState

      if (editorShowsThis) {
        this.editor!.restoreViewState(viewState)
      }
    }

    this.notifyState(relativePath)
  }

  /* ------------------------------------------------- カーソル・スクロール */

  /** タブを離れる前に、見ていた位置を控える。 */
  saveViewState(relativePath: string, editor: monaco.editor.ICodeEditor): void {
    const entry = this.entries.get(relativePath)

    if (entry !== undefined) {
      entry.viewState = editor.saveViewState()
    }
  }

  /** タブへ戻ってきたときに、控えた位置へ戻す。 */
  restoreViewState(relativePath: string, editor: monaco.editor.ICodeEditor): void {
    const viewState = this.entries.get(relativePath)?.viewState

    if (viewState != null) {
      editor.restoreViewState(viewState)
    }
  }

  /* ------------------------------------------------------------- 破棄 */

  /**
   * その位置の Model を捨てる（タブを閉じた / 読み直す）。
   *
   * Model を残しておくと、閉じたはずのファイルの編集内容が
   * 開き直したときに戻ってくる。閉じる ＝ 編集を捨てる、で揃える。
   */
  release(relativePath: string): void {
    const entry = this.entries.get(relativePath)

    if (entry === undefined) {
      return
    }

    this.entries.delete(relativePath)
    entry.subscription.dispose()
    entry.model.dispose()

    /*
      Model が無くなった ＝ その文書はもう開いていない。**捨てた後に知らせる**
      ので、受け取った側が中身を取りに戻ることはない（`closed` は位置しか運ばない）。
    */
    this.emitSync(() => ({ kind: 'closed', relativePath }))

    // 未保存だったものが消えたことを、印を出している側へ伝える。
    this.notifyState(relativePath)
  }

  /**
   * すべて捨てる（Workspace を切り替えた / 閉じた）。
   *
   * **前の Workspace の Model が1つでも残っていると、その位置の相対パスは
   * 新しい Workspace の中の別のファイルを指す。** 保存すれば、開いてもいない
   * ファイルを別のプロジェクトの内容で上書きすることになる。
   */
  disposeAll(): void {
    for (const relativePath of [...this.entries.keys()]) {
      this.release(relativePath)
    }
  }

  /* ------------------------------------------- ディスク側の変化への追従 */

  /**
   * Workspace のファイルが変わったことを反映する。
   *
   * `editorTabsModel.ts` の `applyFileChanges` と**対になる**が、互いを知らない。
   * どちらも `files:changed`（§3.3）を独立に受け取って、自分の持ち物だけを直す。
   * 送る側（Files の操作）が受け手を知らずに済むのがこの経路の要点で、
   * 受け手が2つに増えてもその形は変わらない。
   *
   * | 変化                     | ここでの扱い                                       |
   * | ------------------------ | -------------------------------------------------- |
   * | 改名（ファイル / 親）    | 鍵を付け替える（Model はそのまま）                 |
   * | 削除（ファイル / 親）    | 未保存でなければ捨てる。未保存なら残して印を付ける |
   * | 作成                     | 何もしない                                         |
   * | 中身の変更（modified）   | ここでは扱わない（下記）                           |
   *
   * 改名で Model を作り直さないのは、未保存の編集と Undo 履歴を保つため。
   * タブ側が「開き直しにしない」ことにしてある（§10.3）のと同じ判断。
   *
   * ## 未保存のものは消えても捨てない
   *
   * 保存されていない内容は**この Model の中にしか無い**。ファイルが消えたからと
   * いって捨てると、利用者が一度も選んでいないのに編集が失われる。
   * タブ側（editorTabsModel.ts）が同じ判断で未保存のタブを残すため、
   * 互いを知らないまま結果が揃う（どちらも「未保存か」だけを見ている）。
   *
   * ## modified はここで扱わない
   *
   * 中身を取り込むには**ディスクを読み直す必要がある**（この層は IPC を知らない）。
   * どう扱うか（未保存でなければ取り込む / 未保存なら食い違いとして残す）は
   * useEditorSession.ts が決め、ここには markExternalChange / replaceContent として届く。
   */
  applyFileChanges(changes: readonly WorkspaceFileChange[]): void {
    for (const change of changes) {
      if (change.kind === 'created' || change.kind === 'modified') {
        continue
      }

      if (change.kind === 'deleted') {
        for (const relativePath of [...this.entries.keys()]) {
          if (!isAtOrUnder(change.relativePath, relativePath)) {
            continue
          }

          if (this.isDirty(relativePath)) {
            this.markMissing(relativePath)
          } else {
            this.release(relativePath)
          }
        }

        continue
      }

      for (const relativePath of [...this.entries.keys()]) {
        const rebased = rebaseRelativePath(
          relativePath,
          change.fromRelativePath,
          change.toRelativePath
        )

        if (rebased === null || rebased === relativePath) {
          continue
        }

        if (!this.entries.has(relativePath)) {
          continue
        }

        /*
          行き先に既に何かある場合（外から同名のものが作られていた等）は、
          そちらを捨ててから移す。同じ位置に2つの Model が対応する状態を作らない。
        */
        this.release(rebased)
        this.rekey(relativePath, rebased)
      }
    }
  }
}
