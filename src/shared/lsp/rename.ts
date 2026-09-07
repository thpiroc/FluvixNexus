import type { TextDocumentPosition, TextDocumentRange } from './document'

/**
 * Rename が境界を越えて運ぶ値（Session 5-9）。
 *
 * ## ここだけが他の機能と違う ── 答えが「今の文書」に閉じない
 *
 * 補完・Hover・整形は、返るものがすべて**要求した文書の中**に収まる。
 * 定義 / 参照（Session 5-7）は他のファイルを指すが、指すだけで**書き換えない**。
 * Rename は初めて「別のファイルの中身を変える」答えが返る機能にあたる。
 *
 * したがって、この型が持つべき制約も1つ増える。
 *
 * ```
 * 5-5〜5-8 … 返る位置が Workspace の中か（見せてよいか）
 * 5-9      … 返る位置が Workspace の中の**実在するファイル**か（書いてよいか）
 * ```
 *
 * ## LSP の WorkspaceEdit をそのまま運ばない
 *
 * サーバが返す `WorkspaceEdit` には、TextEdit のほかに**ファイルの作成 / 改名 /
 * 削除**（`CreateFile` / `RenameFile` / `DeleteFile`）と、変更に添える注釈が入りうる。
 * それを Renderer まで通すと、「サーバがそう言ったから」でファイルが消える経路が
 * できる ── Session 5-9 で許すのは**既存ファイルの中身の置き換えだけ**なので、
 * この型にはそもそもそれ以外を表す欄が無い。
 *
 * 断るのは Main（main/lsp/renameResult.ts）で、断ったものは
 * 部分適用にせず**要求ごと拒否する**。Rename は「全部変わるか、何も変わらないか」の
 * どちらかでなければ、参照が片側だけ変わったコードが残る。
 *
 * ## URI は載らない
 *
 * 他の機能と同じく、Renderer へ渡るのは Workspace root からの相対位置だけになる
 * （main/lsp/documentUri.ts）。絶対パスも `file:` URI も、この型のどこにも無い。
 */

/**
 * 1回の Rename で書き換えてよいファイルの数。
 *
 * 上限があるのは、**別のプロセスが言ってきた数**であるため。桁違いの数を
 * そのまま受け取ると、Renderer はその数だけファイルを読み書きすることになる。
 *
 * 実際の Rename で 512 ファイルに届くことはまず無い（届くとすれば、
 * それは変数名ではなくプロジェクト全体で使われている型の名前になる）。
 */
export const LSP_RENAME_MAX_DOCUMENTS = 512

/** 1ファイルあたりの置き換えの数。 */
export const LSP_RENAME_MAX_EDITS_PER_DOCUMENT = 2048

/** 1回の Rename 全体での置き換えの数。 */
export const LSP_RENAME_MAX_TOTAL_EDITS = 8192

/**
 * 置き換える文字列の長さ。
 *
 * 整形（LSP_FORMATTING_MAX_TEXT_LENGTH）より桁を落としてあるのは、
 * Rename が置くのは**名前**だからにほかならない ── 1件で数百文字を超える
 * 置き換えは、名前の付け替えとしては起こらない形になる。
 */
export const LSP_RENAME_TEXT_MAX_LENGTH = 4096

/** 新しい名前として受け取れる長さ。 */
export const LSP_RENAME_NEW_NAME_MAX_LENGTH = 256

/** 置き換え1件（範囲と、そこへ入れる文字列）。 */
export interface LspRenameTextEdit {
  readonly range: TextDocumentRange
  readonly text: string
}

/** 1ファイルぶんの置き換え。 */
export interface LspRenameDocumentEdit {
  /** Workspace root からの相対位置。 */
  readonly relativePath: string
  /** 位置の順に並び、互いに重ならない（main/lsp/renameResult.ts が保証する）。 */
  readonly edits: readonly LspRenameTextEdit[]
}

/**
 * 断った理由。
 *
 * **失敗（IpcError）ではない。** どれも「要求は届いたが、その名前 / その位置 /
 * その答えでは書き換えない」という結末で、利用者へ出すのは1行の説明になる。
 * IPC の失敗にすると、Renderer 側で「エラーだが built-in へ落とすべきか」の
 * 分岐が要る ── 落としてよいのは `unavailable` だけなので、混ぜない。
 */
export type LspRenameRejection =
  /** その位置は名前を変えられない（サーバの答え）。 */
  | 'not-renameable'
  /** 新しい名前として受け取れない。 */
  | 'invalid-name'
  /** ファイルの作成 / 改名 / 削除など、扱えない形が混ざっていた。 */
  | 'unsupported-edit'
  /** Workspace の外、あるいは実在しないファイルを指していた。 */
  | 'outside-workspace'
  /** 上限を超えた。 */
  | 'too-many-edits'
  /** 電文の形が読めない・範囲が壊れている・範囲が重なっている。 */
  | 'malformed'
  /** サーバが失敗として返した。 */
  | 'server-error'

export interface LspPrepareRenameRequest {
  readonly relativePath: string
  readonly version: number
  readonly position: TextDocumentPosition
}

export type LspPrepareRenameResponse =
  | {
      readonly status: 'ok'
      readonly version: number
      /**
       * 名前が置かれている範囲。
       *
       * null になるのは、サーバが `{ defaultBehavior: true }` を返した場合
       * ── 「その位置で名前は変えられるが、範囲はクライアントが決めてよい」
       * という答えにあたる。Main は文書の本文を持たないため範囲を作れず、
       * 単語の切り出しは Monaco（＝本文を持つ側）に任せる。
       */
      readonly range: TextDocumentRange | null
      /** 入力欄の初期値。サーバが言わなければ null（Monaco が単語を使う）。 */
      readonly placeholder: string | null
    }
  | { readonly status: 'rejected'; readonly reason: LspRenameRejection }
  | { readonly status: 'stale' }
  | { readonly status: 'unavailable' }

export interface LspRenameRequest {
  readonly relativePath: string
  readonly version: number
  readonly position: TextDocumentPosition
  readonly newName: string
}

export type LspRenameResponse =
  | {
      readonly status: 'ok'
      /** 要求した文書の版（stale の判定に使ったもの）。 */
      readonly version: number
      /**
       * 書き換えるファイル。**要求した文書が含まれないこともある**
       * （宣言だけが別ファイルにある場合）。
       *
       * どれも Workspace の中に実在するファイルで、同じ相対位置は1度しか現れない。
       */
      readonly documents: readonly LspRenameDocumentEdit[]
    }
  | { readonly status: 'rejected'; readonly reason: LspRenameRejection }
  | { readonly status: 'stale' }
  | { readonly status: 'unavailable' }

/**
 * 新しい名前として受け取れる形か。
 *
 * **言語ごとの識別子の規則は見ない。** Rename の対象は変数名とは限らず
 * （JSX の属性・文字列の中の名前）、ここで TypeScript の規則を当てると
 * 正しい要求まで断ることになる。見るのは「境界を越えてよい文字列か」だけ
 * ── 空・空白だけ・制御文字を含む・長すぎる、を落とす。
 *
 * 制御文字を落とすのは、この文字列が**そのまま子プロセスの標準入力へ流れる**ため
 * にほかならない（`terminal:write` と同じ性質。main/ipc/handlers/lsp.ts）。
 */
export function isValidLspRenameName(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  if (value.length === 0 || value.length > LSP_RENAME_NEW_NAME_MAX_LENGTH) {
    return false
  }

  if (value.trim().length === 0) {
    return false
  }

  // 改行・タブ・NUL・DEL。名前としても文字列としても、これらは入らない。
  return !/[\u0000-\u001f\u007f]/.test(value)
}
