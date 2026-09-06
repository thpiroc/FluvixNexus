import type { StoredLspSettings } from '../settings/sections'
import { LANGUAGE_SERVER_IDS, type LanguageServerId } from './server'

/**
 * Language Server を使うかどうか（保存形式との行き来。Session 5-4）。
 *
 * ## ここが shared にある理由
 *
 * このプロジェクトの分担では、保存された値の**意味**を決めるのは Renderer で、
 * Main は「後で解釈できる形か」までしか見ない（main/store/settingsSections.ts）。
 * `lsp` section はその形から**外れる最初の設定**になる。
 *
 * ```
 * Auto Save の方式  … 効くのは Renderer の中だけ（いつ files:write-file を呼ぶか）
 * Theme            … 効くのは Renderer の中だけ（Main は起動時の1枚を塗るだけ）
 * LSP の有効 / 無効 … **効くのは Main の中**（プロセスを立てる / 終わらせる）
 * ```
 *
 * 有効かどうかを Renderer が決めて Main へ「起動して / 止めて」と頼む形にはしない
 * ── それは Renderer に**プロセスの制御**を渡すことになり、Session 5-1 から
 * 引いてきた線（起動のきっかけは開いた文書の言語だけ）がそこで消える。
 *
 * したがって Main が自分でこの設定を読む。**同じ値を2通りに読まない**ために、
 * 読み方そのものをここへ置いて Main と Renderer の両方が通る
 * ── `normalizeThemeId`（shared/theme/theme.ts）が Main・Preload・Renderer の
 * 3箇所から使われているのとまったく同じ形にあたる。
 *
 * ## 無い ＝ 有効
 *
 * どの key も省略できて、省略は**有効**を意味する。既定を「使う」にしてあるのは、
 * Session 5-2 / 5-3 までの振る舞いがそれだったため ── 設定を足したことで、
 * 何も変えていない利用者の手元で診断が消えては困る。
 *
 * 読めない値（数・文字列・null）も既定へ落とす。**設定が読めないことは、
 * 言語機能が使えない理由にならない**（Auto Save の「読めなければ OFF」、
 * Theme の「読めなければ Dark」と同じ扱い）。
 *
 * ## 2段になっている
 *
 * ```
 * enabled            … 全体。false ならどの言語も使わない
 * <言語>Enabled      … その言語だけ
 * ```
 *
 * 全体を切れるようにしてあるのは、**「今は全部止めたい」に言語の数だけ
 * 操作させない**ため。言語ごとを持つのは、1つのサーバだけが重い・
 * 落ち続ける、という場合に他を巻き添えにしないためになる
 * （設計判断 6 ── Git が入っていない PC でも他は使えるのと同じ線）。
 */

/** 今の設定（読めない値はここまで来ない）。 */
export interface LanguageServerPreferences {
  /** 全体として Language Server を使うか。 */
  readonly enabled: boolean
  /** 言語ごとに使うか。**全体が false ならどれも使わない**（`isLanguageServerEnabled`）。 */
  readonly servers: Readonly<Record<LanguageServerId, boolean>>
}

/** 既定。保存が無い / 読めないときはここから始まる（＝ Session 5-3 までと同じ振る舞い）。 */
export const DEFAULT_LANGUAGE_SERVER_PREFERENCES: LanguageServerPreferences = {
  enabled: true,
  servers: { typescript: true, python: true, csharp: true }
}

/**
 * 言語ごとの key の名前。
 *
 * section の中は平らにする（shared/settings/sections.ts）ので、
 * `servers: { typescript: true }` のような入れ子では保存しない ──
 * 入れ子にすると `servers` が object でない一撃で3つとも失われる。
 */
const SERVER_ENABLED_KEYS = {
  typescript: 'typescriptEnabled',
  python: 'pythonEnabled',
  csharp: 'csharpEnabled'
} as const satisfies Readonly<Record<LanguageServerId, keyof StoredLspSettings>>

/** 保存された section を、今の設定として読む。読めない key は既定へ落とす。 */
export function normalizeLanguageServerPreferences(
  stored: StoredLspSettings | undefined
): LanguageServerPreferences {
  const servers: Record<LanguageServerId, boolean> = {
    ...DEFAULT_LANGUAGE_SERVER_PREFERENCES.servers
  }

  for (const id of LANGUAGE_SERVER_IDS) {
    servers[id] = readFlag(stored?.[SERVER_ENABLED_KEYS[id]], true)
  }

  return { enabled: readFlag(stored?.enabled, true), servers }
}

/** 今の設定を、保存する section へ。 */
export function toStoredLspSettings(preferences: LanguageServerPreferences): StoredLspSettings {
  return {
    enabled: preferences.enabled,
    typescriptEnabled: preferences.servers.typescript,
    pythonEnabled: preferences.servers.python,
    csharpEnabled: preferences.servers.csharp
  }
}

/**
 * その言語のサーバを使ってよいか。
 *
 * **全体と言語の両方が有効なときだけ true。** 判断をここ1つに閉じてあるので、
 * 起動を止める側（main/lsp/documentSync.ts）と状態を出す側
 * （main/lsp/serverStatus.ts）が別々の答えを出すことがない。
 */
export function isLanguageServerEnabled(
  preferences: LanguageServerPreferences,
  id: LanguageServerId
): boolean {
  return preferences.enabled && preferences.servers[id]
}

/**
 * 2つの設定が同じか。
 *
 * 「同じなら据え置く」判断は値の意味を知っている側が持つ、という約束
 * （renderer/src/settings/useSettingsSection.ts）に従って、その判断材料を
 * ここが出す。同じ値で保存と再描画が走り続ける経路を作らないためのもの。
 */
export function isSameLanguageServerPreferences(
  a: LanguageServerPreferences,
  b: LanguageServerPreferences
): boolean {
  return (
    a.enabled === b.enabled && LANGUAGE_SERVER_IDS.every((id) => a.servers[id] === b.servers[id])
  )
}

/** 真偽値として読めなければ既定へ落とす（数も文字列も null も「無い」と同じ扱い）。 */
function readFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
