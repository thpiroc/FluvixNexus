import type { StoredEditorSettings } from '@shared/settings'

/**
 * Auto Save の設定モデル。
 *
 * ## 設定と動作を分ける
 *
 * ここが持つのは「どんな設定がありうるか」「境界から来た値をどう読むか」
 * 「保存形式とどう行き来するか」だけで、**いつ保存するかは持たない**
 * （それは useEditorSession.ts）。layout/ が React を知らないのと同じ分担で、
 * このファイルは React も Monaco も IPC も知らない（＝ Vitest でそのまま試せる）。
 *
 * ```
 * autoSave.ts             設定の形と、その正規化 / 保存形式との変換
 * useEditorSession.ts     その設定に従って、いつ saveFile を呼ぶか
 * settings/useSettingsSection.ts  いつ読み、いつ書くか（Session 4-3A で3箇所から集約）
 * shared/settings/        ディスクに置く形（`editor` section）
 * main/store/settings.ts  保存先（settings.json）
 * ```
 *
 * ## 既定は必ず OFF
 *
 * 自動保存は**利用者が明示的に選ぶもの**にする。既定で入れると、
 * 「開いて眺めていたつもり」の操作がディスクに残る。ビルドやテストを
 * 走らせながら編集する道具である以上、書き込む瞬間は利用者が決められた方がよい。
 * 保存された設定が読めなかった場合も OFF へ落ちる。
 */

/**
 * 自動保存の方式。
 *
 * | mode             | いつ保存するか                                   |
 * | ---------------- | ------------------------------------------------ |
 * | `off`            | 自動保存しない（Ctrl+S だけ）                    |
 * | `afterDelay`     | 入力が止まってから `delayMs` 後                  |
 * | `onFocusChange`  | 別のタブへ移ったとき（離れたタブを保存する）     |
 * | `onWindowChange` | ウィンドウがフォーカスを失ったとき（全部保存）   |
 *
 * `onFocusChange` が「エディタから focus が外れたとき」ではなく
 * 「別のタブへ移ったとき」なのは、**Files パネルをクリックしただけで
 * 書き込まれる**のを避けるため。ツリーを辿るのは編集の一部で、
 * 「編集をやめた」ことを意味しない。
 */
export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange'

export interface AutoSaveSettings {
  readonly mode: AutoSaveMode
  /**
   * `afterDelay` の待ち時間（ミリ秒）。
   *
   * 入力のたびに IPC を往復させないための間引き。レイアウトの保存
   * （ARCHITECTURE.md §7.8 の 400ms）より長くしてあるのは、
   * 書き込む先が利用者のプロジェクトのファイルであり、
   * 打っている途中の状態がディスクに残る回数を減らしたいため。
   *
   * mode が `afterDelay` でなくても持ち回して保存する。切り替えて戻ったときに
   * 待ち時間まで既定へ戻ってしまわないようにするため。
   */
  readonly delayMs: number
}

/** すべての mode（UI に並べる順序でもある）。 */
export const AUTO_SAVE_MODES: readonly AutoSaveMode[] = [
  'off',
  'afterDelay',
  'onFocusChange',
  'onWindowChange'
]

export const AUTO_SAVE_DELAY_MIN_MS = 200
export const AUTO_SAVE_DELAY_MAX_MS = 60_000

/** 既定。**必ず OFF**（上のコメント）。 */
export const DEFAULT_AUTO_SAVE_SETTINGS: AutoSaveSettings = {
  mode: 'off',
  delayMs: 1000
}

function isAutoSaveMode(value: unknown): value is AutoSaveMode {
  return typeof value === 'string' && (AUTO_SAVE_MODES as readonly string[]).includes(value)
}

/**
 * 保存された設定（あるいは境界の外から来た値）を、扱ってよい形へ落とす。
 *
 * **知らない mode は既定へ落とす。** 起きるのはアプリをダウングレードした場合で、
 * 「知らない設定で動いているのに動いていないように見える」より、
 * 明示的に OFF から始まる方が分かりやすい（store/workspaceLayoutDocument.ts が
 * 読めない保存データを Default プリセットへ落とすのと同じ考え方）。
 */
export function normalizeAutoSaveSettings(raw: unknown): AutoSaveSettings {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_AUTO_SAVE_SETTINGS
  }

  const { mode, delayMs } = raw as { mode: unknown; delayMs: unknown }

  const resolvedMode = isAutoSaveMode(mode) ? mode : DEFAULT_AUTO_SAVE_SETTINGS.mode

  const resolvedDelay =
    typeof delayMs === 'number' && Number.isFinite(delayMs)
      ? Math.min(Math.max(Math.round(delayMs), AUTO_SAVE_DELAY_MIN_MS), AUTO_SAVE_DELAY_MAX_MS)
      : DEFAULT_AUTO_SAVE_SETTINGS.delayMs

  return { mode: resolvedMode, delayMs: resolvedDelay }
}

/* ------------------------------------------------------ 保存形式との変換 */

/**
 * 保存された section から、実行時の設定へ。
 *
 * key ごとに読める形かは Main が確かめており（store/settingsSections.ts）、
 * **読めなかった key はここへ届く時点で無い**。ここが見るのは中身の意味だけで、
 * 分担はレイアウト（§7.8）と同じ。
 *
 * 無い key を既定へ落とすのも key ごとに独立している ── mode だけが壊れた
 * ファイルから、待ち時間まで捨てない（Session 4-3A）。
 */
export function toAutoSaveSettings(stored: StoredEditorSettings): AutoSaveSettings {
  return normalizeAutoSaveSettings({
    mode: stored.autoSaveMode,
    delayMs: stored.autoSaveDelayMs
  })
}

/**
 * 実行時の設定から、保存する section へ。
 *
 * 保存形式を別の型にしてある理由は shared/settings/sections.ts。
 * 変換をこの1箇所に置いておくと、実行時モデルを変えたときに
 * 直すべき場所が必ずここに現れる。
 */
export function toEditorSettingsSection(settings: AutoSaveSettings): StoredEditorSettings {
  return { autoSaveMode: settings.mode, autoSaveDelayMs: settings.delayMs }
}

/** 同じ設定か（保存を予約するかどうかの判断）。 */
export function isSameAutoSaveSettings(a: AutoSaveSettings, b: AutoSaveSettings): boolean {
  return a.mode === b.mode && a.delayMs === b.delayMs
}

/** UI に出す名前。 */
export function describeAutoSaveMode(mode: AutoSaveMode): string {
  switch (mode) {
    case 'off':
      return '自動保存: しない'

    case 'afterDelay':
      return '自動保存: 入力が止まったら'

    case 'onFocusChange':
      return '自動保存: タブを離れたら'

    case 'onWindowChange':
      return '自動保存: ウィンドウを離れたら'
  }
}
