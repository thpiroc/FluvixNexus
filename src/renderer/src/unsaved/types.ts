/**
 * 未保存の内容を失う操作に、確認を1本で挟むための型（React にも DOM にも依存しない）。
 *
 * ## なぜ1箇所にまとめるのか
 *
 * 未保存の内容が失われる操作は、Session 3-5 の時点で4つある。
 *
 *   - Editor のタブを閉じる
 *   - Workspace を閉じる（上部バー / Files の root 行の ×）
 *   - 別の Workspace へ切り替える
 *   - ウィンドウを閉じる / アプリを終了する
 *
 * 確認をそれぞれの入口に書くと、**入口が増えるたびに保護が抜ける**。
 * Session 3-3 で「閉じる入口が増えても後片付けは増えない」形にしたのと同じ考え方で、
 * 確認も「失われるものを持っている側」と「失わせる操作をする側」に分け、
 * 間を1つの器（UnsavedChangesProvider）でつなぐ。
 *
 * ```
 * 失われるものを持つ側（EditorProvider）
 *    ↓  registerSource：今何が未保存か / 全部保存できるか
 * UnsavedChangesProvider   確認の器（ダイアログを出すのはここだけ）
 *    ↑  confirmDiscard：この操作を続けてよいか
 * 失わせる側（Workspace を閉じる・ウィンドウを閉じる）
 * ```
 *
 * Provider を**両方より外側**（App.tsx の一番外）に置くことで、
 * Workspace の切り替え（WorkspaceFolderProvider）からも Editor からも
 * 同じ器を参照できる。
 */

/** 未保存の項目1件（利用者に何が失われるかを見せるための最小限）。 */
export interface UnsavedItem {
  /** 一覧の鍵。Editor では relativePath。 */
  readonly id: string
  /** 表示名（ファイル名）。 */
  readonly name: string
  /** どこにあるか（同じ名前のファイルを区別する）。 */
  readonly detail: string
  /**
   * 保存できる見込みが無いか。
   *
   * ディスクから消えたファイルがこれにあたる。保存を選べる形で出しても
   * 必ず失敗するため、確認の選択肢から「保存」を外す判断に使う。
   */
  readonly unsavable: boolean
}

/**
 * 未保存の内容を持っている側が申告するもの。
 *
 * `saveAll` が真偽値を返すのは、**保存できたときだけ続行してよい**ため。
 * Conflict や書き込みの失敗で保存が成立しなかった場合に閉じてしまうと、
 * 「保存を選んだのに失われた」が起きる。
 */
export interface UnsavedSource {
  readonly listUnsaved: () => readonly UnsavedItem[]
  readonly saveAll: () => Promise<boolean>
}

/** 何をしようとしているか（確認の文面を変えるため）。 */
export type UnsavedActionKind = 'close-workspace' | 'switch-workspace' | 'close-window'

/** 利用者が選んだこと。 */
export type UnsavedChoice = 'save' | 'discard' | 'cancel'
