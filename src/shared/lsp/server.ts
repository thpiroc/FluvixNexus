/**
 * Language Server の名前（閉じた集合。Session 5-4 で shared へ移した）。
 *
 * Session 5-1 〜 5-3 では、この名前は Main の表
 * （main/lsp/languageServerCatalog.ts）の中だけにあった。境界の外から
 * 名前が届く経路が無かったためで、実際 Renderer は今も
 * 「どのサーバへ送るか」を言えない（shared/ipc/contracts/lsp.ts）。
 *
 * Session 5-4 で、名前が**契約に載る**理由が2つできた。
 *
 * ```
 * 設定   … 言語ごとの有効 / 無効（shared/settings/sections.ts の `lsp` section）
 * 状態   … どのサーバがどうなっているか（shared/lsp/serverStatus.ts）
 * ```
 *
 * どちらも「名前」しか要らない。**表の中身は移していない** ── 実行ファイル・
 * 引数・作業ディレクトリ・PATH の辿り方は Main の表に残したままで、
 * Renderer から見えるのは `typescript` / `python` / `csharp` という
 * 3つの語だけになる。
 *
 * 名前を渡せるようになったことで新しく起こることは無い、という点は
 * languageServerCatalog.ts の冒頭に書いたとおりで、Renderer から届く名前は
 * 「この行の設定を変えたい」「この行の状態を出したい」にしか使われない
 * ── **起動のきっかけは依然として「開いた文書の言語」だけ**にほかならない
 * （main/lsp/documentLanguage.ts）。
 */

/**
 * 並べる順。ログ・設定画面・ステータスバーの見た目を安定させるための順序で、
 * 優先度ではない（Session 5-1 の `LANGUAGE_SERVER_IDS` をそのまま移した）。
 */
export const LANGUAGE_SERVER_IDS = ['typescript', 'python', 'csharp'] as const

/** 表の行を指す名前。ここに無い文字列はサーバの名前ではない。 */
export type LanguageServerId = (typeof LANGUAGE_SERVER_IDS)[number]

/**
 * 境界の外から届いた値が、表の行を指しているか。
 *
 * 確かめる側を名前と同じファイルに置いてあるので、行を足したときに
 * 検証の漏れが起きない（`isSettingsSectionId` ・`isThemeId` と同じ作法）。
 */
export function isLanguageServerId(value: unknown): value is LanguageServerId {
  return typeof value === 'string' && (LANGUAGE_SERVER_IDS as readonly string[]).includes(value)
}
