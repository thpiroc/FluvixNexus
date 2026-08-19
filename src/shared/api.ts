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
  SearchWorkspaceFileContentsRequest,
  SearchWorkspaceFilesRequest,
  WriteWorkspaceFileRequest
} from './ipc/contracts/files'
import type { IpcInvokeResult } from './ipc/contract'
import type { IpcEventListener, IpcEventUnsubscribe } from './ipc/event'
import type { SaveEditorSettingsRequest, SaveFilesSettingsRequest } from './ipc/contracts/settings'
import type { PingRequest } from './ipc/contracts/system'
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
 * アプリの設定の永続化 API。
 *
 * Workspace レイアウトと同じ形で、**保存先のパスもファイル名も Renderer からは
 * 指定できない**。用途ごとにチャンネルを切る方針（ARCHITECTURE.md §5）に従い、
 * Editor の設定（Auto Save）と Files の見え方（表示方式・カラムの幅。Session 3-6-8）は
 * 別々のチャンネル・別々のファイルになる。
 */
export interface SettingsApi {
  /** 保存済みの Editor 設定を読む。未保存・破損時は document が null。 */
  readonly loadEditor: () => IpcInvokeResult<'settings:load-editor'>
  /** Editor 設定を保存する。書き込みの間引きは Main 側が行う。 */
  readonly saveEditor: (
    request: SaveEditorSettingsRequest
  ) => IpcInvokeResult<'settings:save-editor'>
  /** 保存済みの Files の見え方を読む。未保存・破損時は document が null。 */
  readonly loadFiles: () => IpcInvokeResult<'settings:load-files'>
  /** Files の見え方を保存する。書き込みの間引きは Main 側が行う。 */
  readonly saveFiles: (request: SaveFilesSettingsRequest) => IpcInvokeResult<'settings:save-files'>
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
  /** アプリの設定の永続化。 */
  readonly settings: SettingsApi
}

/** `window` に API を公開する際のキー。Preload と Renderer の双方から参照する。 */
export const FLUVIX_API_KEY = 'fluvix' as const
