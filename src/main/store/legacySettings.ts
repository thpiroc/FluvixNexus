import {
  emptySettingsSections,
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
  type SettingsSections,
  type StoredEditorSettings,
  type StoredFilesSettings,
  type StoredTerminalSettings
} from '@shared/settings'
import { isPlainObject } from './settingsSections'

/**
 * 旧 `<用途>-settings.json` から `settings.json` への取り込み（Session 4-3A）。
 *
 * Session 3-5 〜 3-7-5 の間、設定は3つのファイルに分かれていた。
 *
 * | 旧ファイル                | 旧形式                                        | 移す先                                |
 * | ------------------------- | --------------------------------------------- | ------------------------------------- |
 * | `editor-settings.json`    | `{ autoSave: { mode, delayMs } }`             | `editor.autoSaveMode` / `autoSaveDelayMs` |
 * | `files-settings.json`     | `{ view: { mode, columnWidth } }`             | `files.viewMode` / `columnWidth`      |
 * | `terminal-settings.json`  | `{ display: { fontSize, scrollback } }`       | `terminal.fontSize` / `scrollback`    |
 *
 * ## 版の移行ではない
 *
 * `schemaVersion` の移行（settingsMigration.ts）とは別の話にしてある。あちらは
 * 「同じファイルの、古い形」で、こちらは「**別のファイル**」── 混ぜると、
 * `settings.json` の版を上げるたびに旧3ファイルの話が付いて回ることになる。
 *
 * ここが見るのは中身の形だけで、旧ファイルの `schemaVersion` は見ない。
 * 版が何であれ、読める key を読める形で持っていれば取り込む価値があり、
 * **取り込めなかった key は「無い」＝既定になる**（読む側が落とす形と同じ）。
 *
 * ## 1つ壊れていても、他は移す
 *
 * 3つは元々「別々のファイル・別々の検証」で、片方の失敗がもう片方を巻き込まない
 * ことが利点だった。取り込みでもその性質は保つ ── `files-settings.json` が
 * 壊れていても Editor と Terminal の設定は移る。key 単位でも同じで、
 * `mode` だけが壊れていれば `columnWidth` は移る。
 *
 * ## 旧ファイルは消さない
 *
 * 取り込んでも削除しない。**戻れる道を残す**ためにほかならない ── 取り込みに
 * 不具合があった場合や、古い版へ戻したくなった場合、旧ファイルがそのまま残って
 * いれば元の状態から始められる。`settings.json` ができた後は旧ファイルを
 * 二度と読まないので、残っていても動作には関わらない
 * （store/settingsStore.ts が「`settings.json` が無いときだけ」読む）。
 */

/**
 * 旧ファイルを持っていた section。
 *
 * **`SettingsSectionId` そのものではない。** 旧ファイルは Session 3-5 〜 3-7-5 に
 * 存在した3つで確定していて、後から section を足してもこの集合は増えない
 * （Session 4-4 の `appearance` に対応する `appearance-settings.json` は
 * 世の中に1つも無い）。同じ集合にしておくと、section を足すたびに
 * **存在しない旧ファイルの名前を決めさせられる**ことになる。
 */
export type LegacySettingsSectionId = Extract<SettingsSectionId, 'editor' | 'files' | 'terminal'>

/** 旧ファイル名（旧 section ごとに1つ）。 */
export const LEGACY_SETTINGS_FILE_NAMES: Readonly<Record<LegacySettingsSectionId, string>> = {
  editor: 'editor-settings.json',
  files: 'files-settings.json',
  terminal: 'terminal-settings.json'
}

/** 旧ファイルの中身（読めなかったものは undefined）。 */
export type LegacySettingsSources = Partial<Record<LegacySettingsSectionId, unknown>>

export interface LegacySettingsMigration {
  readonly sections: SettingsSections
  /** 実際に何か移せた section（何も無ければ空 ＝ 移行するものが無い）。 */
  readonly migrated: readonly SettingsSectionId[]
}

/**
 * 旧ファイルの中身から、新しい section を組み立てる。
 *
 * 移せた key が1つも無い section は空のまま（＝既定）で、`migrated` にも入らない。
 * 呼ぶ側は `migrated` が空なら**何も書かない** ── 初回起動で
 * 既定だけの `settings.json` を作っても、残るのは中身の無いファイルだけになる。
 */
export function migrateLegacySettings(sources: LegacySettingsSources): LegacySettingsMigration {
  const autoSave = readLegacyGroup(sources.editor, 'autoSave')
  const view = readLegacyGroup(sources.files, 'view')
  const display = readLegacyGroup(sources.terminal, 'display')

  const editor: StoredEditorSettings = {
    autoSaveMode: readText(autoSave.mode),
    autoSaveDelayMs: readNumber(autoSave.delayMs)
  }

  const files: StoredFilesSettings = {
    viewMode: readText(view.mode),
    columnWidth: readNumber(view.columnWidth)
  }

  const terminal: StoredTerminalSettings = {
    fontSize: readNumber(display.fontSize),
    scrollback: readNumber(display.scrollback)
  }

  /*
    旧ファイルを持たない section（Session 4-4 の `appearance` 以降）は空のまま。
    `emptySettingsSections()` から始めるのは、section を足したときに
    **ここへ足し忘れても型が通らない**形を保つため。
  */
  const sections: SettingsSections = {
    ...emptySettingsSections(),
    editor: withoutMissing(editor),
    files: withoutMissing(files),
    terminal: withoutMissing(terminal)
  }

  const migrated = SETTINGS_SECTION_IDS.filter((id) => Object.keys(sections[id]).length > 0)

  return { sections, migrated }
}

/**
 * 移せなかった key を落とす。
 *
 * `undefined` の key を残すと、`Object.keys` では「移した」ように見え、
 * JSON にも出ないという食い違いになる。**無いものは持たない。**
 */
function withoutMissing<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, found]) => found !== undefined)) as T
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 旧文書の中の入れ子（`autoSave` / `view` / `display`）を取り出す。
 *
 * 旧形式は入れ子で、そこが object でなければ**その section だけ**が移せない。
 * 新しい形を平らにしてあるのは、まさにこの「1つ壊れると中身が全部消える」形を
 * やめるため（shared/settings/sections.ts）。
 */
function readLegacyGroup(raw: unknown, groupName: string): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    return {}
  }

  const group = raw[groupName]

  return isPlainObject(group) ? group : {}
}
