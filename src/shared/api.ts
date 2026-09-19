/**
 * Renderer に公開される API の型定義。
 *
 * この層は Main / Preload / Renderer のすべてから参照される「契約」であり、
 * OS 依存の型（NodeJS.* など）や Node.js の API を持ち込まないこと。
 * Renderer は DOM 環境、Main / Preload は Node 環境でコンパイルされるため、
 * ここに書けるのは純粋な型と定数のみとする。
 */

import type {
  CancelWorkspaceFileSearchRequest,
  CopyWorkspaceEntryRequest,
  CreateWorkspaceEntryRequest,
  DeleteWorkspaceEntryRequest,
  MoveWorkspaceEntryRequest,
  ReadWorkspaceDirectoryRequest,
  ReadWorkspaceFileRequest,
  RenameWorkspaceEntryRequest,
  SaveWorkspaceFileAsRequest,
  SearchWorkspaceFileContentsRequest,
  SearchWorkspaceFilesRequest,
  WriteWorkspaceFileRequest
} from './ipc/contracts/files'
import type {
  CreateDebugProfileRequest,
  DeleteDebugProfileRequest,
  EvaluateDebugExpressionRequest,
  ListDebugScopesRequest,
  ListDebugVariablesRequest,
  StartDebugRequest,
  ToggleDebugBreakpointRequest,
  UpdateDebugProfileRequest
} from './ipc/contracts/debug'
import type { IpcInvokeResult } from './ipc/contract'
import type {
  AddGitRemoteRequest,
  CommitAndPushGitChangesRequest,
  CommitGitChangesRequest,
  CreateGitBranchRequest,
  CreateGitTrackingBranchRequest,
  DeleteGitBranchRequest,
  DiscardGitChangesRequest,
  GetGitCommitDetailRequest,
  GetGitCommitFileDiffRequest,
  GetGitConflictDiffRequest,
  GetGitFileDiffRequest,
  GitStashEntryRequest,
  MergeGitBranchRequest,
  RemoveGitRemoteRequest,
  RenameGitBranchRequest,
  RenameGitRemoteRequest,
  ResolveGitConflictRequest,
  SetGitRemoteUrlRequest,
  StageGitChangesRequest,
  SwitchGitBranchRequest,
  UnstageGitChangesRequest
} from './ipc/contracts/git'
import type { PublishGitHubRepositoryRequest } from './ipc/contracts/github'
import type {
  ChangeLspDocumentRequest,
  CloseLspDocumentRequest,
  LspCompletionRequest,
  LspDefinitionRequest,
  LspFormattingRequest,
  LspHoverRequest,
  LspPrepareRenameRequest,
  LspReferencesRequest,
  LspRenameRequest,
  OpenLspDocumentRequest,
  SaveLspDocumentRequest
} from './ipc/contracts/lsp'
import type { IpcEventListener, IpcEventUnsubscribe } from './ipc/event'
import type { SaveSettingsSectionRequest } from './ipc/contracts/settings'
import type { SubmitFeedbackRequest } from './ipc/contracts/feedback'
import type { PingRequest } from './ipc/contracts/system'
import type {
  CreateTerminalSessionRequest,
  DisposeTerminalSessionRequest,
  ResizeTerminalRequest,
  WriteTerminalInputRequest
} from './ipc/contracts/terminal'
import type { RespondWindowCloseRequest } from './ipc/contracts/window'
import type { SaveWorkspaceLayoutRequest } from './ipc/contracts/workspace'

/** サポート対象プラットフォーム。v1 は win32 のみを対象とするが、将来の Mac 対応を妨げない形で定義する。 */
export type PlatformId = 'win32' | 'darwin' | 'linux'

/** 実行環境のバージョン情報。 */
export interface RuntimeVersions {
  readonly electron: string
  readonly chrome: string
  readonly node: string
}

/**
 * 実行環境の情報を提供する API。
 * Preload の時点で同期的に確定する値のみを扱うため、IPC を必要としない。
 */
export interface EnvApi {
  readonly platform: PlatformId
  readonly versions: RuntimeVersions
}

/**
 * IPC 基盤の疎通と、Main でしか取得できないアプリ情報を提供する API。
 *
 * system は機能ドメインではなく基盤ドメインであり、
 * Files / Terminal / GitHub の各 API はこれと同じ形（IPC 契約に対応する薄いメソッド群）で追加する。
 */
export interface SystemApi {
  /** Main との疎通確認。渡した token がそのまま返る。 */
  readonly ping: (request: PingRequest) => IpcInvokeResult<'system:ping'>
  /** アプリ名・バージョンなど Main が保持する情報を取得する。 */
  readonly getAppInfo: () => IpcInvokeResult<'system:app-info'>
}

/**
 * ウィンドウのライフサイクルに関わる API。
 *
 * 公開するのは「閉じてよいか尋ねられたこと」を受け取る口と、その返事の2つだけ。
 * **Renderer からウィンドウを閉じる / アプリを終了する手段は公開しない**
 * （それは Main の責務。ARCHITECTURE.md §1）。ここにあるのは
 * 「Main が閉じようとしている」に対して未保存の確認を挟むための経路で、
 * Renderer が閉じる操作の主導権を持つわけではない。
 */
export interface WindowApi {
  /**
   * ウィンドウを閉じてよいか尋ねられたときに呼ばれる。
   *
   * 受け取った `requestId` を `respondClose` にそのまま返すこと。
   * 返さない場合、Main 側の時間の上限を過ぎたところで閉じられる
   * （閉じられないアプリを作らないため。shared/ipc/contracts/window.ts）。
   */
  readonly onCloseRequested: (
    listener: IpcEventListener<'window:close-requested'>
  ) => IpcEventUnsubscribe
  /** 閉じてよいかの返事。 */
  readonly respondClose: (
    request: RespondWindowCloseRequest
  ) => IpcInvokeResult<'window:respond-close'>
}

/**
 * アプリの設定の永続化 API（Session 4-3A）。
 *
 * Workspace レイアウトと同じ形で、**保存先のパスもファイル名も Renderer からは
 * 指定できない**。加えて、書ける先は既知の section（`SettingsSectionId`）だけで、
 * 任意の名前・任意の JSON を渡す口は無い（shared/ipc/contracts/settings.ts）。
 *
 * 設定を足すときに増えるのはこの API のメソッドではなく section の key になる ──
 * Session 3-7-5 までは設定1つごとに読み書きの対を足していたが、
 * それは同じ形を写していただけだった。
 */
export interface SettingsApi {
  /** 保存済みの設定をすべて読む。未保存・破損の section は空で返る（＝既定で始まる）。 */
  readonly load: () => IpcInvokeResult<'settings:load'>
  /** 1つの section を保存する。書き込みの間引きは Main 側が行う。 */
  readonly saveSection: (
    request: SaveSettingsSectionRequest
  ) => IpcInvokeResult<'settings:save-section'>
}

/**
 * Workspace レイアウトの永続化 API。
 *
 * 公開するのは「今のレイアウトを預ける」「前回のレイアウトを受け取る」の2つだけで、
 * 保存先のパスもファイル名も Renderer からは指定できない。
 * 汎用のファイル読み書きを公開してしまうと、Renderer を OS から切り離している意味が
 * 無くなるため、レイアウト以外の用途にこの API を広げないこと
 * （別の永続化が必要になったら、その用途専用の API を足す）。
 */
export interface WorkspaceApi {
  /** 前回保存したレイアウトを読み込む。未保存・破損時は document が null になる。 */
  readonly loadLayout: () => IpcInvokeResult<'workspace:load-layout'>
  /** 今のレイアウトを保存する。書き込みの間引きは Main 側が行う。 */
  readonly saveLayout: (
    request: SaveWorkspaceLayoutRequest
  ) => IpcInvokeResult<'workspace:save-layout'>
}

/**
 * 開いているプロジェクトフォルダ（Workspace）を扱う API。
 *
 * 公開するのは「今どれを開いているか」「フォルダ選択ダイアログを出す」「閉じる」の3つだけ。
 * **フォルダの中身に触れる操作はここに置かない**（ファイルの列挙・読み書きは Files ドメインの担当）。
 *
 * 開く対象のパスを Renderer から渡せないことがこの API の要点になっている。
 * 選ぶのはネイティブのダイアログ（Main が出す）で、Renderer は「出して」としか言えない。
 */
export interface WorkspaceFolderApi {
  /** 今開いている Workspace を取得する。起動直後の復元にも使う。 */
  readonly getCurrent: () => IpcInvokeResult<'workspace-folder:get-current'>
  /** フォルダ選択ダイアログを開き、選ばれたフォルダを現在の Workspace にする。 */
  readonly open: () => IpcInvokeResult<'workspace-folder:open'>
  /** Workspace を閉じて未選択の状態へ戻す。 */
  readonly close: () => IpcInvokeResult<'workspace-folder:close'>
}

/**
 * 開いている Workspace の中のファイル / フォルダを扱う API。
 *
 * どのメソッドも受け取るのは **Workspace root からの相対位置**だけで、
 * **root を指定する手段は無い**（基点は Main が持つ現在の Workspace）。
 * 任意のパスを触れる汎用のファイル API を公開すると、Renderer を OS から
 * 切り離している前提がここで崩れるため、この API を「どこでも触れる」方向へ広げないこと。
 *
 * **書き換える側にも同じ線を引く。** 読むだけを守っても、作成 / リネーム / 削除から
 * Workspace の外に手が届けば意味が無い。相対位置の検証
 * （`..`・絶対パス・symlink / ジャンクションによる脱出）は、どの操作でも Main が行う。
 *
 * 移動（`move`）は Session 3-6-1 でこの形のまま足した ── 相対位置が2つになるだけで、
 * どちらの親も同じ検証を通る。コピーは後続セッションで、同じ検証を通す形で足す。
 */
export interface FilesApi {
  /** Workspace 内のフォルダ1つ分を列挙する。相対位置が空文字なら Workspace root。 */
  readonly readDirectory: (
    request: ReadWorkspaceDirectoryRequest
  ) => IpcInvokeResult<'files:read-directory'>
  /** ファイル1件の中身を読む。バイナリ・大きすぎる場合も失敗ではなく status で返る。 */
  readonly readFile: (request: ReadWorkspaceFileRequest) => IpcInvokeResult<'files:read-file'>
  /**
   * 既にあるファイルへ書き戻す（Editor の保存）。
   *
   * **新しいファイルは作らない。** 作成は `create` の担当で、そちらは親フォルダに対して
   * 境界を確かめる。保存は「今開いているファイル」への上書きなので、
   * 読み込みと同じく**対象そのもの**の実体を確かめる（外を指す symlink を通して
   * Workspace の外のファイルを書き換えられないようにするため）。
   *
   * 要求に添える `baseRevision` が今ディスクにある版と違えば、書かずに `'stale'` が返る。
   */
  readonly writeFile: (request: WriteWorkspaceFileRequest) => IpcInvokeResult<'files:write-file'>
  /**
   * 中身を、利用者が選んだ場所へ書き出す（別名で保存。Session 4-2）。
   *
   * **保存先を渡す引数が無い**のがこの口の要点。行き先を決めるのはネイティブの
   * 保存ダイアログ（Main が出す）だけで、Renderer は「出して」としか言えない
   * ── `workspaceFolder.open` と同じ形にしてある。
   *
   * `writeFile` と違い、**まだ存在しない場所へも書ける**（新しいファイルを作る）。
   * 既にあるファイルを選んだ場合の上書き確認は OS のダイアログが行い、
   * アプリ側で二重に訊かない。
   *
   * 利用者が Workspace の外を選んだ場合もそこへ書く。応答に絶対パスは載らず、
   * 外へ書けたときは `relativePath` が null になる。
   */
  readonly saveAs: (request: SaveWorkspaceFileAsRequest) => IpcInvokeResult<'files:save-as'>
  /** フォルダの中に新しいファイル / フォルダを作る。既に同名があれば CONFLICT。 */
  readonly create: (request: CreateWorkspaceEntryRequest) => IpcInvokeResult<'files:create'>
  /** 名前を変える（同じフォルダの中で完結する。移動は含まない）。 */
  readonly rename: (request: RenameWorkspaceEntryRequest) => IpcInvokeResult<'files:rename'>
  /**
   * 別のフォルダへ動かす（名前は変えない）。既に同名があれば CONFLICT。
   *
   * `rename` と別にしてあるのは、移動が**2つの場所**（元の親と移動先の親）を指す操作で、
   * その両方を境界に通す必要があるため。フォルダを自分自身の中へは動かせない。
   */
  readonly move: (request: MoveWorkspaceEntryRequest) => IpcInvokeResult<'files:move'>
  /**
   * 別のフォルダへ複製する（元はそのまま残る）。
   *
   * `move` と同じく相対位置を2つ受け取り、境界の検証も同じものを両方に通す。
   * 違うのは、**コピー先に同名のものがあっても断らない**点
   * （`example copy.txt` のように衝突しない名前を Main が作る。
   * shared/files/copyName.ts）。上書きはしない。
   *
   * 中に symlink / ジャンクションを含むフォルダは、その分だけとばして複製する
   * （辿ると Workspace の外の実体を中へ持ち込むことになるため）。
   * とばした件数は応答の `skippedCount` に入る。
   */
  readonly copy: (request: CopyWorkspaceEntryRequest) => IpcInvokeResult<'files:copy'>
  /** OS のごみ箱へ送る。完全削除の経路は公開しない。 */
  readonly remove: (request: DeleteWorkspaceEntryRequest) => IpcInvokeResult<'files:delete'>
  /**
   * Workspace 全体から名前で探す（Session 3-6-4）。
   *
   * 走査するのは Main で、**Renderer は Workspace を自分で歩かない**。
   * 起点は現在の Workspace root だけ（他のメソッドと同じく root は渡せない）で、
   * 返るのも相対位置を持つ FileEntry だけになる。
   *
   * 件数・深さ・走査数・時間に上限があり（shared/files/search.ts）、
   * 当たった場合は結果とともに truncated / limit で伝わる。
   * 進行中の検索は `cancelSearch` で止められ、**新しい検索を始めると
   * 古い検索は Main 側で必ず止まる**（同時に走るのは常に1つ）。
   */
  readonly search: (request: SearchWorkspaceFilesRequest) => IpcInvokeResult<'files:search'>
  /**
   * Workspace 全体のファイルの**中身**から探す（Session 3-6-5）。
   *
   * `search`（名前）と同じ形で、渡すのは検索語と識別子だけ。違うのは、
   * Main が対象のファイルを1件ずつ開いて読むという点で、そのぶん上限も別になる
   * （読むファイル数・1ファイルの大きさ・一致の総数・1ファイル内の一致数・時間。
   * shared/files/contentSearch.ts）。
   *
   * 返るのはファイル単位にまとめた一致で、1件ごとに行・桁・周辺のテキストを持つ。
   * **絶対パスは相変わらず出てこない。** バイナリ・大きすぎるファイル・
   * `.git` / `node_modules` は読まずにとばす。
   *
   * 取り消しは `cancelSearch` を共有する（走っているのは常に1本で、
   * 名前の検索を始めれば全文検索は止まり、その逆も同じ）。
   */
  readonly searchContent: (
    request: SearchWorkspaceFileContentsRequest
  ) => IpcInvokeResult<'files:search-content'>
  /** 進行中の検索を取り消す。もう走っていなければ何も起きない（失敗にはしない）。 */
  readonly cancelSearch: (
    request: CancelWorkspaceFileSearchRequest
  ) => IpcInvokeResult<'files:cancel-search'>
  /**
   * Workspace の中のファイルが変わったときに呼ばれる。
   *
   * Main → Renderer のイベント（shared/ipc/event.ts）を公開する最初のもの。
   * 渡ってくるのは payload だけで、Electron の event オブジェクトは Preload が剥がす。
   *
   * アプリの中の操作（作成 / 改名 / 削除）と、**アプリの外での変更**（ファイル監視）の
   * 両方がここに届く。どちらかは payload の `source` が持つ。
   * **Renderer に filesystem の監視 API は公開しない** ── 監視するのは Main で、
   * Renderer が受け取るのは相対位置の付いた変化だけになる。
   *
   * 戻り値は購読の解除。React の useEffect からそのまま返せる形にしてある。
   */
  readonly onChanged: (listener: IpcEventListener<'files:changed'>) => IpcEventUnsubscribe
}

/**
 * Terminal（シェルのセッション）を扱う API。
 *
 * ## 公開しているのは「どれが開ける？」「1つ作って」「これを流して」「この大きさで」「もう要らない」の5つ
 *
 * **起動する実行ファイルも、作業ディレクトリも渡せない。** 前者は Main が持つ表
 * （main/terminal/shellCommand.ts）が、後者は Main が持つ現在の Workspace が決める。
 * `workspaceFolder.open` に開く対象のパスを渡せないのと同じ形で、
 * ここでも Renderer が言えるのは「**この行の**ターミナルを1つ」までに留まる
 * （Session 3-7-2 で足した shellId は、表の行を指すだけの閉じた集合。
 * shared/terminal/shell.ts）。
 *
 * Files では「Workspace の外を指せないこと」を相対位置だけを受け取ることで担保したが、
 * Terminal では同じ手が使えない ── 起動したシェルの中で `cd ..` を止めることに
 * 意味は無いためで、そこを止めれば道具として成立しない。
 * そこで境界を**起動の入口**へずらしてある（shared/ipc/contracts/terminal.ts）。
 *
 * ## 出力は購読で受ける
 *
 * シェルからの出力は要求と応答にならないため、`files.onChanged` と同じく
 * Main → Renderer のイベントとして受け取る。届くのは**文字列だけ**で、
 * Main は中身を解釈しない（読むのは xterm.js だけ）。
 */
export interface TerminalApi {
  /**
   * この環境で起動できるシェルの一覧。
   *
   * 表そのものは Main にあり、ここへ返るのは**表示名と、選べるかどうか**だけ。
   * タブを開く入口（`+` の隣のメニュー）はこの応答から組み立てる。
   */
  readonly listShells: () => IpcInvokeResult<'terminal:list-shells'>
  /**
   * 今なにかを実行しているセッションを尋ねる（Session 3-7-4）。
   *
   * **終わらせる前に確認を出すかどうか**を決めるためだけの問い合わせで、
   * 返るのはセッションの id だけ（何が動いているかは載らない）。
   * 「実行中」の定義を持っているのは Main になる
   * ── そのシェルが子プロセスを持っているか（main/terminal/childProcesses.ts）。
   */
  readonly listBusy: () => IpcInvokeResult<'terminal:list-busy'>
  /**
   * ターミナルを1つ起動する。
   *
   * Workspace が開かれていなければ失敗する ── 作業ディレクトリの正本が
   * そこにしか無く、代わりに使ってよい既定の場所というものが無いため
   * （勝手にホームで開くと、DESIGN.md §3 の「4つのパネルは今開いているフォルダを
   * 共通の対象にする」から Terminal だけが外れる）。
   */
  readonly create: (request: CreateTerminalSessionRequest) => IpcInvokeResult<'terminal:create'>
  /** 打鍵・貼り付け・制御文字をそのままシェルへ流す。加工はしない。 */
  readonly write: (request: WriteTerminalInputRequest) => IpcInvokeResult<'terminal:write'>
  /** 画面の大きさ（文字数）を伝える。折り返しの位置を実際のシェルと合わせるために要る。 */
  readonly resize: (request: ResizeTerminalRequest) => IpcInvokeResult<'terminal:resize'>
  /**
   * セッションを終わらせる。
   *
   * **パネルを閉じた / 動かしただけでは呼ばない。** セッションの寿命は
   * パネルの表示より長い（renderer/src/terminal/terminalScreenStore.ts）。
   */
  readonly dispose: (request: DisposeTerminalSessionRequest) => IpcInvokeResult<'terminal:dispose'>
  /** シェルからの出力。届いた順にそのまま画面へ流す。 */
  readonly onData: (listener: IpcEventListener<'terminal:data'>) => IpcEventUnsubscribe
  /** シェルが終了した（`exit` と打たれた・アプリが片付けた・落ちた）。 */
  readonly onExit: (listener: IpcEventListener<'terminal:exit'>) => IpcEventUnsubscribe
}

/**
 * その Workspace を Git リポジトリとして扱う API（Session 3-8-1）。
 *
 * ## 公開しているのは「今どうなっている？」の1つだけ
 *
 * **コマンドも引数も作業ディレクトリも渡せない。** Terminal では「表のどの行か」を
 * 渡せるようにしたが（shared/terminal/shell.ts）、ここではその欄すら無く、
 * Renderer が言えるのは「今の Workspace について調べて」までになる。
 *
 * 何を実行するか（引数の組み立て）・どこで実行するか（今の Workspace）・
 * git 本体がどこに在るか（PATH を辿って確かめた絶対パス）は、すべて Main が持つ
 * （main/git/）。
 *
 * ## 汎用の Git 実行 API は作らない
 *
 * `run(command, args)` のような形は、この API に**足さない**。`git` は
 * `-c core.pager=<任意のコマンド>` や `-c alias.x=!<任意のコマンド>` で
 * 任意の実行ファイルを起動できるため、引数を渡せる API は実質
 * 「Renderer から任意のコマンドを実行できる API」になる。
 * Files が絶対パスを受け取らないのと同じく、**弾くのではなく渡せる欄を作らない。**
 *
 * Session 3-8-2 以降で足す操作（Stage / Commit / Push / Pull / ブランチ切り替え）も、
 * この API にメソッドを1つずつ足す形にする。要求に載るのはその操作に固有の値だけで、
 * git の引数そのものは載らない。
 */
export interface GitApi {
  /**
   * 今の Workspace が Git 操作の対象になるかを調べる。
   *
   * 返るのは分類された状態で、失敗としては返らない（shared/git/repository.ts）。
   * Git が入っていない・リポジトリではない・Workspace root がリポジトリ root と
   * 食い違う、はどれも Git パネルが平常時に出す表示にあたる。
   *
   * **調べるのは呼ばれたときだけ**で、Main が勝手に状態を押し出すことはしない。
   * 呼ぶのは Git パネルを出したとき・Workspace が切り替わったとき・利用者が
   * 更新したとき・作業ツリーが変わったとき（`files.onChanged`）・`.git` が
   * 変わったとき（`onChanged`。Session 3-8-8）になる。
   */
  readonly getRepository: () => IpcInvokeResult<'git:get-repository'>
  /**
   * 今の Workspace を Git リポジトリにする（Session 3-8-10）。
   *
   * **引数が無い。** どこを初期化するかも、初期ブランチ名も渡せない ──
   * 対象は常に「今の Workspace」で、それを持っているのは Main になる
   * （shared/ipc/contracts/git.ts）。
   *
   * **これだけで終わる操作**にしてある。初回 Commit も `.gitignore` の生成も
   * GitHub への公開も続けて行わない ── 何を最初の commit に含めるかは
   * 利用者の判断で、アプリが決めてよいことではない。
   *
   * 応答には初期化後の状態が入っているため、呼んだ側が続けて
   * `getRepository()` を呼ぶ必要は無い。
   */
  readonly init: () => IpcInvokeResult<'git:init'>
  /**
   * index に載せる（Session 3-8-3）。
   *
   * 渡せるのは「Workspace root からの相対位置1つ」か「どのグループか」だけで、
   * git の引数は載らない（shared/ipc/contracts/git.ts）。
   *
   * 応答には**操作後のリポジトリの状態**が入っているため、呼んだ側が
   * 続けて `getRepository()` を呼ぶ必要は無い ── 2回に分けると、その間の変化で
   * 一覧が別の瞬間の写しになる。
   */
  readonly stage: (request: StageGitChangesRequest) => IpcInvokeResult<'git:stage'>
  /**
   * index から外す（Session 3-8-3）。**作業ツリーには触らない。**
   *
   * 初回 commit 前（HEAD がまだ無い）かどうかで Main が経路を選ぶ ──
   * 呼ぶ側がその区別を持つ必要は無い（main/git/gitStage.ts）。
   */
  readonly unstage: (request: UnstageGitChangesRequest) => IpcInvokeResult<'git:unstage'>
  /**
   * ステージ済みの変更を Commit する（Session 3-8-4）。
   *
   * 渡せるのは Commit メッセージだけで、**何を Commit するかは渡せない**
   * （対象は index の中身そのもの）。amend / no-verify / allow-empty /
   * author / date / sign の欄も無い（shared/ipc/contracts/git.ts）。
   *
   * メッセージは引数ではなく git の標準入力へ渡る（main/git/gitCommands.ts）。
   * 応答には Commit 後のリポジトリの状態が入っているため、呼んだ側が
   * 続けて `getRepository()` を呼ぶ必要は無い。
   */
  readonly commit: (request: CommitGitChangesRequest) => IpcInvokeResult<'git:commit'>
  /**
   * 今のブランチを追跡先へ送る（Session 3-8-5）。
   *
   * **引数が無い。** remote 名もブランチ名も refspec も渡せず、送り先は
   * リポジトリの設定から Main が決める（shared/ipc/contracts/git.ts）。
   * 追跡先がまだ無ければ、この1回の中で `--set-upstream` まで行う。
   *
   * 強制 Push の口は無い（`--force` / `--force-with-lease`）。
   */
  readonly push: () => IpcInvokeResult<'git:push'>
  /**
   * 追跡先の変更を取り込む（Session 3-8-5）。
   *
   * 中身は `fetch` と `merge --ff-only` の2つで、`git pull` は使わない ──
   * `pull.rebase` の設定で振る舞いが変わり、同じボタンが PC ごとに
   * 違う履歴を作ることになる。早送りできなければ取り込まずに `diverged` で返る。
   */
  readonly pull: () => IpcInvokeResult<'git:pull'>
  /**
   * remote から取ってくるだけ（`fetch --prune`。Session 3-8-22A）。
   *
   * **引数が無い**（Push / Pull と同じ）。相手を決めるのはリポジトリの設定で、
   * remote 名も refspec も渡す欄が無い。
   *
   * Pull と違って**取り込まない** ── 動くのは remote-tracking ref だけで、
   * HEAD も index も作業ツリーも1つも変わらない。追跡先が無いブランチでも
   * 押せるのはそのためで、3-8-19 の remote の枝の一覧を新しくする唯一の口に
   * あたる（shared/ipc/contracts/git.ts）。
   */
  readonly fetch: () => IpcInvokeResult<'git:fetch'>
  /**
   * Commit してから Push する（Session 3-8-5）。
   *
   * Renderer から `commit()` → `push()` と続けて呼ぶのとは別物になる ──
   * こちらは Commit・Push・状態の読み直しがまるごと1つの順番待ちの枠に入り、
   * その間に別の Git 操作が挟まらない（main/git/gitQueue.ts）。
   *
   * Commit は通ったのに Push が通らなかった場合、`outcome` は
   * `partly-applied` で返る（失敗に丸めない。shared/git/operation.ts）。
   */
  readonly commitAndPush: (
    request: CommitAndPushGitChangesRequest
  ) => IpcInvokeResult<'git:commit-and-push'>
  /**
   * ローカルブランチの一覧を尋ねる（Session 3-8-6）。
   *
   * **引数が無い。** remote-tracking branch も、並べ替えも、絞り込みも
   * 指定できない ── 出てくるのは常に「今の Workspace のローカルブランチを
   * git が返した順で、上限まで」になる（shared/git/branch.ts）。
   *
   * 呼ぶのは**選ぶ面を開いたとき**で、覚えておいたものを出さない。
   * `.git` の監視（Session 3-8-8）が届くのは「状態が変わった」という合図までで、
   * ブランチの一覧はそこに相乗りさせていない ── 見られているのは面が開いている
   * 一瞬だけで、相乗りさせると保存のたびにブランチを数え直すことになる。
   */
  readonly listBranches: () => IpcInvokeResult<'git:list-branches'>
  /**
   * commit の履歴を尋ねる（Session 3-8-11）。
   *
   * **引数が無い。** rev も件数も並べ替えも絞り込みも渡せず、返るのは常に
   * 「今の HEAD からさかのぼった 100 件」になる（shared/git/history.ts）。
   * 別のブランチの履歴を見る手立ては、上のバーでそのブランチへ切り替えること
   * そのものになる。
   *
   * 呼ぶのは**履歴を開いたとき**と、開いている間に `.git` が変わったとき
   * （`onChanged`）の2つだけ。ファイルの保存（`files.onChanged`）では
   * 呼ばない ── 作業ツリーをいくら書き換えても履歴は1行も変わらない。
   *
   * commit が1つも無いリポジトリでは、失敗ではなく**空の一覧**として返る。
   */
  readonly listCommits: () => IpcInvokeResult<'git:list-commits'>
  /**
   * commit 1件の変更ファイルを尋ねる（Session 3-8-12）。
   *
   * **渡せるのは履歴の行が持っていた短い hash 1つだけ。** `HEAD~5` のような
   * rev 表記も、pathspec も、`--stat` のような整形の指定も欄が無い
   * （shared/ipc/contracts/git.ts）── 指せるのは、既に画面に出ている行になる。
   *
   * マージ commit では `merge` として返る。**失敗ではなく答え**にあたり、
   * 画面はその理由をそのまま出す（shared/git/commitDetail.ts）。
   *
   * 呼ぶのは履歴の行を押したときの1回だけで、`.git` の変化では呼び直さない ──
   * 記録された commit の中身は変わらない。
   */
  readonly getCommitDetail: (
    request: GetGitCommitDetailRequest
  ) => IpcInvokeResult<'git:get-commit-detail'>
  /**
   * commit の中の1ファイルの差分を尋ねる（Session 3-8-12）。
   *
   * `getFileDiff` と同じく、返るのは patch ではなく**中身2つ**になる
   * （左が親の tree の側、右がこの commit の tree の側）。`group` を渡さないのは、
   * commit の差分では比べる相手が常に1組で選ぶ余地が無いため。
   *
   * バイナリ・2MB 超・見つからない、はどれも失敗ではなく分類として返る ──
   * 表そのものが `getFileDiff` と共通になる（shared/git/diff.ts）。
   */
  readonly getCommitFileDiff: (
    request: GetGitCommitFileDiffRequest
  ) => IpcInvokeResult<'git:get-commit-file-diff'>
  /**
   * 別のローカルブランチへ切り替える（Session 3-8-6）。
   *
   * 渡せるのは名前だけで、`--force` / `--merge` / start point の欄は無い
   * （shared/ipc/contracts/git.ts）── 切り替えてよいかを決めるのは git 自身で、
   * アプリはその判断を上書きしない。
   *
   * 応答には**切り替えた後のリポジトリの状態**が入っているため、呼んだ側が
   * 続けて `getRepository()` を呼ぶ必要は無い。
   */
  readonly switchBranch: (request: SwitchGitBranchRequest) => IpcInvokeResult<'git:switch-branch'>
  /**
   * 今の場所から新しいブランチを作って、そこへ切り替える（Session 3-8-6）。
   *
   * 作るだけ（切り替えない）の口は無い ── 分けると「作ったのに切り替わって
   * いない」状態が生まれ、その後の Commit が意図しないブランチに積まれる。
   *
   * 同じ名前が既にあれば `branch-exists` として返り、**上書きはしない**
   * （shared/git/operation.ts）。
   */
  readonly createBranch: (request: CreateGitBranchRequest) => IpcInvokeResult<'git:create-branch'>
  /**
   * ローカルブランチを削除する（Session 3-8-14）。
   *
   * 渡せるのは名前だけで、**`--force`（`-D`）の欄は無い** ── そこにしか無い
   * commit があるブランチは git が断り（`branch-not-merged`）、アプリは
   * その判断を上書きしない（shared/git/operation.ts）。
   *
   * 今チェックアウトされているブランチも消せない。こちらは**読んだ状態から
   * 分かる**ので git を動かす前に返る（`branch-checked-out`）。
   *
   * 作業ツリーには何も起こらない ── 消えるのは ref 1つと、その reflog になる。
   */
  readonly deleteBranch: (request: DeleteGitBranchRequest) => IpcInvokeResult<'git:delete-branch'>
  /**
   * ローカルブランチの名前を変える（Session 3-8-14）。
   *
   * 渡すのは「どれを」と「何に」の2つで、どちらも同じ検証
   * （`normalizeGitBranchName`）を通る。今そこに居るブランチも改名でき、
   * その場合は HEAD が追随する（未コミットの変更はそのまま残る）。
   *
   * 行き先が**別の既にあるブランチ**なら `branch-exists` として断り、
   * 名前を奪うことはしない（`-M` の欄は無い）。大文字小文字だけを変える
   * 改名は通る ── そのとき「既にある」と指されるのは改名しようとしている
   * ブランチ自身だから（main/git/gitBranches.ts）。
   *
   * 追跡先は**付け替えない。** rename の後の Push は、改名前の名前の
   * remote branch へ向かう（shared/ipc/contracts/git.ts）。
   */
  readonly renameBranch: (request: RenameGitBranchRequest) => IpcInvokeResult<'git:rename-branch'>
  /**
   * ローカルブランチを今のブランチへ取り込む（Session 3-8-20）。
   *
   * 渡せるのは**相手の名前1つ**だけ。取り込み先は常に今のブランチで、
   * 戦略（`-X ours` / `-X theirs`）も `--no-ff` も `--squash` も
   * `--no-commit` も渡す欄が無い ── 動く引数は Main の表に固定してある
   * （`merge --quiet --no-edit --ff --no-autostash`。main/git/gitCommands.ts）。
   *
   * `--ff` を明示するので、早送りできるときは**merge commit を作らない** ──
   * PC ごとの `merge.ff` 設定で振る舞いが変わらない。`--no-autostash` も
   * 同じ理由で明示する（アプリが見えない stash を作らない）。
   *
   * 相手は tag でも commit hash でも remote-tracking branch でもなく、
   * **その綴りちょうどのローカルブランチ**でなければ動かない
   * （main/git/gitMerge.ts が `branch --list` で確かめる）。
   *
   * 競合したときは `partly-applied`（`completed: 'merge'`）で返り、
   * 応答の状態は `inProgress: 'merge'` になる ── そこから先は 3-8-18 の
   * 「解決済みにする」→ Commit がそのまま続きになる。
   */
  readonly mergeBranch: (request: MergeGitBranchRequest) => IpcInvokeResult<'git:merge-branch'>
  /**
   * 途中のマージをやめる（Session 3-8-20）。
   *
   * **引数が無い。** 途中のマージは常に高々1つで、それは `MERGE_HEAD` が指す。
   * マージ中でなければ git を1回も動かさずに `nothing-to-do` として返る。
   *
   * 戻るのは**マージを始める前の状態**で、そこから在った作業ツリーの変更は
   * 残る。一方、**競合の解決中に書いた内容・stage したものは消える**
   * （実物で確かめてある）── だから押す前に確認を挟む
   * （renderer/src/git/GitView.tsx）。
   */
  readonly abortMerge: () => IpcInvokeResult<'git:abort-merge'>
  /**
   * git が用意したマージ commit のメッセージを尋ねる（Session 3-8-22A）。
   *
   * **引数が無い。** 途中のマージは高々1つで、その既定のメッセージも1つになる。
   *
   * 呼ぶのは**マージの途中に入った1回だけ**で、`.git` の変化では呼び直さない
   * ── 書き換えている最中の入力欄を上書きしないため（3-8-12 の
   * `getCommitDetail` と同じ形）。用意されていなければ `message` は null で、
   * それは失敗ではない。
   */
  readonly getMergeMessage: () => IpcInvokeResult<'git:get-merge-message'>
  /**
   * remote-tracking branch の一覧を尋ねる（Session 3-8-19）。
   *
   * **引数が無い。** remote 名で絞る欄も並べ替えも件数も渡せず、
   * **fetch もしない** ── 返るのは常に「今の Workspace の `refs/remotes/` に
   * **既に**在るものを、上限まで」になる（shared/git/remoteBranch.ts）。
   *
   * `listBranches` と別の口にしてあるのは、動かす git が違い・上限が別々に効き・
   * 押したときに起きることが違うため（shared/ipc/contracts/git.ts）。
   * 各 remote の symbolic HEAD（`origin/HEAD`）は返らない ── あれは
   * 「どのブランチが既定か」を指す**別名**で、選んで手元に作る相手ではない。
   *
   * 呼ぶのは**ブランチの面を開いたとき**だけで、`onChanged` には乗らない
   * （`listBranches` とまったく同じ契機になる）。
   */
  readonly listRemoteBranches: () => IpcInvokeResult<'git:list-remote-branches'>
  /**
   * remote-tracking branch を追うローカルブランチを作って、切り替える
   * （Session 3-8-19）。
   *
   * 渡すのは「どれを追うか」（一覧の行が持っていた `origin/feature` のような
   * 名前）と「手元で何という名前にするか」の2つで、どちらも
   * `normalizeGitBranchName` を通る。追跡先は**必ず付く**（`--track`）──
   * 付けない作成は `createBranch` が既にその形で、`--no-track` の欄は無い。
   *
   * 同じ名前のローカルブランチが既にあれば、**git を1度も動かさずに**
   * `branch-exists` として断る（main/git/gitRemoteBranches.ts）── 上書きも
   * 削除も、既にあるブランチへの自動切替も行わない。
   *
   * 渡した名前が `refs/remotes/` の下に無ければ `branch-not-found` になる ──
   * ローカルブランチ名を渡して「ローカルを追うブランチ」を作ることはできない。
   */
  readonly createTrackingBranch: (
    request: CreateGitTrackingBranchRequest
  ) => IpcInvokeResult<'git:create-tracking-branch'>
  /**
   * remote の一覧を尋ねる（Session 3-8-16）。
   *
   * **引数が無い。** 並べ替えも絞り込みも件数も渡せず、返るのは常に
   * 「今の Workspace に登録されている remote を、上限まで」になる。
   *
   * **返るのは名前と表示用のラベルだけで、URL は返らない**
   * （shared/git/remote.ts）── ラベルからは URL を組み立て直せない形にしてある。
   *
   * 呼ぶのは**remote の面を開いたとき**と、開いている間に `.git` が変わったとき
   * （`onChanged`）の2つ ── 退避とまったく同じ契機になる。閉じている間は
   * 一度も取りに行かない。
   */
  readonly listRemotes: () => IpcInvokeResult<'git:list-remotes'>
  /**
   * remote を1つ追加する（Session 3-8-16）。
   *
   * 渡すのは名前と URL の2つで、どちらも shared の規則
   * （`normalizeGitRemoteName` / `normalizeGitRemoteUrl`）を通る。
   * URL に通る形は `https://…` / `ssh://…` / `user@host:path` の3つだけで、
   * 認証情報を含む URL は断る（shared/git/remoteUrl.ts）。
   *
   * **ネットワークへは出ない。** `--fetch` の欄が無く、この1回で起きるのは
   * 設定に1行増えることだけになる（shared/ipc/contracts/git.ts）。
   * 追跡先も付かない ── それが付くのは Push が通ったときだけ。
   *
   * 同じ名前が既にあれば `remote-exists` として返り、**上書きはしない**
   * （URL を変えるのは別の口。`setRemoteUrl`）。
   *
   * 応答には追加後のリポジトリの状態が入っているため、呼んだ側が続けて
   * `getRepository()` を呼ぶ必要は無い ── ただし一覧は載らないので、
   * 面を開いたままなら `listRemotes()` を取り直す。
   */
  readonly addRemote: (request: AddGitRemoteRequest) => IpcInvokeResult<'git:add-remote'>
  /**
   * remote の URL を変える（Session 3-8-17）。
   *
   * 渡すのは名前と URL の2つで、**追加とまったく同じ規則**を通る
   * （`normalizeGitRemoteName` / `normalizeGitRemoteUrl`）── 入口を分けると
   * 「追加では通らないが変更では通る URL」が生まれる。
   *
   * **ネットワークへは出ない。** 変わるのは `remote.<名前>.url` の1行だけで、
   * refspec も remote-tracking ref も追跡先も動かない ── したがって画面の
   * `↑2 ↓1` は変更後も**前の送り先と比べた数のまま**残る
   * （shared/ipc/contracts/git.ts）。押す前に確認を挟むのはそのためになる。
   *
   * 同じ URL を渡しても失敗にはならない ── 変わらない値で上書きしても、
   * 壊れるものも失われるものも無い。
   *
   * 無い remote を指すと `remote-not-found` として返り、**他の remote の
   * URL は1文字も変わらない**。
   */
  readonly setRemoteUrl: (request: SetGitRemoteUrlRequest) => IpcInvokeResult<'git:set-remote-url'>
  /**
   * remote の名前を変える（Session 3-8-17）。
   *
   * 渡すのは名前2つで、**どちらも同じ規則**（`normalizeGitRemoteName`）を通る。
   *
   * 削除 + 追加とは結果が違う ── `git remote rename` は remote-tracking ref も
   * 追っていたブランチの追跡先も `remote.pushDefault` も全部追随させるため、
   * **失われるものが1つも無い**（shared/ipc/contracts/git.ts）。したがって
   * 確認は挟まない（3-8-14 のブランチの rename と同じ）。
   *
   * 大文字小文字だけを変える改名は**通らない** ── Windows では git が
   * 途中まで適用したまま落ちるため、その手前で `unsupported-target` として
   * 断る（Renderer 側でも押せない）。
   *
   * 行き先が既にあれば `remote-exists`、元が無ければ `remote-not-found` で、
   * どちらの場合も**手元の remote は1つも変わらない**。
   */
  readonly renameRemote: (request: RenameGitRemoteRequest) => IpcInvokeResult<'git:rename-remote'>
  /**
   * remote を1つ削除する（Session 3-8-16）。
   *
   * 渡せるのは名前だけ。消えるのは設定（`remote.<名前>.*`）と
   * remote-tracking ref、そして**その remote を追っていたブランチの追跡先**に
   * なる ── commit は1つも失われない（shared/ipc/contracts/git.ts）。
   *
   * 一括で消す口は無い。押す前に確認を挟む（確認そのものは Renderer 側の
   * 話で、この要求に「確認したか」の欄は無い）。
   */
  readonly removeRemote: (request: RemoveGitRemoteRequest) => IpcInvokeResult<'git:remove-remote'>
  /**
   * 退避の一覧を尋ねる（Session 3-8-15）。
   *
   * **引数が無い。** 並べ替えも絞り込みも件数も渡せず、返るのは常に
   * 「新しい方から上限まで」になる（shared/git/stash.ts）。退避はブランチに
   * 属さないため、「このブランチのものだけ」という欄は在りようが無い。
   *
   * 呼ぶのは**退避の面を開いたとき**と、開いている間に `.git` が変わったとき
   * （`onChanged`）の2つ ── 履歴とまったく同じ契機になる。閉じている間は
   * 一度も取りに行かない。
   */
  readonly listStashes: () => IpcInvokeResult<'git:list-stashes'>
  /**
   * 作業ツリーの変更を退避する（Session 3-8-15）。
   *
   * **引数が無い。** 名前も、未追跡を含めるかも、対象の位置も渡せない
   * （shared/ipc/contracts/git.ts）── 退避するのは常に「今の作業ツリーと
   * index の全部」で、名乗りは git が付ける。
   *
   * 退避するものが無いとき（未追跡しか無い場合を含む）は git を動かさず
   * `nothing-to-do` で返る ── `git stash push` は何も無くても **0 で終わる**
   * ため、そのままでは「押したのに何も起きていない」を成功として返すことになる。
   */
  readonly stashPush: () => IpcInvokeResult<'git:stash-push'>
  /**
   * 指した退避を作業ツリーへ戻し、一覧から取り除く（Session 3-8-15）。
   *
   * 渡すのは「位置」と「その位置に居るはずの退避の hash」の2つで、
   * **hash が合わなければ git を動かさずに断る**（`stash-not-found`）──
   * 番号は次の瞬間には別のものを指しうる（shared/git/stash.ts）。
   *
   * 競合したときは `partly-applied` で返る（中身は戻っており、退避も一覧に
   * 残っている）── `failed` に丸めると、押し直して二重に断られることになる。
   */
  readonly stashPop: (request: GitStashEntryRequest) => IpcInvokeResult<'git:stash-pop'>
  /**
   * 指した退避を捨てる（Session 3-8-15）。
   *
   * `stashPop` とまったく同じ2つを渡し、同じ突き合わせを通る。**戻す先が
   * 無い操作**なので、押す前に確認を挟む（確認そのものは Renderer 側の話で、
   * この要求に「確認したか」の欄は無い）。
   *
   * 一括で捨てる口（`git stash clear`）は持たない。
   */
  readonly stashDrop: (request: GitStashEntryRequest) => IpcInvokeResult<'git:stash-drop'>
  /**
   * 1行の差分を尋ねる（Session 3-8-9）。
   *
   * 渡せるのは「どの行か」（位置1つ + グループ1つ）だけで、rev も
   * `--cached` も `--textconv` も渡せない（shared/ipc/contracts/git.ts）。
   *
   * 返るのは patch ではなく**中身2つ**（左に出すもの / 右に出すもの）になる。
   * どこが変わったかを決めるのは Renderer 側の Monaco で、`git diff` の
   * 出力を解析する経路はどこにも無い（shared/git/diff.ts）。
   *
   * バイナリ・2MB 超・見つからない、はどれも失敗ではなく分類として返る ──
   * 差分を出せない理由は、利用者の次の一手がそれぞれ違う。
   */
  readonly getFileDiff: (request: GetGitFileDiffRequest) => IpcInvokeResult<'git:get-file-diff'>
  /**
   * 競合している1件の ours / theirs を尋ねる（Session 3-8-21）。
   *
   * `getFileDiff` と**別の口**にしてある ── 渡すのは位置1つだけで `group` は
   * 無く、返るのも別の型（`GitConflictFileDiff`）になる。左右に時間の向きが
   * 無く（前 → 後ではない）、比べる相手は常に index の stage 2 と stage 3 に
   * 固定される（shared/ipc/contracts/git.ts）。
   *
   * **段を指せる欄は無い。** base（stage 1）は返らず、`--ours` / `--theirs` を
   * 作業ツリーへ採る働きもこの口には無い ── 読むだけで、リポジトリは
   * 1バイトも動かない。
   *
   * 片側にファイルが無い競合（`DD` / `AU` / `UA` / `UD` / `DU`）でも
   * **失敗にはならない** ── その側が空文字で返り、どちらに無いかは
   * `shape` から決まる（shared/git/conflictDiff.ts）。
   */
  readonly getConflictDiff: (
    request: GetGitConflictDiffRequest
  ) => IpcInvokeResult<'git:get-conflict-diff'>
  /**
   * 作業ツリーの変更を破棄する（Session 3-8-9）。
   *
   * 渡せるのは1件だけで、**グループの「すべて」は無い。** `staged` も
   * `conflicted` も渡せず、ステージ済みを戻すには先に `unstage()` を通る
   * （shared/git/operation.ts）。
   *
   * 未追跡のファイルは git ではなく **OS のごみ箱**へ送られる ──
   * `git clean` は使わない（戻せる形を残すため。ARCHITECTURE.md §14.16）。
   *
   * 応答には破棄した後のリポジトリの状態が入っているため、呼んだ側が
   * 続けて `getRepository()` を呼ぶ必要は無い。
   */
  readonly discard: (request: DiscardGitChangesRequest) => IpcInvokeResult<'git:discard'>
  /**
   * 競合している1件を「解決済み」として記録する（Session 3-8-18）。
   *
   * **`stage()` とは別の口**にしてある ── 動く git は同じ `git add` だが、
   * こちらは index の3段（base / ours / theirs）を1段に畳む操作で、
   * 意味が違う（shared/ipc/contracts/git.ts）。
   *
   * 渡せるのは競合しているファイル1件だけ。グループの「すべて」は無い。
   *
   * **作業ツリーには触らない。** 利用者がエディタで書いた解決内容は
   * 1文字も動かず、記録されるのはその中身そのものになる。
   *
   * 競合マーカーが残っていれば `conflict-markers-present` として返り、
   * **git は1回も動かない**（`git diff --check` で先に確かめる）。
   *
   * 取り消す口は無い ── `reset` は競合を復元せず、`checkout --merge` は
   * 解決内容を上書きするため（3-8-18 の範囲外）。
   */
  readonly resolveConflict: (
    request: ResolveGitConflictRequest
  ) => IpcInvokeResult<'git:resolve-conflict'>
  /**
   * リポジトリの状態が変わったときに呼ばれる（Session 3-8-8）。
   *
   * 届くのは**合図だけ**で、何が変わったかは載らない（`workspaceId` のみ）。
   * 受け手がすることは常に1つ ── `getRepository()` を呼び直す。ブランチ名と
   * 変更一覧はその1回の応答に揃って載るため、半分だけ新しい画面にならない。
   *
   * 拾えるのは `.git` の中で起きたこと（`git add` / `commit` / `switch` /
   * `fetch`）で、作業ツリー側のファイルの変化は従来どおり `files.onChanged`
   * が運ぶ ── Renderer 側では**同じ更新タイマーへ合流させる**
   * （renderer/src/git/useGitRepository.ts）。
   *
   * 監視が使えない環境では1度も呼ばれないが、それで壊れるものは無い
   * （更新ボタンと、操作の応答に載る状態は従来どおり効く）。
   *
   * 戻り値は購読の解除。React の useEffect からそのまま返せる形にしてある。
   */
  readonly onChanged: (listener: IpcEventListener<'git:changed'>) => IpcEventUnsubscribe
}

/**
 * GitHub へ公開する（Session 3-8-10）。
 *
 * ## `git` と別の名前空間にしてある
 *
 * ここまでの `git` が相手にしていたのは PC の中のフォルダ1つだけで、
 * こちらは初めて外（ネットワークの向こうのサービス）へ出る ── 動かす
 * 実行ファイルも認証も別のものになる（shared/ipc/contracts/github.ts）。
 *
 * **GitHub を使わなくても Git は使える。** この名前空間の関数を1度も
 * 呼ばなくても、Commit / Branch / Diff / Stage / 破棄はそのまま動く。
 */
export interface GitHubApi {
  /**
   * GitHub CLI が使える状態かを尋ねる。
   *
   * **引数が無い。** ホストもアカウントも指定できず、見るのは常に
   * github.com への1つのログインだけになる。
   *
   * 呼ぶのは**公開の面を開いたとき**で、リポジトリの状態には相乗りさせない
   * ── 相乗りさせると、ファイルを保存するたびに gh を1回起動することになる。
   */
  readonly getStatus: () => IpcInvokeResult<'github:get-status'>
  /**
   * 今のリポジトリを GitHub へ公開する。
   *
   * 渡せるのは名前1つと公開範囲（`private` / `public`）だけで、gh の引数も
   * remote の URL も欄そのものが無い（shared/ipc/contracts/github.ts）。
   *
   * 中身は「空の repository を作る → `origin` を設定する → 初回 Push」の3つで、
   * **既に在るものは作り直さない** ── 押すたびに実際の状態を読み直し、
   * 済んでいるところは飛ばす（途中で止まっても、もう一度押せば続きから進む）。
   *
   * repository は作られたのに Push が通らなかった場合、`outcome` は
   * `partly-applied`（`completed: 'github-repository'`）で返る ──
   * **作った repository を消して失敗に揃えることはしない**
   * （shared/git/operation.ts）。
   */
  readonly publish: (request: PublishGitHubRepositoryRequest) => IpcInvokeResult<'github:publish'>
}

/**
 * 開いている文書を Language Server と同期する API（Session 5-2）。
 *
 * ## 公開しているのは「開いた」「変わった」「保存した」「閉じた」の4つ
 *
 * **どのサーバへ送るかを指定できない。** 決めるのは開いたファイルの拡張子で
 * （main/lsp/documentLanguage.ts）、サーバの起動もその結果として Main が行う。
 * Terminal では「表のどの行か」（shellId）まで渡せるようにしたが、こちらは
 * その欄すら無い ── 起動のきっかけが**利用者の操作ではなくファイルの言語**
 * だからで、実行ファイル・引数・作業ディレクトリはもちろん、
 * サーバを名指しする手段も Renderer には無い（DESIGN.md の STEP 5 引き継ぎ）。
 *
 * 指せるのは Workspace root からの相対位置だけで、URI を組み立てるのも
 * Workspace の外を断るのも Main になる（shared/ipc/contracts/lsp.ts）。
 *
 * ## 呼ぶのは1箇所だけ
 *
 * 呼び出しは Monaco の Model の生き死にから起こす
 * （renderer/src/editor/lsp/useDocumentSync.ts）。画面の部品がこの API を
 * 直に呼ぶことはない ── **何が開いているかを知っているのは Model を持つ層だけ**で、
 * そこ以外から呼ぶと「開いていない文書を変更した」という電文が作れてしまう。
 */
export interface LspApi {
  /**
   * 文書を開いたことを伝える（Model が作られたとき）。
   *
   * 応答の `tracked` が false なら、その文書に対応する Language Server が
   * 無い（`.md` / `.txt`、あるいは未インストール）。以降の通知は送らなくてよい。
   */
  readonly didOpen: (request: OpenLspDocumentRequest) => IpcInvokeResult<'lsp:did-open'>
  /** 中身が変わったことを伝える（差分。全置換になる編集は範囲なしの1件で届く）。 */
  readonly didChange: (request: ChangeLspDocumentRequest) => IpcInvokeResult<'lsp:did-change'>
  /**
   * ディスクへ書けたことを伝える。
   *
   * **版番号を渡さない。** 保存は中身を変えないため版が動かず、
   * 未保存かどうかは LSP の版とは別の数で決まる（shared/ipc/contracts/lsp.ts）。
   */
  readonly didSave: (request: SaveLspDocumentRequest) => IpcInvokeResult<'lsp:did-save'>
  /** 文書を閉じたことを伝える（Model を捨てたとき）。 */
  readonly didClose: (request: CloseLspDocumentRequest) => IpcInvokeResult<'lsp:did-close'>
  readonly completion: (request: LspCompletionRequest) => IpcInvokeResult<'lsp:completion'>
  /** 開いている現在文書を整形する。返るのは同じ文書へ適用する range + text だけ。 */
  readonly formatting: (request: LspFormattingRequest) => IpcInvokeResult<'lsp:formatting'>
  readonly hover: (request: LspHoverRequest) => IpcInvokeResult<'lsp:hover'>
  readonly definition: (request: LspDefinitionRequest) => IpcInvokeResult<'lsp:definition'>
  readonly references: (request: LspReferencesRequest) => IpcInvokeResult<'lsp:references'>
  /**
   * その位置で名前を変えられるか（Session 5-9）。
   *
   * **新しい名前は渡さない。** 入力欄を出す前の問い合わせなので、
   * まだ決まっていない（shared/ipc/contracts/lsp.ts）。
   */
  readonly prepareRename: (
    request: LspPrepareRenameRequest
  ) => IpcInvokeResult<'lsp:prepare-rename'>
  /**
   * 名前を変える（Session 5-9）。
   *
   * 返るのは**Workspace の中に実在するファイル**への相対位置と TextEdit だけで、
   * ファイルの作成 / 改名 / 削除は表す欄が無い（shared/lsp/rename.ts）。
   */
  readonly rename: (request: LspRenameRequest) => IpcInvokeResult<'lsp:rename'>
  /**
   * 開いている文書を送り直してほしい、という Main からの依頼。
   *
   * サーバが立ち上がった / 落ちて立ち直った直後は、そのサーバが文書を1つも
   * 知らない状態になる。Main は一覧を持つが**中身を持たない**ため、
   * 正本（Monaco の Model）を持つ側へ頼む形にしてある
   * （shared/ipc/events/lsp.ts）。
   */
  readonly onSyncRequested: (
    listener: IpcEventListener<'lsp:sync-requested'>
  ) => IpcEventUnsubscribe
  /**
   * サーバが出した指摘（Session 5-3）。
   *
   * **URI は載らない。** 届くのは Main が「Workspace の中だ」と確かめた
   * 相対位置だけで、外を指す URI・`file:` 以外の scheme・開いていない文書は
   * そこで断たれる（main/lsp/diagnostics.ts）。
   *
   * その文書の**全件**が毎回届く（LSP がそういう仕様）。受け手は足すのではなく
   * 入れ替える ── 指摘が無くなった文書には空の配列が来る。
   */
  readonly onDiagnostics: (listener: IpcEventListener<'lsp:diagnostics'>) => IpcEventUnsubscribe
  /**
   * その指摘がもう有効でなくなった（サーバが落ちた・終わった・切り替わった）。
   *
   * 空の指摘（「問題は無い」）とは意味が違う ── こちらでは Monaco 内蔵の
   * 指摘へ戻す（shared/ipc/events/lsp.ts）。
   */
  readonly onDiagnosticsCleared: (
    listener: IpcEventListener<'lsp:diagnostics-cleared'>
  ) => IpcEventUnsubscribe
  /**
   * サーバが今どうなっているか（Session 5-4）。
   *
   * 画面を開いた時点で1度読む。以降は `onStatusChanged` が届くが、
   * **変わったときにしか流れない**ので、最初の1回はこちらが要る
   * （`workspaceFolder.getCurrent` と同じ形）。
   *
   * 返るのは表の行の名前と、6つの状態のどれか1つだけになる ──
   * 実行ファイル・引数・作業ディレクトリ・pid・終了コードは載らない
   * （shared/lsp/serverStatus.ts）。
   */
  readonly getStatus: () => IpcInvokeResult<'lsp:get-status'>
  /**
   * サーバの状態が変わった（Session 5-4）。
   *
   * 3本ぶんがまとめて届く。受け手は差分を当てず、届いた一覧で置き換える。
   *
   * **この購読から何かを起こすことはできない。** 状態は読むだけで、
   * 使うかどうかを変えるのは `settings.saveSection`（`lsp` section）を通り、
   * その結果としてサーバが止まる / 立つのを決めるのは Main になる。
   */
  readonly onStatusChanged: (
    listener: IpcEventListener<'lsp:status-changed'>
  ) => IpcEventUnsubscribe
}

/**
 * debug ドメインの Preload API（Session 6-3 ── Breakpoint / Session 6-4 ── 実行制御）。
 *
 * Renderer から渡せるのは「Workspace の中の相対位置と行」だけで、
 * 実行制御の6つ（Session 6-4）は**引数を1つも取らない**。
 * **プロセスを立てる口は1つも無い** ── Stop が終わらせるのは Main が立てた
 * セッションだけで、どのプロセスかを指す欄は無い（`lsp` と同じ線）。
 *
 * ここに無いもの:
 *
 * ```
 * 任意の DAP request / command … 無い（method 名を渡す欄が無い。操作ごとに関数が分かれている）
 * adapter の選択 / 実行ファイル … 無い（表は Main。docs/ARCHITECTURE.md §20.7）
 * 絶対パス / file URI           … 無い（組み立てるのは Main）
 * threadId / frameId            … 無い（どのスレッドを動かすかは Main が決める。選ぶのは 6-5）
 *                                  frameId は Scope を読むときだけ載る（今の停止の frame しか通らない）
 * variablesReference            … 無い（渡すのは Main が発行した handle。Session 6-6）
 * evaluate / setVariable        … 無い（evaluate は Session 6-7。値の書き換えは入れない）
 * 起動するものを指定する欄      … 無い（Session 6-10 の `start` に載るのは profileId だけ。
 *                                  実行ファイル・引数・cwd は Profile にも要求にも無い）
 * breakpoint の一覧を書き込む口 … 無い（1件ずつの入れ替えだけ。§20.12）
 * ```
 *
 * したがって、この面が増えても「Renderer からの要求で任意の実行ファイルが動く」
 * 形は作られない（`lsp` を足したときと同じ線）。
 */
export interface DebugApi {
  /**
   * 今の Workspace の breakpoint を読む。
   *
   * 画面を開いた時点で1度読む。以降は `onBreakpointsChanged` が届くが、
   * **変わったときにしか流れない**ので最初の1回はこちらが要る
   * （`lsp.getStatus` と同じ形）。
   */
  readonly listBreakpoints: () => IpcInvokeResult<'debug:list-breakpoints'>
  /**
   * その位置の breakpoint を入れ替える（無ければ付け、あれば外す）。
   *
   * 応答は入れ替えた後の全件。Debug Session が動いていれば、Main が
   * `setBreakpoints` へ翻訳して adapter へ送る ── **Renderer はその翻訳を
   * 1段も知らない**（docs/ARCHITECTURE.md §20.12）。
   */
  readonly toggleBreakpoint: (
    request: ToggleDebugBreakpointRequest
  ) => IpcInvokeResult<'debug:toggle-breakpoint'>
  /** 今の Call Stack snapshot を読む。返る source は safe domain model だけ。 */
  readonly listCallStack: () => IpcInvokeResult<'debug:list-call-stack'>
  /**
   * Call Stack の frame の Scope を読む（Session 6-6）。
   *
   * 渡すのは snapshot に載っていた `frameId` だけで、Main は今の停止の frame しか通さない。
   * 返る Scope が持つのは Main の handle で、DAP の `variablesReference` は載らない。
   */
  readonly listScopes: (request: ListDebugScopesRequest) => IpcInvokeResult<'debug:list-scopes'>
  /** Scope / Variable の子を1段読む（Session 6-6）。渡せるのは Main が発行した handle だけ。 */
  readonly listVariables: (
    request: ListDebugVariablesRequest
  ) => IpcInvokeResult<'debug:list-variables'>
  /**
   * 選んでいる frame の文脈で式を1つ評価する（Session 6-7）。
   *
   * **DAP の request を送る口ではない。** 渡せるのは式・frame・文脈（`repl` / `watch`）の
   * 3つだけで、`command` も `variablesReference` も渡す欄が無い。止まっていない・
   * 古い frame・adapter が断った・答えが返らなかったは、値（`unavailable`）で返る。
   *
   * 結果が展開できる構造なら `handle` が付き、それを `listVariables` へ渡すと
   * Session 6-6 とまったく同じ経路で子を読める。
   */
  readonly evaluate: (request: EvaluateDebugExpressionRequest) => IpcInvokeResult<'debug:evaluate'>
  /**
   * 実行制御（Session 6-4）。
   *
   * 結末は値で返る（`accepted` / `rejected` / `failed`）。今の状態で意味の無い操作
   * （running 中の Step など）は adapter へ何も送られずに `rejected` になる。
   */
  readonly continue: () => IpcInvokeResult<'debug:continue'>
  readonly pause: () => IpcInvokeResult<'debug:pause'>
  readonly stepOver: () => IpcInvokeResult<'debug:step-over'>
  readonly stepInto: () => IpcInvokeResult<'debug:step-into'>
  readonly stepOut: () => IpcInvokeResult<'debug:step-out'>
  /**
   * Debug Session を終わらせる（Session 6-4）。
   *
   * セッションが idle へ戻り終えてから答える。終わりきる前にもう一度呼ぶと、
   * 穏やかな終わらせ方（terminate）から無条件の終わらせ方（disconnect）へ切り替わる。
   */
  readonly stop: () => IpcInvokeResult<'debug:stop'>
  /**
   * breakpoint の一覧が変わった。
   *
   * 利用者の操作の結果としても届くが、**要求が無くても届く** ── adapter が
   * verified を返したとき、Workspace が切り替わったときがそれにあたる。
   * 全件が毎回届くので、受け手は差分を当てず届いた一覧で置き換える。
   */
  readonly onBreakpointsChanged: (
    listener: IpcEventListener<'debug:breakpoints-changed'>
  ) => IpcEventUnsubscribe
  /** Call Stack snapshot が変わった。 */
  readonly onCallStackChanged: (
    listener: IpcEventListener<'debug:call-stack-changed'>
  ) => IpcEventUnsubscribe
  /** Debug Console に表示する entry が届いた（DAP output / system message）。 */
  readonly onConsoleEntry: (
    listener: IpcEventListener<'debug:console-entry'>
  ) => IpcEventUnsubscribe
  /**
   * Debug が今どうなっているか（Session 6-9）。
   *
   * 画面を開いた時点で1度読む。以降は `onStatusChanged` が届くが、**変わったときにしか
   * 流れない**ので最初の1回はこちらが要る（`lsp.getStatus` と同じ形）。
   *
   * 返るのは閉じた集合の1語だけで、sessionId・adapter の名前や実行ファイル・
   * 失敗の文言は載らない（shared/debug/status.ts）。**読むだけの口**で、
   * ここからセッションを起こす / 止めることはできない。
   */
  readonly getStatus: () => IpcInvokeResult<'debug:get-status'>
  /** Debug の状態が変わった（Session 6-9）。同じ tick の変化は1本にまとめて届く。 */
  readonly onStatusChanged: (
    listener: IpcEventListener<'debug:status-changed'>
  ) => IpcEventUnsubscribe
  /**
   * 今の Workspace の Debug Profile を読む（Session 6-10）。引数を取らない ──
   * どの Workspace の分かは Main が決める。
   */
  readonly listProfiles: () => IpcInvokeResult<'debug:list-profiles'>
  /**
   * Debug Profile を作る（Session 6-10）。渡せるのは6欄（name / language /
   * programRelativePath / programArgs / env / stopOnEntry）だけで、id は Main が発番する。
   */
  readonly createProfile: (
    request: CreateDebugProfileRequest
  ) => IpcInvokeResult<'debug:create-profile'>
  readonly updateProfile: (
    request: UpdateDebugProfileRequest
  ) => IpcInvokeResult<'debug:update-profile'>
  readonly deleteProfile: (
    request: DeleteDebugProfileRequest
  ) => IpcInvokeResult<'debug:delete-profile'>
  /**
   * その Debug Profile で Debug Session を始める（Session 6-10）。
   *
   * **渡すのは `profileId` だけ。** 何を・どこで・どの adapter で動かすかは Main が
   * 保存された profile と自分の表から決め、その解決結果は返ってこない。
   */
  readonly start: (request: StartDebugRequest) => IpcInvokeResult<'debug:start'>
}

/**
 * フィードバックを送る API。
 *
 * 渡せるのは種別と詳細だけで、送信日時・バージョン・OS は Main が付ける。
 * 保存先とその秘密情報（Notion の token など）は Main の外へ出ない
 * （shared/ipc/contracts/feedback.ts）。
 */
export interface FeedbackApi {
  readonly submit: (request: SubmitFeedbackRequest) => IpcInvokeResult<'feedback:submit'>
}

/**
 * `window.fluvix` として Renderer に公開される API 全体。
 *
 * Files / Terminal / GitHub など OS に触れるドメイン API は、
 * ここにドメイン単位の名前空間として追加していく（例: `readonly files: FilesApi`）。
 * Renderer が OS へ直接触れないという原則を守るため、追加は必ずこの型経由で行うこと。
 */
export interface FluvixApi {
  readonly env: EnvApi
  readonly system: SystemApi
  /** ウィンドウを閉じてよいかの確認（未保存の保護）。 */
  readonly window: WindowApi
  /** Workspace レイアウト（画面の配置）の永続化。 */
  readonly workspace: WorkspaceApi
  /** 開いているプロジェクトフォルダ。 */
  readonly workspaceFolder: WorkspaceFolderApi
  /** その Workspace の中のファイル / フォルダ。 */
  readonly files: FilesApi
  /** その Workspace を作業ディレクトリにするシェル。 */
  readonly terminal: TerminalApi
  /** その Workspace を Git リポジトリとして扱う。 */
  readonly git: GitApi
  /** そのリポジトリを GitHub へ公開する（Session 3-8-10）。 */
  readonly github: GitHubApi
  /** 開いている文書を Language Server と同期する（Session 5-2）。 */
  readonly lsp: LspApi
  /** その Workspace の breakpoint（Session 6-3）と実行制御（Session 6-4）。 */
  readonly debug: DebugApi
  /** アプリの設定の永続化。 */
  readonly settings: SettingsApi
  /** フィードバックを設定済みの保存先（Notion など）へ送る。 */
  readonly feedback: FeedbackApi
}

/** `window` に API を公開する際のキー。Preload と Renderer の双方から参照する。 */
export const FLUVIX_API_KEY = 'fluvix' as const
