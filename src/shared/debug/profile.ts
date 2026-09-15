/**
 * Debug Profile（Session 6-10）── Renderer が読むのも書くのも、この形だけ。
 *
 * docs/ARCHITECTURE.md §20.3 の7欄で確定している。境界は**欄の性格**で引く（§20.1）。
 *
 * ```
 * プログラムが何をするかを変えるもの … ここにある（対象のファイル・引数・環境変数・入口で止めるか）
 * 何のプログラムが動くかを変えるもの … ここに無い（実行ファイル・interpreter・adapter・cwd）
 * ```
 *
 * ## ここに無いもの
 *
 * ```
 * cwd                           … 無い（常に Workspace root。Main が決める）
 * runtime / interpreter / python … 無い（PATH から Main が解決する）
 * adapter の実行ファイル / 引数  … 無い（main/debug/adapterCatalog.ts の表だけが持つ）
 * console / preLaunchTask        … 無い（出力先は Debug Console 固定・任意コマンド実行の別名になる）
 * 絶対パス / file URI            … 無い（programRelativePath は Workspace 相対だけ）
 * attach 系（processId / port）  … 無い（v1 は launch のみ）
 * 何でも入る入れ物               … 無い（languageOptions を作ると launch.json の作り直しになる。§20.10）
 * ```
 *
 * **解決済みの形（`ResolvedLaunchConfiguration`）は main/debug/resolvedLaunch.ts にあり、
 * shared にも IPC にも出ない**（§20.6）。この層に実行ファイルや絶対パスを表す欄が
 * 生えたら、それは設計に戻る合図になる。
 *
 * shared 層のルールどおり、型と定数と純粋な判定だけを持つ。欄の中身の検証
 * （相対位置の2段・環境変数の名前）は Main（main/debug/profileValidation.ts /
 * environmentPolicy.ts / programPath.ts）が行う。
 */

/**
 * 言語（閉じた集合）。ここから adapter が決まる（§20.7）。
 *
 * main/debug/adapterCatalog.ts の行はこの集合を網羅する。`LanguageServerId` と同じく、
 * 名前だけが契約に載り、**何をどう起動するかは1つも載らない**。
 */
export const DEBUG_PROFILE_LANGUAGES = ['node', 'python', 'csharp'] as const

export type DebugProfileLanguage = (typeof DEBUG_PROFILE_LANGUAGES)[number]

/**
 * Main が発行する profile の id（`dp-<uuid>`）。
 *
 * **Renderer は作れない。** 任意の id を書けると、保存領域の任意の位置を指す形に近づく
 * （§20.3）。作成の要求に id の欄は無く、更新 / 削除 / 起動で渡せるのは
 * 一覧で受け取った id だけになる。
 */
export type DebugProfileId = string

/** 全言語に共通の6欄（`profileId` と `language` を除く）。 */
interface DebugProfileCommonFields {
  /** 画面に出す名前。実行に一切関与しない。 */
  readonly name: string
  /**
   * 対象のプログラム。**Workspace root からの相対位置だけ**（区切りは `/`）。
   *
   * Main が保存時と起動時に Files と同じ2段（パス文字列 → realpath）で確かめる。
   * 絶対パス・`..`・ドライブ相対は受け付けない。
   */
  readonly programRelativePath: string
  /**
   * **プログラムへの**引数（adapter への引数ではない。§20.4）。
   *
   * shell を通さないので、`&&` も `|` も `%VAR%` も1語の文字列として届く。
   * adapter のコマンドラインには一語も現れず、DAP の `launch` request の中にだけ入る。
   */
  readonly programArgs: readonly string[]
  /**
   * プログラムの環境変数。名前に制限がある（main/debug/environmentPolicy.ts）。
   *
   * 値は文字列のまま渡り、Main は展開も置換もしない（`${...}` の仕組みを作らない）。
   */
  readonly env: Readonly<Record<string, string>>
  /** 入口で止めるか。何が動くかを変えない。 */
  readonly stopOnEntry: boolean
}

/*
  `language` を判別子とする union（§20.10）。**v1 はどの枝も固有の欄を持たない。**
  言語を1つ足す作業は、ここに枝を1本・catalog に行を1行で閉じる。
*/
export interface NodeDebugProfileDraft extends DebugProfileCommonFields {
  readonly language: 'node'
}

export interface PythonDebugProfileDraft extends DebugProfileCommonFields {
  readonly language: 'python'
}

export interface CsharpDebugProfileDraft extends DebugProfileCommonFields {
  readonly language: 'csharp'
}

/** 作成 / 更新の要求で受け取る形（`profileId` を持たない）。 */
export type DebugProfileDraft =
  NodeDebugProfileDraft | PythonDebugProfileDraft | CsharpDebugProfileDraft

/** 保存された Debug Profile（7欄）。 */
export type DebugProfile = DebugProfileDraft & { readonly profileId: DebugProfileId }

/* ---------------------------------------------------------------- 上限 */

/** 1 Workspace に保存できる profile の数。 */
export const DEBUG_PROFILES_MAX_PER_WORKSPACE = 50

export const DEBUG_PROFILE_NAME_MAX_LENGTH = 100

export const DEBUG_PROFILE_PROGRAM_ARGS_MAX_COUNT = 64

export const DEBUG_PROFILE_PROGRAM_ARG_MAX_LENGTH = 4_096

export const DEBUG_PROFILE_ENV_MAX_COUNT = 64

export const DEBUG_PROFILE_ENV_NAME_MAX_LENGTH = 256

export const DEBUG_PROFILE_ENV_VALUE_MAX_LENGTH = 8_192

/* ------------------------------------------------------- 保存の結末 */

/** 検証に通らなかった欄。 */
export type DebugProfileField =
  'name' | 'language' | 'programRelativePath' | 'programArgs' | 'env' | 'stopOnEntry'

/**
 * 欄が通らなかった理由（閉じた集合）。
 *
 * **入力した値そのものは載せない。** 画面は利用者が打った値を既に持っている。
 * 環境変数の名前で断ったときも、どの名前かは言わない（`denied-name` だけ）。
 */
export type DebugProfileInvalidReason =
  /** 型が違う（文字列でない・配列でない・真偽値でない）。 */
  | 'invalid-type'
  /** 空（名前が空白だけ・相対位置が Workspace root そのもの）。 */
  | 'empty'
  | 'too-long'
  | 'too-many'
  | 'contains-nul'
  /** 閉じた集合の外の言語。 */
  | 'unsupported'
  /** 相対位置として扱えない（絶対パス・`..`・ドライブ相対・`:`）。 */
  | 'invalid-path'
  /** 実体（symlink / ジャンクションの指し先）が Workspace の外。 */
  | 'outside-workspace'
  /** 環境変数の名前が `^[A-Za-z_][A-Za-z0-9_]*$` に合わない。 */
  | 'invalid-name'
  /** 「プログラムより先に何かを読み込ませる」名前（`PATH` / `NODE_OPTIONS` など）。 */
  | 'denied-name'
  /** 大文字小文字だけが違う名前が2つある（Windows では同じ変数になる）。 */
  | 'duplicate-name'

/** 保存を断った理由（欄の中身ではなく、状況によるもの）。 */
export type DebugProfileSaveRejection = 'no-workspace' | 'profile-not-found' | 'limit-reached'

/**
 * 作成 / 更新の結末。
 *
 * **欄の検証に通らなかったことは値で返す。** 利用者がフォームに打った値への
 * 普通の答えで、IPC の失敗ではない。IPC の失敗（INVALID_REQUEST）になるのは
 * 要求そのものの形が壊れているとき（`profile` が object でない・id の形でない）だけ。
 */
export type DebugProfileSaveOutcome =
  | {
      readonly status: 'saved'
      readonly profile: DebugProfile
      /** 保存した後の、今の Workspace の全件。 */
      readonly profiles: readonly DebugProfile[]
    }
  | {
      readonly status: 'invalid'
      readonly field: DebugProfileField
      readonly reason: DebugProfileInvalidReason
    }
  | { readonly status: 'rejected'; readonly reason: DebugProfileSaveRejection }

export type DebugProfileDeleteOutcome =
  | { readonly status: 'deleted'; readonly profiles: readonly DebugProfile[] }
  | {
      readonly status: 'rejected'
      readonly reason: Exclude<DebugProfileSaveRejection, 'limit-reached'>
    }

/* ------------------------------------------------------- 起動の結末 */

/**
 * 起動を断った理由（adapter へは何も起きていない）。
 *
 * ```
 * no-workspace      … Workspace が開かれていない
 * profile-not-found … 今の Workspace にその id の profile が無い
 * already-running   … Debug Session が既に動いている（v1 は同時に1本。§20.11）
 * ```
 */
export type DebugStartRejection = 'no-workspace' | 'profile-not-found' | 'already-running'

/**
 * 起動できなかった理由。
 *
 * ```
 * invalid-profile           … 保存された profile が起動時の検証に通らなかった（環境変数の名前など）
 * program-not-found         … 対象のファイルが無い / ファイルでない
 * program-outside-workspace … 対象の実体が Workspace の外（symlink / ジャンクション）
 * adapter-unavailable       … その言語の adapter をこの版は起動できない / PATH に無い
 * spawn-failed              … adapter のプロセスを立てられなかった
 * ```
 *
 * **理由の分類だけを返す。** 解決した絶対パス・adapter の実行ファイル・spawn の
 * 失敗の文言は Main のログにだけ残す（§20.9）。起動した後に adapter が落ちたことは
 * 状態（`debug:status-changed`）の側で届く。
 */
export type DebugStartFailure =
  | 'invalid-profile'
  | 'program-not-found'
  | 'program-outside-workspace'
  | 'adapter-unavailable'
  | 'spawn-failed'

/**
 * `adapter-unavailable` の中身（Session 7-1C）。利用者に「何を準備すればよいか」を出すための分類。
 *
 * ```
 * not-integrated           … この版はその言語の adapter を起動できない
 * runtime-not-found        … node.exe / python / dotnet が見つからない
 * adapter-not-found        … netcoredbg が PATH に無い / vscode-js-debug が置かれていない
 * adapter-not-verified     … 置かれた vscode-js-debug が pin した中身と一致しない
 * runtime-inside-workspace … PATH の node.exe（の実体）が Workspace の中にある
 * adapter-inside-workspace … adapter の置き場所（userData / netcoredbg のフォルダ）が Workspace の中にある
 * non-ascii-path           … netcoredbg が触るパスに ASCII 以外の文字がある
 * ```
 *
 * **閉じた集合だけを返す。** どのパスの・どの実行ファイルが原因だったかは Main のログにだけ残す（§20.9）。
 */
export type DebugAdapterUnavailableCause =
  | 'not-integrated'
  | 'runtime-not-found'
  | 'adapter-not-found'
  | 'adapter-not-verified'
  | 'runtime-inside-workspace'
  | 'adapter-inside-workspace'
  | 'non-ascii-path'

export type DebugStartOutcome =
  | { readonly status: 'started' }
  | { readonly status: 'rejected'; readonly reason: DebugStartRejection }
  | {
      readonly status: 'failed'
      readonly reason: Exclude<DebugStartFailure, 'adapter-unavailable'>
    }
  | {
      readonly status: 'failed'
      readonly reason: 'adapter-unavailable'
      /** 起動しようとした profile の言語（保存された profile から Main が読んだ値）。 */
      readonly language: DebugProfileLanguage
      readonly cause: DebugAdapterUnavailableCause
    }

/* ---------------------------------------------------------- 純粋な判定 */

const DEBUG_PROFILE_ID_PATTERN = /^dp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isDebugProfileLanguage(value: unknown): value is DebugProfileLanguage {
  return (
    typeof value === 'string' && DEBUG_PROFILE_LANGUAGES.includes(value as DebugProfileLanguage)
  )
}

/**
 * Main が発行した id の形か。
 *
 * 形だけを見る ── 今の Workspace に実在するかは Main が決め、無ければ
 * `profile-not-found` として値で返る。
 */
export function isDebugProfileIdShape(value: unknown): value is DebugProfileId {
  return typeof value === 'string' && DEBUG_PROFILE_ID_PATTERN.test(value)
}
