/**
 * 設定の **section**（保存形式。Session 4-3A）。
 *
 * Session 3-5 〜 3-7-5 では、設定が増えるたびに
 * 「ファイル1つ・チャンネル2つ・検証1つ」を丸ごと足していた
 * （`editor-settings.json` / `files-settings.json` / `terminal-settings.json`）。
 * 3つ並んだ時点で分かったのは、**増えていたのは設定ではなく同じ形の写し**だった、
 * ということにほかならない ── 用途ごとに保存先を切る狙い（ARCHITECTURE.md §5）は
 * 「Renderer が保存先を選べない」ことにあり、それはファイルの数とは関係が無い。
 *
 * そこで保存先は `settings.json` 1つにまとめ、その中を section で分ける。
 * 用途の限定は**ファイル名ではなく section の閉じた集合**が持つ。
 *
 * ## section は閉じた集合にする
 *
 * `SETTINGS_SECTION_IDS` に載っているものだけが section で、Renderer から
 * 任意の名前を渡すことはできない（IPC の要求も `SettingsSectionUpdate` という
 * 判別可能なユニオンで、Main 側でも必ず既知の section か確かめる。
 * shared/ipc/contracts/settings.ts）。**任意の名前を許した時点で
 * 「アプリの設定」という限定が消え、Renderer が好きな内容をディスクへ残せる場所になる。**
 *
 * ## section の中は平らにする
 *
 * 旧形式は `{ autoSave: { mode, delayMs } }` のように入れ子だったが、新しい形では
 * `{ autoSaveMode, autoSaveDelayMs }` と平らに置く。理由は**1つの key が壊れても
 * 他を捨てないため**で、入れ子にすると「`autoSave` が object でない」の一撃で
 * 中の2つとも失われる（旧形式の parse は実際そうなっていた）。
 * 平らにしておけば、読む側は key ごとに独立して落とせる。
 *
 * ## key はすべて任意
 *
 * どの key も `?` が付く。**無い ＝ 既定**であり、読めなかった key は
 * Main が落とす（main/store/settingsSections.ts）ので、Renderer から見ると
 * 「壊れていた key は最初から無かった」ように見える。既定値そのものは
 * ここにも Main にも書かない ── その意味を知っているのは Renderer だけ
 * （editor/autoSave.ts・files/filesSettings.ts・terminal/terminalSettings.ts）。
 *
 * ## 将来 section を足すとき
 *
 * `SETTINGS_SECTION_IDS` に名前を足し、`SettingsSections` に型を足し、
 * main/store/settingsSections.ts の表に key を足す ── その3箇所だけで閉じる。
 * `appearance`（Theme）・`git`・`workspace` などはこの形で入る想定で、
 * **中身が決まっていない section を先に作らない**（空の section は
 * 「まだ何も無い場所」をディスクに残すだけになる）。
 */

/**
 * 既知の section の名前。
 *
 * 順序は保存ファイルに並ぶ順序でもある（読む人が追いやすいよう、
 * 機能の並び ── Editor / Files / Terminal ── に合わせてある）。
 */
export const SETTINGS_SECTION_IDS = ['editor', 'files', 'terminal'] as const

/** 既知の section の名前。ここに無い名前は section ではない。 */
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

/** Editor の設定（Auto Save。§12.4）。 */
export interface StoredEditorSettings {
  /** `off` / `afterDelay` / `onFocusChange` / `onWindowChange`。知らない値は読む側が既定へ落とす。 */
  readonly autoSaveMode?: string
  /** `afterDelay` の待ち時間（ミリ秒）。上下限は読む側が掛ける。 */
  readonly autoSaveDelayMs?: number
}

/** Files の見え方（表示方式・カラムの幅。§10.14）。 */
export interface StoredFilesSettings {
  /**
   * `auto` / `tree` / `columns`。知らない値は読む側が既定へ落とす。
   *
   * **`auto` も「そう決めた状態」として保存する。** 保存しないことで表すと、
   * 一度カラムを選んだ人が「パネルの形に任せる」へ戻したことが次回に伝わらない。
   */
  readonly viewMode?: string
  /** カラム1枚の幅（px）。上下限は読む側が掛ける。 */
  readonly columnWidth?: number
}

/** Terminal の見え方（文字の大きさ・さかのぼれる行数。§13.4）。 */
export interface StoredTerminalSettings {
  /** 文字の大きさ（px）。上下限は読む側が掛ける。 */
  readonly fontSize?: number
  /** さかのぼれる行数。上下限は読む側が掛ける。 */
  readonly scrollback?: number
}

/**
 * 既知の section をすべて持つ器。
 *
 * **どの section も必ず存在する**（中身が空の `{}` にはなりうる）。
 * 「その section だけ保存が無い」と「その section が壊れていた」を
 * 読む側が区別する必要は無く、どちらも「key が無い ＝ 既定」で足りるため。
 */
export interface SettingsSections {
  readonly editor: StoredEditorSettings
  readonly files: StoredFilesSettings
  readonly terminal: StoredTerminalSettings
}

/** section 名から、その section の値の型へ。 */
export type SettingsSectionValue<Id extends SettingsSectionId> = SettingsSections[Id]

/**
 * 「この section をこの内容にする」という1件の指示（判別可能なユニオン）。
 *
 * `section` が判別子で、`value` の型はそれに従う ── `{ section: 'editor',
 * value: { fontSize: 13 } }` は型の時点で通らない。IPC の要求そのものが
 * この形をしているため（shared/ipc/contracts/settings.ts）、
 * **「任意の key を持つ任意の JSON」が Renderer から渡る経路が存在しない。**
 */
export type SettingsSectionUpdate = {
  readonly [Id in SettingsSectionId]: {
    readonly section: Id
    readonly value: SettingsSections[Id]
  }
}[SettingsSectionId]

/** 何も保存されていない状態（section はすべて空）。 */
export function emptySettingsSections(): SettingsSections {
  return { editor: {}, files: {}, terminal: {} }
}

/** 素の文字列が既知の section 名か。 */
export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
}
