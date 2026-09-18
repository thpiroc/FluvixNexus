import type { SettingsSections, SettingsSectionUpdate } from '../../settings/sections'

/**
 * settings ドメインの IPC 契約（アプリの設定の永続化。Session 4-3A で2本へ集約）。
 *
 * ## チャンネルは2本だけ
 *
 * Session 3-5 〜 3-7-5 では、設定が増えるたびに読み書きの対を足していた
 * （`settings:load-editor` / `settings:save-editor` … 計6本）。用途ごとに API を切る
 * 方針（ARCHITECTURE.md §5）に従ったものだったが、**切れていたのは用途ではなく
 * 同じ形の写しだった** ── 6本のどれもやることは「文書を1つ読む / 書く」で、
 * 違うのは保存先のファイル名だけだった。
 *
 * 方針が本当に守りたかったのは「**Renderer が保存先を選べないこと**」であって、
 * それは section を閉じた集合にすれば同じだけ守れる。そこで
 *
 *   settings:load          … 既知の section をすべて読む
 *   settings:save-section  … 既知の section を1つ書く
 *
 * の2本にする。増えるのはチャンネルではなく `SettingsSectionId` になった。
 *
 * ## 任意の JSON は渡らない
 *
 * `settings:save-section` の要求は `SettingsSectionUpdate`（判別可能なユニオン）で、
 * `section` が判別子・`value` の型はそれに従う。**「名前と JSON を渡すと保存される」
 * 汎用 API にはしない** ── それを許すと、Renderer が好きな内容をディスクへ残せる
 * 場所になり、Renderer を OS から切り離している前提がそこで崩れる。
 *
 * 型は入口にすぎないので、Main 側でも必ず確かめる（main/store/settingsSections.ts）。
 * 既知でない section 名・object でない値・読めない key は保存に進まない。
 *
 * ## 保存は section 単位、読み込みは全部まとめて
 *
 * 書く側が section 単位なのは、**別の section を巻き込まないため**にほかならない
 * （Terminal の文字を大きくしただけで Editor の設定を書き直さない）。
 * 読む側をまとめてあるのは、読むのが起動時に1度だけで、section ごとに往復させても
 * 得るものが無いため。
 *
 * ## 読めなければ既定で始める
 *
 * 保存が無い / 壊れている場合でも失敗にはせず、その分だけ空の section を返す。
 * 設定が読めないことはアプリを使えない理由にならない（レイアウトと同じ扱い）。
 * key が無い ＝ 既定であり、既定の値そのものを知っているのは Renderer だけ。
 *
 * ## ユーザー設定 / ワークスペース設定（feature/settings-scope）
 *
 * チャンネルは2本のまま増やさず、**読み込みは両方の scope をまとめて返し、
 * 保存は scope を名乗らせる**形にした（shared/settings/scope.ts）。
 *
 * ワークスペース設定の保存先を決める鍵（Workspace の絶対パス）は **Renderer へ出ない。**
 * 保存要求が名乗れるのは `workspaceId`（開いた記録1件の識別子。
 * shared/workspace/folder.ts）だけで、Main はそれが**今開いている Workspace と
 * 一致するときだけ**書く ── 切り替えの直前に出た保存が、次に開いた別の
 * プロジェクトの設定へ混ざるのを防ぐため（一致しなければ CONFLICT）。
 * 任意の Workspace の設定を読み書きする口は無い（debug profile と同じ線。
 * ARCHITECTURE.md §20.5）。
 *
 * Workspace が切り替わったことは `settings:workspace-changed`（events/settings.ts）で
 * 届き、Renderer はそこで読み直す。
 */

/** 今開いている Workspace のワークスペース設定。 */
export interface WorkspaceSettingsSnapshot {
  /** 開いた記録の識別子。保存要求はこれを名乗る（保存先のパスは渡らない）。 */
  readonly workspaceId: string
  /** 画面に出す名前（Settings 画面の「○○ だけに適用」）。 */
  readonly displayName: string
  /** 上書きしている key だけを持つ section（上書きの無い section は空）。 */
  readonly sections: SettingsSections
}

export interface LoadSettingsResponse {
  /**
   * ユーザー設定。**必ず全部の section が入る**（中身は空でありうる）。
   *
   * 知らない section・知らない key は入らない ── それらは Main が
   * 書き戻すために持っているだけで、Renderer が解釈してよいものではない。
   */
  readonly user: SettingsSections
  /** ワークスペース設定。Workspace を開いていなければ null。 */
  readonly workspace: WorkspaceSettingsSnapshot | null
}

/** 保存する先。ワークスペース設定は、どの Workspace に向けた保存かを名乗る。 */
export type SettingsSaveTarget =
  { readonly scope: 'user' } | { readonly scope: 'workspace'; readonly workspaceId: string }

/**
 * 「どの scope の、どの section を、どんな値にするか」の1件。
 *
 * ワークスペース設定の `value` は**上書きする key だけ**を持つ。key を省けば
 * その key の上書きが消え、ユーザー設定へ戻る（「ユーザー設定に戻す」はこれで表す）。
 */
export type SaveSettingsSectionRequest = SettingsSectionUpdate & SettingsSaveTarget

export interface SettingsIpcContract {
  'settings:load': {
    request: void
    response: LoadSettingsResponse
  }
  'settings:save-section': {
    request: SaveSettingsSectionRequest
    response: void
  }
}
