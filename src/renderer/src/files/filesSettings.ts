import type { StoredFilesSettings } from '@shared/settings'
import {
  AUTO_LAYOUT_PREFERENCE,
  chooseLayoutMode,
  DEFAULT_FILES_COLUMN_WIDTH,
  FILES_COLUMN_WIDTH_MAX,
  FILES_COLUMN_WIDTH_MIN,
  type FilesLayoutMode,
  type FilesLayoutPreference
} from './filesLayoutMode'

/**
 * Files の見え方の設定モデル（Session 3-6-8）。
 *
 * ## 設定と動作を分ける
 *
 * ここが持つのは「保存形式とどう行き来するか」「境界から来た値をどう読むか」だけで、
 * **いつ保存するかは持たない**（それは FilesViewProvider.tsx）。
 * editor/autoSave.ts とまったく同じ分担で、このファイルは React も IPC も知らない
 * （＝ Vitest でそのまま試せる）。
 *
 * ```
 * filesLayoutMode.ts            表示方式の決め方（提案と選択）
 * filesSettings.ts              その選択とカラムの幅を、保存形式と行き来させる
 * settings/useSettingsSection.ts  いつ読み、いつ書くか（Session 4-3A で3箇所から集約）
 * FilesViewProvider.tsx         見え方の正本（どこがこの値を持つか）
 * shared/settings/sections.ts   ディスクに置く形（`files` section）
 * main/store/settings.ts        保存先（settings.json）
 * ```
 *
 * ## 「選んでいない」も保存する
 *
 * `auto`（パネルの形に任せる）は、選択が無いことではなく**そう決めた状態**として
 * 保存する。保存しないことで表すと、カラムを選んでから auto へ戻したときに
 * 次回の起動で explicit が復活する（消したはずの選択が戻ってくる）。
 *
 * ## 読めなければ既定で始める
 *
 * 保存が無い・壊れている・知らない mode（アプリのダウングレード）は、
 * すべて既定（auto ＋ 208px）へ落ちる。設定が読めないことはアプリを使えない理由に
 * ならない ── これは Auto Save の「読めなければ OFF」と同じ扱いにあたる。
 */

export interface FilesViewSettings {
  /** 表示方式について利用者が選んだこと（filesLayoutMode.ts）。 */
  readonly preference: FilesLayoutPreference
  /** カラム1枚の幅（px）。**列ごとには持たない**（filesLayoutMode.ts）。 */
  readonly columnWidth: number
}

/** 既定。まだ何も選んでいない状態から始まる。 */
export const DEFAULT_FILES_VIEW_SETTINGS: FilesViewSettings = {
  preference: AUTO_LAYOUT_PREFERENCE,
  columnWidth: DEFAULT_FILES_COLUMN_WIDTH
}

/** 保存形式で使う mode の文字列（`auto` は「パネルの形に任せる」）。 */
const AUTO_MODE = 'auto'

function isLayoutMode(value: unknown): value is FilesLayoutMode {
  return value === 'tree' || value === 'columns'
}

/* ------------------------------------------------ 選択肢としての表示方式 */

/**
 * 利用者が選べる3つ（Session 4-3B）。
 *
 * Files のツールバー（FilesExplorer.tsx）は2つのボタンで表していて、
 * 「今出ている方をもう一度押すと `auto` へ戻る」という**押し方**で3つ目を表す。
 * ツールバーは細く、押す頻度が高い場所なので、それでよかった。
 *
 * Settings 画面はそうしない ── **一覧として3つ並べる。** 設定画面に来た人は
 * 「今どれになっているか」を確かめに来ており、押し方でしか表せない状態は
 * 見ただけでは分からない。器が違えば表し方も変わってよいが、**値は1つ**で、
 * どちらから変えても同じ setter（FilesViewProvider の `setPreference`）を通る。
 *
 * `FilesLayoutPreference` をそのまま UI に持たせないのは、あれが判別可能な
 * ユニオンで、ボタンの `value` にも `key` にもできないため。
 */
export type FilesViewChoice = typeof AUTO_MODE | FilesLayoutMode

/** UI に並べる順序（左が既定）。 */
export const FILES_VIEW_CHOICES: readonly FilesViewChoice[] = [AUTO_MODE, 'tree', 'columns']

/** 今の選択を、3つのうちのどれかとして読む。 */
export function toFilesViewChoice(preference: FilesLayoutPreference): FilesViewChoice {
  return preference.kind === 'explicit' ? preference.mode : AUTO_MODE
}

/** 選ばれた1つを、保持する形（`FilesLayoutPreference`）へ。 */
export function fromFilesViewChoice(choice: FilesViewChoice): FilesLayoutPreference {
  return choice === AUTO_MODE ? AUTO_LAYOUT_PREFERENCE : chooseLayoutMode(choice)
}

/** UI に出す名前。 */
export function describeFilesViewChoice(choice: FilesViewChoice): string {
  switch (choice) {
    case AUTO_MODE:
      return 'パネルの形に任せる'

    case 'tree':
      return 'ツリー'

    case 'columns':
      return 'カラム'
  }
}

/* ------------------------------------------------------ 保存形式との変換 */

/**
 * 保存された section から、実行時の設定へ。
 *
 * key ごとに読める形かは Main が確かめており（store/settingsSections.ts）、
 * **読めなかった key はここへ届く時点で無い**。ここが見るのは中身の意味だけで、
 * 分担は Editor 設定（§12.4）と同じ。
 *
 * 落とすのも key ごとに独立している ── mode だけが壊れたファイルから
 * 幅まで捨てない（Session 4-3A）。
 */
export function toFilesViewSettings(stored: StoredFilesSettings): FilesViewSettings {
  return {
    // 知らない mode（`auto` でも `tree` でも `columns` でもない）は既定へ落とす。
    preference: isLayoutMode(stored.viewMode)
      ? chooseLayoutMode(stored.viewMode)
      : AUTO_LAYOUT_PREFERENCE,
    columnWidth: clampColumnWidth(stored.columnWidth)
  }
}

/**
 * 実行時の設定から、保存する section へ。
 *
 * 保存形式を別の型にしてある理由は shared/settings/sections.ts。
 * 変換をこの1箇所に置いておくと、実行時モデルを変えたときに
 * 直すべき場所が必ずここに現れる。
 */
export function toFilesSettingsSection(settings: FilesViewSettings): StoredFilesSettings {
  return {
    viewMode: settings.preference.kind === 'explicit' ? settings.preference.mode : AUTO_MODE,
    columnWidth: clampColumnWidth(settings.columnWidth)
  }
}

/** 同じ設定か（保存を予約するかどうかの判断）。 */
export function isSameFilesViewSettings(a: FilesViewSettings, b: FilesViewSettings): boolean {
  if (a.columnWidth !== b.columnWidth) {
    return false
  }

  if (a.preference.kind !== b.preference.kind) {
    return false
  }

  return (
    a.preference.kind !== 'explicit' ||
    b.preference.kind !== 'explicit' ||
    a.preference.mode === b.preference.mode
  )
}

/* -------------------------------------------------------------- 幅の正規化 */

/**
 * カラムの幅を扱ってよい範囲へ落とす。
 *
 * ドラッグ（FileColumns.tsx）と保存の読み書きの**両方**がここを通る。
 * 片方だけに掛けると、掴んで広げた幅は止まるのに保存ファイルを直接書けば
 * 通ってしまう、という食い違いが生まれる。
 *
 * 端数を丸めるのは、1px 未満の差で保存が走り続けないようにするため
 * （ポインタの座標は小数になりうる）。
 */
export function clampColumnWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_FILES_COLUMN_WIDTH
  }

  return Math.min(Math.max(Math.round(value), FILES_COLUMN_WIDTH_MIN), FILES_COLUMN_WIDTH_MAX)
}
