/**
 * ファイルの中身を Editor へ渡すときの形。
 *
 * ツリー（entry.ts）が「どこに何があるか」を扱うのに対し、こちらは「その1件の中身」。
 * 分けてあるのは、ツリーが1回で数千件を運ぶのに対し、中身は1件を丸ごと運ぶという
 * 性質の違いがそのまま上限の置き方（件数 / バイト数）に出るため。
 *
 * shared 層のルールどおり、ここは型と定数だけを持つ。
 */

/**
 * 1ファイルを読み込む上限（バイト）。
 *
 * IPC は構造化クローンで文字列をまるごと運ぶため、上限が無いと数百 MB のログを
 * 1回開いただけでアプリが固まる。Monaco も同じ桁のテキストは扱えない。
 * 「開けなかった」ことを Editor 側で伝える方が、固まるより行き止まりにならない。
 */
export const FILES_FILE_MAX_BYTES = 2 * 1024 * 1024

/**
 * バイナリ判定のために先頭から見る量（バイト）。
 *
 * git が同じ考え方（先頭 8000 バイトに NUL があればバイナリ）を採っている。
 * 全体を走査しないのは、判定のためだけに大きなファイルを舐める意味が無いため。
 */
export const FILES_BINARY_SNIFF_BYTES = 8000

/**
 * ファイルを開いた結果。
 *
 * バイナリ・大きすぎるを IPC の失敗にしていないのは、どちらも
 * 「読めたが、テキストとしては出せない」という**通常の結末**だから
 * （workspace-folder:open の 'cancelled' と同じ扱い。ARCHITECTURE.md §8.3）。
 * 失敗として返すと、Renderer 側で「エラーだが利用者には説明したい」という
 * 例外的な分岐を作ることになる。
 *
 * 一方、消えている・権限が無い・Workspace の外を指している、は IPC の失敗のまま。
 * そちらは「開く対象として成立していない」ため。
 */
export type WorkspaceFileStatus = 'ok' | 'binary' | 'too-large'

/** 改行の種類。保存の際、開いたときの形を保つために持つ。 */
export type FileLineEnding = 'lf' | 'crlf'

/**
 * ファイルの文字コード。
 *
 * ## 今は UTF-8 だけを開く
 *
 * 読み書きはどちらも UTF-8 前提で、それ以外の文字コードのテキストは
 * 「開けるが化ける」ではなく**開かない**（UTF-16 は NUL が並ぶため binary として落ちる。
 * main/files/fileContent.ts）。化けた内容を編集して保存できる状態を作らないため。
 *
 * ## BOM だけは形として保つ
 *
 * Windows のツール（メモ帳・PowerShell の一部）は UTF-8 に BOM を付ける。
 * 読むときに落とすだけだと、保存した瞬間に BOM が消えて**開いて保存しただけで
 * 差分が出る**。そこで「BOM が付いていたか」を1件の属性として持ち回り、
 * 保存で同じ形に書き戻す。中身の文字列そのものには BOM を含めない
 * （含めると Monaco の1行目の先頭に見えない文字が入る）。
 *
 * ## 将来の広げ方
 *
 * この型に `shift_jis` / `utf16le` などを足し、
 *
 *   読む … main/files/fileContent.ts（バイト列 → 文字列）
 *   書く … main/files/writeWorkspaceFile.ts（文字列 → バイト列）
 *
 * の2箇所だけを増やせば済む形にしてある。Renderer 側は
 * 「読んだときの encoding を保存にそのまま返す」以上のことをしないため、
 * 文字コードを選べるようにする段階でも Editor の経路は変わらない。
 * 変換表を持つ大きなライブラリは、実際に必要になるまで入れない。
 */
export type FileEncoding = 'utf8' | 'utf8-bom'

/** 現在扱える文字コード（UI に並べる順序でもある）。 */
export const FILE_ENCODINGS: readonly FileEncoding[] = ['utf8', 'utf8-bom']

/** 境界の外から来た値が、扱える文字コードか。 */
export function isFileEncoding(value: unknown): value is FileEncoding {
  return typeof value === 'string' && (FILE_ENCODINGS as readonly string[]).includes(value)
}

/**
 * 読み込んだ（あるいは書き込んだ）時点のファイルの版。
 *
 * ## 何のためにあるか
 *
 * 保存を**無条件の上書きに固定しない**ため。ファイルはアプリの外（別のエディタ・Git・
 * ビルドツール）でも書き換わる。読んだときの版を覚えておけば、保存の直前に
 * 「読んだときのままか」を Main 側で確かめられ、違っていた場合に上書きせずに
 * 結末として返せる（shared/ipc/contracts/files.ts の 'stale'）。
 *
 * Session 3-4 の時点で用意しているのはその**検出**までで、
 * Reload / Compare / Overwrite の選択 UI は後続（DESIGN.md §4）。
 * ただし検出の入口をここに置いておかないと、保存経路が
 * 「常に上書きする」形で固まってしまい、後から差し込む場所が無くなる。
 *
 * ## mtime と size の組にしている理由
 *
 * どちらか一方では取りこぼす。mtime だけだと、同じ時刻に書き換わった場合
 * （粒度の粗いファイルシステム）に気づけない。size だけだと、
 * 1文字を別の1文字へ書き換えた変更が通ってしまう。
 *
 * ハッシュにしないのは、保存のたびにファイル全体を読み直すことになるため。
 * 「確実に検出する」より「安く検出する」を採り、取りこぼしても
 * 従来（無条件の上書き）と同じ結果にしかならないようにしてある。
 */
export interface FileRevision {
  /** 最終更新時刻（epoch ミリ秒）。 */
  readonly mtimeMs: number
  /** ディスク上の大きさ（バイト）。 */
  readonly size: number
}
