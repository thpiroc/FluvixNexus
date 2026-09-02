import type { FileEntry, FileEntryType } from '../../files/entry'
import type {
  FileEncoding,
  FileLineEnding,
  FileRevision,
  WorkspaceFileStatus
} from '../../files/content'
import type { FileSearchLimit, FileSearchStatus } from '../../files/search'
import type { FileContentMatchFile, FileContentSearchLimit } from '../../files/contentSearch'

/**
 * files ドメインの IPC 契約（Workspace の中のファイル / フォルダ）。
 *
 * ## 汎用のファイル API にはしない
 *
 * どのチャンネルも root を指定する引数を持たない。基点は Main が持つ現在の Workspace
 * （main/workspaceFolder/currentWorkspaceFolder.ts）だけから決まる。
 *
 * Renderer から任意のパスを触れる API を1つ公開した時点で、Renderer を OS から
 * 切り離している前提（ARCHITECTURE.md §5）は崩れる。Workspace を Renderer から
 * 指定できないようにしてある（§8.4）のと同じ理由で、その中を触る側も
 * 「Workspace の中の相対位置」以上のことを言えない形にする。
 *
 * **この方針は読み込みだけでなく作成・リネーム・削除にも同じだけ効かせる。**
 * 読む側だけを守っても、書く側から Workspace の外に手が届けば意味が無い。
 * relativePath は境界の外から来た値として Main 側で必ず検証する
 * （`..` / 絶対パス / symlink・ジャンクションによる脱出はすべて Main が拒否する。
 * main/files/workspacePath.ts）。
 *
 * ## 1フォルダずつ返す（Lazy Load）
 *
 * 再帰的に返す API にしていないのは、Workspace を開いた瞬間に数万件を読むことに
 * なるため。ツリーの形（どこを展開しているか）を知っているのは Renderer だけなので、
 * 「展開されたフォルダを1つ読む」を繰り返す形にしておくと、読む量が
 * 利用者の操作した範囲に比例するところで止まる。
 *
 * 作成 / リネーム / 削除の後も同じで、**ツリー全体を返し直さない。** 何が変わったかは
 * イベント（shared/ipc/events/files.ts）で伝え、Renderer は変わったフォルダだけを
 * 読み直す。応答が持つのは「その操作の結果そのもの」に留める。
 *
 * ## 足していくときの約束
 *
 * 後から増えたチャンネル（保存は Session 3-4 の `files:write-file`、移動は
 * Session 3-6-1 の `files:move`、コピーは Session 3-6-2 の `files:copy`、
 * 検索は Session 3-6-4 の `files:search`）も、基点の決め方と境界の検証は
 * Session 3-2 / 3-3 の経路をそのまま通している。**root を渡せる引数を足さない**ことが
 * この契約の芯にあたる。
 *
 * ## 検索は列挙とは別のチャンネルにする
 *
 * `files:read-directory` が「1フォルダを1階層だけ」であるのに対し、検索は
 * **再帰的に潜る**（＝呼び出し1回の重さが Workspace の大きさで決まる）。
 * 同じチャンネルに relativePath の代わりに検索語を足す形にすると、
 * Lazy Load の前提（1回の要求＝1フォルダ）がその瞬間に崩れる。
 * 上限も取り消しも検索にしか無いため、契約ごと分けてある（shared/files/search.ts）。
 */

/* ------------------------------------------------------------------ 列挙 */

export interface ReadWorkspaceDirectoryRequest {
  /**
   * Workspace root からの相対位置。区切りは `/`。
   * root 自身は空文字（WORKSPACE_ROOT_RELATIVE_PATH）。
   */
  readonly relativePath: string
}

export interface ReadWorkspaceDirectoryResponse {
  /**
   * この結果がどの Workspace のものか。
   *
   * 読み込み中に Workspace が切り替わると、**前の Workspace に対して出した要求の応答が
   * 新しい Workspace のツリーへ届く**ことがある（要求と応答の間に切り替えが挟まる）。
   * Renderer は自分が今表示している Workspace の id と突き合わせ、違えば捨てる。
   */
  readonly workspaceId: string
  /** 要求された位置（Main 側で正規化したもの）。どの応答がどのフォルダのものかの照合に使う。 */
  readonly relativePath: string
  /** 直下のファイル / フォルダ。フォルダが先、それぞれ名前順（main/files/entrySort.ts）。 */
  readonly entries: readonly FileEntry[]
  /**
   * 上限（FILES_DIRECTORY_MAX_ENTRIES）で打ち切られたか。
   *
   * 打ち切りを失敗にしないのは、node_modules のようなフォルダでも
   * 先頭だけは見えた方が行き止まりにならないため。
   */
  readonly truncated: boolean
}

/* -------------------------------------------------------- ファイルを開く */

export interface ReadWorkspaceFileRequest {
  /** 開くファイルの相対位置。root（空文字）は指定できない。 */
  readonly relativePath: string
}

/**
 * ファイル1件の中身。
 *
 * `status` で結末を表すのは、**バイナリ・大きすぎるが失敗ではない**ため
 * （shared/files/content.ts）。消えている・権限が無い・Workspace の外、は
 * IpcResult の失敗として返る。
 */
export interface ReadWorkspaceFileResponse {
  readonly workspaceId: string
  /** 要求された位置（Main 側で正規化したもの）。 */
  readonly relativePath: string
  /** ファイル名（タブに出す）。 */
  readonly name: string
  readonly status: WorkspaceFileStatus
  /** ディスク上の大きさ。'ok' 以外のとき、なぜ出せないかを伝えるのに使う。 */
  readonly byteLength: number
  /** `status` が 'ok' のときだけ中身が入る。それ以外は null。 */
  readonly content: string | null
  /** 読み込んだ時点の改行。保存する際に形を保つために持つ。'ok' 以外は null。 */
  readonly lineEnding: FileLineEnding | null
  /**
   * 読み込んだ時点の文字コード（shared/files/content.ts）。
   *
   * 今のところ `utf8` か `utf8-bom` のどちらかで、違いは BOM の有無だけ。
   * `content` には BOM を含めず、**保存の要求にそのまま返してもらう**ことで
   * 「開いて保存しただけで BOM が消える」を防ぐ。'ok' 以外は null。
   */
  readonly encoding: FileEncoding | null
  /**
   * 読み込んだ時点の版（shared/files/content.ts）。
   *
   * 保存の要求にそのまま添えることで、「読んだときのまま保存しようとしているか」を
   * Main 側で確かめられる。中身を渡していない（binary / too-large）場合は
   * 保存の起点にもならないため null。
   */
  readonly revision: FileRevision | null
}

/* ------------------------------------------------------------ 保存（上書き） */

export interface WriteWorkspaceFileRequest {
  /** 保存するファイルの相対位置。root（空文字）は指定できない。 */
  readonly relativePath: string
  /**
   * 書き込む中身。
   *
   * 改行はこの文字列の形のまま書く（Main 側で変換しない）。開いたときの改行を
   * 保つかどうかは Editor 側（Monaco のモデルの EOL）が決めることで、
   * Main が勝手に揃えると「開いて保存しただけで全行が変更になる」が起きる。
   */
  readonly content: string
  /**
   * 読み込んだ / 前回保存した時点の版。
   *
   * これが今ディスクにある版と食い違っていれば、**書かずに** `'stale'` を返す。
   * null を渡した場合は確かめずに上書きする（Conflict の「Overwrite」の経路。
   * それ以外では必ず添える）。
   */
  readonly baseRevision: FileRevision | null
  /**
   * 書き込む文字コード（shared/files/content.ts）。
   *
   * 読み込みの応答で受け取ったものをそのまま返す。省略（null）した場合は
   * `utf8`（BOM 無し）として書く。Main が勝手に決めないのは、
   * 「BOM 付きで開いたファイルが、保存すると BOM 無しになる」を起こさないため。
   */
  readonly encoding: FileEncoding | null
}

/**
 * 保存の結末。
 *
 * `'stale'` を IpcResult の失敗にしていないのは、これが**利用者に選択肢を出すべき状態**で
 * あって、要求そのものが成立していないわけではないため（binary / too-large と同じ扱い）。
 * 失敗として返すと、Renderer 側で「エラーだが上書きもできる」という例外的な分岐になる。
 */
export type WriteWorkspaceFileStatus = 'written' | 'stale'

export interface WriteWorkspaceFileResponse {
  readonly workspaceId: string
  /** 要求された位置（Main 側で正規化したもの）。 */
  readonly relativePath: string
  readonly status: WriteWorkspaceFileStatus
  /**
   * 今ディスクにある版。
   *
   * `'written'` なら書き込んだ結果の版で、Renderer はこれを次の `baseRevision` にする。
   * `'stale'` なら**アプリの外で書き換えられた後**の版。
   */
  readonly revision: FileRevision
}

/* ------------------------------------------------------ 別名で保存（Save As） */

/**
 * 中身を、利用者が選んだ場所へ書き出す（Session 4-2）。
 *
 * ## `files:write-file` と別のチャンネルにする
 *
 * あちらは「**今開いているファイル**へ書き戻す」に閉じてあり、
 * 対象が実在することを前提に版を突き合わせる（`'stale'`）。こちらは
 * **まだ存在しないかもしれない場所**へ書く操作で、確かめる相手も無い。
 * 1本にまとめると、要求に「上書きなのか新規なのか」を表す欄が増え、
 * どちらの検証を通すかが要求の中身で変わることになる。
 *
 * ## 行き先を Renderer が決めない
 *
 * 要求に保存先が無いのが要点。**書き込む場所を決めるのはネイティブの保存
 * ダイアログだけ**で、Renderer が言えるのは「出して」までに留まる
 * （Workspace を開く `workspace-folder:open` と同じ線。ARCHITECTURE.md §8.4）。
 *
 * `suggestedRelativePath` はダイアログを**どこで開くか**の助言でしかなく、
 * Workspace 相対としてしか書けない（Main 側で正規化に通す）。
 * ここから Workspace の外は指せず、指したところで利用者が選び直さない限り
 * 何も書かれない。
 *
 * ## Workspace の外へも書ける
 *
 * 利用者がダイアログで外を選んだ場合は、そこへ書く。信頼の根拠は
 * 「Renderer が渡したパス」ではなく「**利用者が Main のダイアログで選んだ**」
 * ことにある。ただし応答に絶対パスは載せない（下記）。
 */
export interface SaveWorkspaceFileAsRequest {
  /**
   * 書き込む中身。
   *
   * 改行はこの文字列の形のまま書く（`files:write-file` と同じ。Main は変換しない）。
   */
  readonly content: string
  /**
   * 書き込む文字コード（shared/files/content.ts）。
   *
   * 開いたときのものをそのまま返す。null なら `utf8`（BOM 無し）。
   * 上書き保存と同じ扱いにしてあるので、**別名で保存しても BOM の有無は変わらない**。
   */
  readonly encoding: FileEncoding | null
  /**
   * ダイアログを開く位置の助言（今開いているファイルの相対位置）。
   *
   * Workspace 相対としてしか解釈しない。空文字（root 自身）は指定できない。
   */
  readonly suggestedRelativePath: string
}

/**
 * 別名で保存の結末。
 *
 * 取り消しは失敗ではなく通常の結末（`workspace-folder:open` と同じ扱い）。
 */
export type SaveWorkspaceFileAsResponse =
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'saved'
      readonly workspaceId: string
      /**
       * 保存したファイルの名前（拡張子つき）。
       *
       * **絶対パスは載せない。** Workspace の外へ保存した場合でも Renderer が
       * 受け取るのは利用者が今しがた打った名前だけで、そこから場所は組み立て直せない
       * （Files が絶対パスを渡さない §9.2 と同じ線）。
       */
      readonly name: string
      /** 実際に書いたバイト数（BOM を含む）。 */
      readonly byteLength: number
      /**
       * 保存先が Workspace の中だった場合の相対位置。**外だった場合は null。**
       *
       * null は「書けなかった」ではなく「**このアプリが開ける範囲の外へ書けた**」を表す。
       * Editor が開けるのは Workspace の中だけなので、null のときタブは移らない。
       */
      readonly relativePath: string | null
      /**
       * 書けた時点の版。Workspace の中の場合のみ。
       *
       * Renderer はこれを次の `baseRevision` にする（`files:write-file` の
       * `'written'` と同じ役割）。
       */
      readonly revision: FileRevision | null
    }

/* ------------------------------------------------------------------ 作成 */

export interface CreateWorkspaceEntryRequest {
  /** 作成先のフォルダ。Workspace root は空文字。 */
  readonly parentRelativePath: string
  /**
   * 新しい名前（1階層ぶん）。
   *
   * 区切り文字を含む名前は受け付けない（shared/files/fileName.ts）。
   * 「深い位置に一気に作る」を許すと、作成先が parentRelativePath だけでは
   * 決まらなくなり、境界の検証の対象が2箇所に散る。
   */
  readonly name: string
  readonly type: FileEntryType
}

export interface CreateWorkspaceEntryResponse {
  readonly workspaceId: string
  /** 作られたもの。Renderer はこれを選択状態にする。 */
  readonly entry: FileEntry
}

/* -------------------------------------------------------------- リネーム */

export interface RenameWorkspaceEntryRequest {
  /** 変更するファイル / フォルダの現在の位置。root（空文字）は指定できない。 */
  readonly relativePath: string
  /** 新しい名前（1階層ぶん）。フォルダは移動しない。 */
  readonly name: string
}

export interface RenameWorkspaceEntryResponse {
  readonly workspaceId: string
  /** 変更後のもの。 */
  readonly entry: FileEntry
  /** 変更前の位置。Renderer 側のキャッシュ・タブの付け替えに使う。 */
  readonly fromRelativePath: string
}

/* ------------------------------------------------------------------ 移動 */

/**
 * 別のフォルダへ動かす（名前は変えない）。
 *
 * ## リネームとは別のチャンネルにする
 *
 * `files:rename` は「同じフォルダの中で名前を変える」に閉じてあり、新しい名前に
 * 区切り文字を含められない（shared/files/fileName.ts）。そこへ移動を混ぜると、
 * **1つの要求が2つの場所を指す**ことになり、境界の検証の相手が要求ごとに変わる。
 *
 * 分けておけば、移動は「元の親」と「移動先の親」の**両方**を境界に通す操作として、
 * その形のまま書ける（main/files/mutateWorkspaceEntry.ts）。
 *
 * ## 名前を変えない
 *
 * 移動と改名を同時に行えない。行えるようにすると、同名衝突が起きたときに
 * 「場所が悪いのか、名前が悪いのか」が要求からは決まらなくなる。
 * 名前を変えてから動かす（あるいはその逆）は2回の操作で行える。
 */
export interface MoveWorkspaceEntryRequest {
  /** 動かすファイル / フォルダの現在の位置。root（空文字）は指定できない。 */
  readonly relativePath: string
  /** 移動先のフォルダ。Workspace root は空文字。 */
  readonly toParentRelativePath: string
}

/**
 * 移動の結果。
 *
 * リネーム（RenameWorkspaceEntryResponse）と同じ形にしてある。受け手（Files のツリー・
 * Editor のタブ）にとって、**位置が変わったことだけが分かれば扱いは同じ**であり、
 * 変化の伝え方も `files:changed` の `renamed` を共有する（shared/files/change.ts）。
 */
export interface MoveWorkspaceEntryResponse {
  readonly workspaceId: string
  /** 移動後のもの（名前は変わらない）。 */
  readonly entry: FileEntry
  /** 移動前の位置。Renderer 側のキャッシュ・タブの付け替えに使う。 */
  readonly fromRelativePath: string
}

/* ------------------------------------------------------------------ コピー */

/**
 * 別のフォルダへ複製する（元はそのまま残る）。
 *
 * ## 移動と同じ形の要求にする
 *
 * 受け取るのは相対位置2つだけで、`files:move` と揃えてある。境界を確かめる相手が
 * 2つ（元の親・コピー先の親）である点も同じで、Main 側は同じ手順を両方に通す。
 *
 * ## 名前を要求に含めない
 *
 * コピー先に同名のものがあった場合、**利用者に名前を訊き直さずに衝突しない名前を
 * 作る**（`example.txt` → `example copy.txt` → `example copy 2.txt`。
 * shared/files/copyName.ts）。複製は「同じものをもう1つ」であって名前そのものに
 * 意味が無いため、ここだけは作成・改名・移動と扱いを変えている
 * （**上書きしない**点は変えていない）。
 *
 * 名前を要求に含める形にすると、決めるのが Renderer になる。どの候補が実際に空いて
 * いるかを知れるのはディスクを見られる Main だけで、Renderer が選んだ名前を渡す形は
 * 「選んでから作るまでの隙間」を必ず作る。
 */
export interface CopyWorkspaceEntryRequest {
  /** 複製するファイル / フォルダ。root（空文字）は指定できない。 */
  readonly relativePath: string
  /**
   * コピー先のフォルダ。Workspace root は空文字。
   *
   * **元と同じフォルダを指してよい**（その場で複製が1つ増える）。
   * 移動では「何もしない」になる指定が、コピーでは成立する数少ない違いの1つ。
   */
  readonly toParentRelativePath: string
}

/**
 * コピーの結果。
 *
 * 移動（MoveWorkspaceEntryResponse）と違い `fromRelativePath` を持たない
 * ── **元は動いていない**ため。変化として配るのも `renamed` ではなく
 * `created` 1件で、受け手（Files のツリー）はコピー先の親を読み直すだけになる。
 */
export interface CopyWorkspaceEntryResponse {
  readonly workspaceId: string
  /** できたもの。Renderer はこれを選択状態にする。名前は衝突を避けて変わりうる。 */
  readonly entry: FileEntry
  /**
   * 複製せずにとばした件数（フォルダの中にあった symlink / ジャンクションなど）。
   *
   * **0 でないことを黙らせない。** リンクを辿らないのは境界を守るためだが、
   * その結果として中身が欠けた複製ができる。複製したつもりで欠けている方が、
   * 断られるより悪いので、件数を返して Renderer が伝える。
   */
  readonly skippedCount: number
}

/* ------------------------------------------------------------------ 削除 */

export interface DeleteWorkspaceEntryRequest {
  /** 削除するファイル / フォルダ。root（空文字）は指定できない。 */
  readonly relativePath: string
}

export interface DeleteWorkspaceEntryResponse {
  readonly workspaceId: string
  readonly relativePath: string
  readonly entryType: FileEntryType
  /**
   * 削除の方法。
   *
   * 現在は常に 'recycle-bin'（OS のごみ箱へ送る）。完全削除の経路を持たないことを
   * 型として残しておくため、真偽値ではなく名前で表す。
   */
  readonly method: 'recycle-bin'
}

/* ---------------------------------------------------- 検索（ファイル名） */

/**
 * Workspace 全体から名前で探す（Session 3-6-4）。
 *
 * ## 場所を指定させない
 *
 * 起点は常に Workspace root で、要求に含められるのは検索語だけ。
 * 「このフォルダの中だけ」を足すには relativePath を受け取ることになるが、
 * それは境界の検証がもう1箇所増えるということでもある。
 * 今回は入口を1つに保ち、**root からの全体検索**だけを提供する。
 *
 * ## 中身は探さない
 *
 * 照合するのはファイル / フォルダの**名前**だけ（shared/files/search.ts）。
 * ファイルの中身に対する検索は1件ずつ読む必要があり、上限も応答の形も別になるため、
 * Session 3-6-5 で `files:search-content` として別のチャンネルに足した
 * （このチャンネルの要求・応答は Session 3-6-4 のまま変えていない）。
 */
export interface SearchWorkspaceFilesRequest {
  /**
   * この検索の識別子（Renderer が作る）。
   *
   * 取り消し（`files:cancel-search`）で同じものを送り返す。**Main が振らない**のは、
   * 識別子が応答で返ってくる形にすると、応答が届く前 ── つまり取り消したい間だけ ──
   * 呼び出し側が対象を指せなくなるため。
   */
  readonly searchId: string
  /**
   * 検索語。大文字 / 小文字を区別しない部分一致で名前と照合する。
   *
   * **trim しない。** 前後の空白も名前の一部として探す（`my notes.txt` を
   * ` notes` で探せる）。空文字は受け付けない（全件の列挙になるため）。
   */
  readonly query: string
}

export interface SearchWorkspaceFilesResponse {
  readonly workspaceId: string
  /** 要求と同じ識別子。Renderer は自分が今出している検索かを突き合わせる。 */
  readonly searchId: string
  /** 要求と同じ検索語。結果と語がずれた表示にならないよう応答にも載せる。 */
  readonly query: string
  /**
   * 最後まで見たか、途中で止めたか（shared/files/search.ts）。
   *
   * 取り消しは失敗ではない。新しい検索に置き換わった場合もこれになる
   * （その応答は、識別子が古いものとして Renderer 側で捨てられる）。
   */
  readonly status: FileSearchStatus
  /**
   * 見つかったもの。ツリーの行と同じ FileEntry（shared/files/entry.ts）。
   *
   * **専用の型を作っていない。** 結果を押すと開く経路はツリーと同じ
   * （`openFile({ relativePath, name })`）で、受け手が必要とする値も同じになる。
   * 絶対パスを持たない点も当然そのまま ── Renderer が知るのは相対位置までにとどまる。
   */
  readonly matches: readonly FileEntry[]
  /** 上限に当たって全部は見ていないか。 */
  readonly truncated: boolean
  /** 打ち切った理由（truncated が false なら null）。 */
  readonly limit: FileSearchLimit | null
  /** 実際に見たエントリ数。上限との距離を画面に出すために返す。 */
  readonly scannedCount: number
}

/* -------------------------------------------------- 検索（ファイル本文） */

/**
 * Workspace 全体のファイルの**中身**から探す（Session 3-6-5）。
 *
 * ## 名前の検索と別のチャンネルにする
 *
 * `files:search` に「中身も見る」という切り替えを足す形にしていない。理由は
 * 検索を `files:read-directory` に足さなかったのと同じで、**1回の要求の重さが
 * 別物**だから ── 名前の検索が readdir だけで済むのに対し、こちらは
 * 対象のファイルを1件ずつ開いて読む。上限も応答の形も共有できない
 * （shared/files/contentSearch.ts）。
 *
 * 分けておくと、名前の検索は Session 3-6-4 のまま1文字も変えずに済む。
 *
 * ## 取り消しは共有する
 *
 * 止める側は `files:cancel-search` のまま（専用のチャンネルを足していない）。
 * Main 側で走れる検索は**名前・全文を通じて常に1本**で
 * （main/files/workspaceSearchSession.ts）、識別子の作り方も同じなら、
 * 止める要求が2種類ある理由が無い。
 *
 * これは副産物ではなく設計そのもので、**モードを切り替えた瞬間に、
 * 前のモードで走っていた検索が止まる**のもこの1本化から来ている。
 */
export interface SearchWorkspaceFileContentsRequest {
  /** この検索の識別子（Renderer が作る）。`files:cancel-search` に同じものを送る。 */
  readonly searchId: string
  /**
   * 検索語。大文字 / 小文字を区別しない部分一致で**行の中**を照合する。
   *
   * 名前の検索と同じく trim しない（前後の空白も語の一部）。
   * 改行を含む語は受け付けない ── 照合は1行ずつ行うため、
   * 複数行にまたがる語はどの行とも一致しない（受け取っても常に0件になる）。
   */
  readonly query: string
}

export interface SearchWorkspaceFileContentsResponse {
  readonly workspaceId: string
  /** 要求と同じ識別子。Renderer は自分が今出している検索かを突き合わせる。 */
  readonly searchId: string
  /** 要求と同じ検索語。結果と語がずれた表示にならないよう応答にも載せる。 */
  readonly query: string
  /** 最後まで見たか、途中で止めたか（名前の検索と同じ2値）。 */
  readonly status: FileSearchStatus
  /**
   * 見つかったもの。**ファイル単位にまとめてある**（shared/files/contentSearch.ts）。
   *
   * 名前の検索と違って FileEntry を返さない ── 結果の単位が
   * 「そこに在るもの」ではなく「そこで一致したもの」で、行と桁を持つ必要がある。
   * 開く経路が同じ（`openFile({ relativePath, name })`）であるために、
   * 相対位置と名前は同じ形で持たせてある。
   */
  readonly files: readonly FileContentMatchFile[]
  /** 一致の総数（files の中の matches を合計したもの）。 */
  readonly matchCount: number
  /** 実際に中身を読んだファイル数。上限との距離を画面に出すために返す。 */
  readonly searchedFileCount: number
  /** 名前を見たエントリ数（読まずにとばしたものを含む）。 */
  readonly scannedCount: number
  /** 上限に当たって全部は見ていないか。 */
  readonly truncated: boolean
  /** 打ち切った理由（truncated が false なら null）。 */
  readonly limit: FileContentSearchLimit | null
}

/**
 * 進行中の検索を取り消す。
 *
 * 取り消せなかった（もう終わっている / 別の検索に置き換わっている）場合も失敗にしない。
 * 呼び出し側にとって「その検索はもう走っていない」という同じ結論になるため。
 *
 * **名前の検索と全文検索で共通**（Session 3-6-5）。走っているのは常に1本で、
 * 識別子の作り方も同じであるため、どちらを止めるかを区別する必要が無い。
 */
export interface CancelWorkspaceFileSearchRequest {
  /** 取り消す検索の識別子。今走っているものと違えば何も起きない。 */
  readonly searchId: string
}

export interface CancelWorkspaceFileSearchResponse {
  /** 実際に走っていた検索を止めたか。 */
  readonly cancelled: boolean
}

/* ------------------------------------------------------------------ 契約 */

export interface FilesIpcContract {
  'files:read-directory': {
    request: ReadWorkspaceDirectoryRequest
    response: ReadWorkspaceDirectoryResponse
  }
  'files:read-file': {
    request: ReadWorkspaceFileRequest
    response: ReadWorkspaceFileResponse
  }
  'files:write-file': {
    request: WriteWorkspaceFileRequest
    response: WriteWorkspaceFileResponse
  }
  'files:save-as': {
    request: SaveWorkspaceFileAsRequest
    response: SaveWorkspaceFileAsResponse
  }
  'files:create': {
    request: CreateWorkspaceEntryRequest
    response: CreateWorkspaceEntryResponse
  }
  'files:rename': {
    request: RenameWorkspaceEntryRequest
    response: RenameWorkspaceEntryResponse
  }
  'files:move': {
    request: MoveWorkspaceEntryRequest
    response: MoveWorkspaceEntryResponse
  }
  'files:copy': {
    request: CopyWorkspaceEntryRequest
    response: CopyWorkspaceEntryResponse
  }
  'files:delete': {
    request: DeleteWorkspaceEntryRequest
    response: DeleteWorkspaceEntryResponse
  }
  'files:search': {
    request: SearchWorkspaceFilesRequest
    response: SearchWorkspaceFilesResponse
  }
  'files:search-content': {
    request: SearchWorkspaceFileContentsRequest
    response: SearchWorkspaceFileContentsResponse
  }
  'files:cancel-search': {
    request: CancelWorkspaceFileSearchRequest
    response: CancelWorkspaceFileSearchResponse
  }
}
