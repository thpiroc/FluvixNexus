import type { StoredAppearanceSettings } from '@shared/settings'
import type { SettingsSectionBinding, SettingsValueUpdate } from '../settings/settingsBinding'
import { DEFAULT_THEME_ID, normalizeThemeId, THEME_IDS, type ThemeId } from '@shared/theme'

/**
 * Appearance（Theme）の設定モデル（Session 4-4）。
 *
 * ## 分担は既存の3つと同じ
 *
 * ここが持つのは「保存形式とどう行き来するか」「境界から来た値をどう読むか」だけで、
 * **いつ保存するかは持たない**（それは settings/useSettingsSection.ts）。
 * editor/autoSave.ts・files/filesSettings.ts・terminal/terminalSettings.ts と
 * まったく同じ形にしてあり、このファイルは React も CSS も IPC も知らない。
 *
 * ```
 * shared/theme/theme.ts       名前が2つあること・既定・読めない値の落とし先
 * appearanceSettings.ts       その値を、保存形式と行き来させる（ここ）
 * useAppearance.ts            Theme の正本（どこがこの値を持つか）
 * ThemeProvider.tsx           <html> へ当て、Renderer 全体へ配る
 * themeTokens.ts              CSS 変数から Monaco / xterm の色を作る
 * styles/theme.css            色の実体
 * settings/useSettingsSection.ts  いつ読み、いつ書くか
 * shared/settings/sections.ts     ディスクに置く形（`appearance` section）
 * ```
 *
 * ## 読めなければ Dark で始める
 *
 * 保存が無い・壊れている・知らない名前（アプリのダウングレードや、ファイルを
 * 手で直した場合）は、すべて Dark へ落ちる。Auto Save の「読めなければ OFF」、
 * Files の「読めなければパネルの形に任せる」と同じ扱いにあたる ──
 * **設定が読めないことは、アプリの見た目が決まらない理由にならない。**
 *
 * 落とし先の判断そのものは `normalizeThemeId`（shared）が持つ。Main が
 * 最初の1枚を塗るときも、Preload が引数を読むときも同じ関数を通るので、
 * **「起動直後の色と、読み込み後の色が食い違う」経路が無い。**
 */

export interface AppearanceSettings {
  /** 今の Theme。`dark` / `light` のどちらか（知らない値はここまで来ない）。 */
  readonly theme: ThemeId
}

/** 既定。保存が無い / 読めないときはここから始まる。 */
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = { theme: DEFAULT_THEME_ID }

/** Settings 画面に並べる順（Dark → Light）。 */
export const APPEARANCE_THEME_CHOICES: readonly ThemeId[] = THEME_IDS

/** 画面に出す名前。**言葉は Renderer だけが持つ**（shared は名前と既定だけ）。 */
export function describeTheme(theme: ThemeId): string {
  switch (theme) {
    case 'light':
      return 'ライト'

    case 'dark':
    default:
      return 'ダーク'
  }
}

/* ------------------------------------------------------ 保存形式との変換 */

/**
 * 保存された section から、実行時の設定へ。
 *
 * key が読める形かは Main が確かめており（store/settingsSections.ts ── 文字列か
 * どうかまで）、**読めなかった key はここへ届く時点で無い**。ここが見るのは
 * 名前として意味があるかだけで、分担は Editor 設定（§12.4）・Files 設定（§10.14）・
 * Terminal 設定（§13.4）と同じ。
 */
export function toAppearanceSettings(stored: StoredAppearanceSettings): AppearanceSettings {
  return { theme: normalizeThemeId(stored.theme) }
}

/**
 * 実行時の設定から、保存する section へ。
 *
 * 書く前にも落とすのは、**知らない名前をディスクへ残さない**ため
 * （読むときだけ落とすと、次に読む側が必ずいることを当てにすることになる）。
 */
export function toAppearanceSection(settings: AppearanceSettings): StoredAppearanceSettings {
  return { theme: normalizeThemeId(settings.theme) }
}

/** 同じ設定か（保存を予約するかどうかの判断）。 */
export function isSameAppearanceSettings(a: AppearanceSettings, b: AppearanceSettings): boolean {
  return a.theme === b.theme
}

/* ------------------------------------------ 設定との行き来（feature/settings-scope） */

/**
 * `appearance` section と Theme の行き来。
 *
 * `initial` は既定（Dark）にしてある。アプリ本体（useAppearance.ts）は読み込み前の値を
 * Preload が当てた Theme に差し替えて使う ── 塗り直しで一瞬色が変わらないように。
 */
export const APPEARANCE_SETTINGS_BINDING: SettingsSectionBinding<'appearance', AppearanceSettings> =
  {
    section: 'appearance',
    initial: DEFAULT_APPEARANCE_SETTINGS,
    fromStored: toAppearanceSettings,
    toStored: toAppearanceSection
  }

/**
 * Theme を変える操作（知らない名前は既定へ落ちる）。
 *
 * 同じなら据え置く。既に選ばれている方をもう一度押したときに、保存と
 * 再描画（＝ Monaco と全部の端末への当て直し）が走らないようにするため。
 */
export function createAppearanceSetters(update: SettingsValueUpdate<AppearanceSettings>): {
  readonly setTheme: (theme: ThemeId) => void
} {
  return {
    setTheme: (theme) =>
      update((previous) => {
        const next = toAppearanceSettings({ theme })

        return isSameAppearanceSettings(previous, next) ? previous : next
      })
  }
}
