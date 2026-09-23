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
 * **中身が決まっていない section を先に作らない**（空の section は
 * 「まだ何も無い場所」をディスクに残すだけになる）。
 *
 * Session 4-4 の `appearance` が、その形で入った最初の section にあたる。
 * 予告どおり増えたのはファイルでもチャンネルでもなく section 1つと key 1つで、
 * IPC も Preload の口も Main の検証の仕組みも1つも変わっていない。
 * `git`・`workspace` も同じ形で入る想定。
 *
 * Session 5-4 の `lsp` が2つめになる。増えたのは section 1つと key 4つ、
 * それに真偽値という**新しい key の型**が1つだけで、IPC もチャンネルも
 * 増えていない。ただしこの section には他と違うところが1つあり、
 * **値の意味を Main も読む**（プロセスを立てる / 終わらせるのは Main の側で、
 * 有効かどうかは Renderer の中では完結しない）。読み方を2通りに分けないため、
 * 読む関数そのものを shared に置いてある（shared/lsp/serverSettings.ts）。
 */

/**
 * 既知の section の名前。
 *
 * 順序は保存ファイルに並ぶ順序でもある（読む人が追いやすいよう、
 * 機能の並び ── Editor / Files / Terminal / Appearance ── に合わせてある。
 * Settings 画面のカテゴリの並びとも同じ。renderer/src/settings/settingsCatalog.ts）。
 *
 * **Appearance が末尾なのは、対象が他の3つと違うため。** 前の3つは
 * 「その機能の見え方・振る舞い」で、Appearance は**アプリ全体の見た目**にあたる
 * ── 前の3つに挟むと、どの機能の話をしているのか分からない場所ができる。
 */
export const SETTINGS_SECTION_IDS = [
  'general',
  'appearance',
  'editor',
  'lsp',
  'files',
  'terminal',
  'mcp',
  'security'
] as const

/** 既知の section の名前。ここに無い名前は section ではない。 */
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

/** アプリ全体の基本設定（Language。Session 4-5A）。 */
export interface StoredGeneralSettings {
  /** `ja` / `en`。知らない値は読む側が既定（日本語）へ落とす。 */
  readonly language?: string
}

/** Editor の設定（Auto Save。§12.4）。 */
export interface StoredEditorSettings {
  /** `off` / `afterDelay` / `onFocusChange` / `onWindowChange`。知らない値は読む側が既定へ落とす。 */
  readonly autoSaveMode?: string
  /** `afterDelay` の待ち時間（ミリ秒）。上下限は読む側が掛ける。 */
  readonly autoSaveDelayMs?: number
}

/**
 * Language Server を使うかどうか（Session 5-4）。
 *
 * 平らに並んだ4つの真偽値で、**どれも省略できる（無い ＝ 有効）**。
 * 言語ごとを `servers: { typescript: true }` のような入れ子にしないのは、
 * この section の冒頭に書いた理由そのもの ── 入れ子にすると
 * 「`servers` が object でない」の一撃で3つとも失われる。
 *
 * ここに**無いもの**が、この section の性格を決めている。
 *
 * ```
 * 実行ファイルのパス … 無い（表は main/lsp/languageServerCatalog.ts）
 * 引数・作業ディレクトリ … 無い
 * サーバごとの追加設定（initializationOptions）… 無い
 * ```
 *
 * 設定から渡せるのは**使うか / 使わないか**だけで、何をどう起動するかは
 * 1つも渡せない。ここに path の欄を1つ足した時点で、設定ファイルは
 * 「Renderer と利用者が指定した実行ファイルが起動する場所」になり、
 * Session 5-1 から引いてきた線が消える（DESIGN.md の STEP 5 引き継ぎ）。
 *
 * 値の読み方（無い ＝ 有効・読めない値の落とし先）は
 * shared/lsp/serverSettings.ts が持ち、Main と Renderer の両方がそこを通る。
 */
export interface StoredLspSettings {
  /** 全体として Language Server を使うか。 */
  readonly enabled?: boolean
  /** TypeScript / JavaScript（1本のサーバが両方を見る）。 */
  readonly typescriptEnabled?: boolean
  /** Python。 */
  readonly pythonEnabled?: boolean
  /** C#。 */
  readonly csharpEnabled?: boolean
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

/** アプリ全体の見た目（Theme。§16）。 */
export interface StoredAppearanceSettings {
  /**
   * Theme の名前（`dark` / `light`）。知らない値は読む側が既定（Dark）へ落とす。
   *
   * ここが**素の文字列**なのは、他の section の `autoSaveMode` ・`viewMode` と
   * まったく同じ理由にあたる ── Main は「文字列であること」しか見ず、
   * 名前として意味があるかは読む側が決める（shared/theme/theme.ts の
   * `normalizeThemeId`）。アプリをダウングレードすれば、この版が知らない
   * Theme 名が保存されている状態は普通に起こりうる。
   */
  readonly theme?: string
}

/**
 * MCP 連携を使うかどうか（全体の元栓）。
 *
 * **ここに入るのは「使う意思」だけで、秘密の値は1つも入らない。**
 * 秘密情報はこのファイル（`settings.json`）へ平文で書かず、OS の資格情報で
 * 暗号化した別のファイルが持つ（main/mcp/mcpSecretStore.ts）── 設定ファイルは
 * 利用者が開いて読める場所にあり、バックアップや画面共有にも普通に写る。
 *
 * 登録したサーバーごとの栓は、ここではなく登録簿（`mcp-servers.json`）が持つ。
 * 旧 Notion MCP の `notionEnabled` は、版 1 → 2 の移行で消える
 * （main/store/settingsMigration.ts）。
 */
export interface StoredMcpSettings {
  /** MCP 連携そのものを使うか。無ければ既定（使わない）。 */
  readonly enabled?: boolean
}

/**
 * FN Agent の Security（Security Core v1 の STEP1。DESIGN.md §6.4）。
 *
 * **他の section と3つの点で扱いが違う。**
 *
 * ```
 * 重ね方   ワークスペース > ユーザー ではなく、常に厳しい方（shared/settings/scope.ts の restrictive）
 * 保存     read / ask 以外は Main が拒む（main/store/settingsSections.ts の SECTION_FIELD_CHOICES）
 * 読み込み 読めない値は落とさず、最も厳しい値（read）に置き換える（同 FAIL_CLOSED_SECTION_VALUES）
 * ```
 *
 * どれも「この section は Security を**緩める側へ倒れてはいけない**」の言い換えにあたる。
 * 値の意味は shared/security/permissionMode.ts が持つ。
 *
 * ここに入るのは Permission だけで、**Security Core そのものを止める欄は無い**
 * ── Workspace の外への禁止・Secret ファイルへの書き込み禁止・MCP の書き込み禁止などの
 * 固定の規則は設定ではなく Main の定数にある（main/security/policy/securityDecision.ts）。
 * Settings 画面の項目もまだ無い（Agent が実際にこの設定を使う段階で足す）。
 */
export interface StoredSecuritySettings {
  /** `read` / `ask`。無ければ既定（`ask`）、読めない値は `read`。 */
  readonly permissionMode?: string
  /**
   * FN Agent 全体の ON / OFF（STEP9）。無ければ既定（ON）、読めない値は OFF。
   *
   * OFF にすると Agent Loop が始まらない（実行中なら次の Action へ進まずに止まる）。
   * **Security Core を止める欄ではない** ── OFF は Agent を使わないことで、ON にしても
   * 検査・承認は何も緩まない。ワークスペース設定は OFF にする向きにしか効かない（strictest）。
   * Settings 画面の項目は Closing STEP で足す。
   */
  readonly agentEnabled?: boolean
}

/**
 * 既知の section をすべて持つ器。
 *
 * **どの section も必ず存在する**（中身が空の `{}` にはなりうる）。
 * 「その section だけ保存が無い」と「その section が壊れていた」を
 * 読む側が区別する必要は無く、どちらも「key が無い ＝ 既定」で足りるため。
 */
export interface SettingsSections {
  readonly general: StoredGeneralSettings
  readonly appearance: StoredAppearanceSettings
  readonly editor: StoredEditorSettings
  readonly lsp: StoredLspSettings
  readonly files: StoredFilesSettings
  readonly terminal: StoredTerminalSettings
  readonly mcp: StoredMcpSettings
  readonly security: StoredSecuritySettings
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
  return {
    general: {},
    appearance: {},
    editor: {},
    lsp: {},
    files: {},
    terminal: {},
    mcp: {},
    security: {}
  }
}

/** 素の文字列が既知の section 名か。 */
export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
}
