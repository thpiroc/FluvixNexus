import type { SettingsSectionId, SettingsSections } from '@shared/settings'

/**
 * 「設定 section 1つを、実行時の値とどう行き来させるか」の約束（React 非依存）。
 *
 * Session 4-3A から `useSettingsSection` に渡していた形そのもので、
 * feature/settings-scope でここへ切り出した。**同じ binding を2つの読み方で使う**ため。
 *
 *   各機能（Editor / Files / Terminal …）… 実際に効く値（`ワークスペース > ユーザー > 既定`）
 *   Settings 画面                         … 今編集している scope から見た値
 *
 * 既定値・値の意味・上下限は、今までどおり機能の側（editor/autoSave.ts など）が持つ。
 */
export interface SettingsSectionBinding<Id extends SettingsSectionId, T> {
  /** どの section を読み書きするか。 */
  readonly section: Id
  /** 読み込みが終わる前の値。 */
  readonly initial: T
  /** 保存された section から、実行時の値へ（無い key は既定へ落とすこと）。 */
  readonly fromStored: (stored: SettingsSections[Id]) => T
  /** 実行時の値から、保存する section へ。 */
  readonly toStored: (value: T) => SettingsSections[Id]
}

/**
 * 直前の値から次の値を作って渡す。
 *
 * 「同じなら据え置く」（前の値をそのまま返す）判断は呼ぶ側が持つ ──
 * 何をもって同じとするかは値の意味を知っている側にしか決められず、
 * ここで済ませると保存と再描画が走り続ける経路ができる。
 */
export type SettingsValueUpdate<T> = (change: (previous: T) => T) => void
