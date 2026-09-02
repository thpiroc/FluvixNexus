import type { SettingsSectionId, SettingsSections } from './sections'

/**
 * アプリ設定の保存文書（Session 4-3A）。
 *
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "sections": {
 *     "editor":   { "autoSaveMode": "afterDelay", "autoSaveDelayMs": 1000 },
 *     "files":    { "viewMode": "columns", "columnWidth": 240 },
 *     "terminal": { "fontSize": 15, "scrollback": 5000 }
 *   }
 * }
 * ```
 *
 * 保存先は `%APPDATA%/Fluvix Nexus/settings.json`（app.getPath('userData') 配下）。
 * ウィンドウ状態・レイアウト・Workspace と同じ場所で、**プロジェクトフォルダの中には
 * 何も書かない** ── 設定はその人の道具の形であって、プロジェクトの持ち物ではない。
 *
 * **Renderer は保存先を知らない。** パスもファイル名も指定できず、渡せるのは
 * 「どの section を、どんな値にするか」だけ（shared/ipc/contracts/settings.ts）。
 *
 * ## 3層の分担
 *
 * | 層       | 見るもの                                                       |
 * | -------- | -------------------------------------------------------------- |
 * | shared   | ディスクに置く形（この型）                                     |
 * | Main     | 後で解釈できる形か（version・section・key ごとの型）           |
 * | Renderer | 値として意味があるか（mode の名前・上下限）                    |
 *
 * Session 3-5 からの分担をそのまま引き継いでいる。**Main は中身の意味を解釈しない** ──
 * 二重に解釈すると「どちらの判断が正しいか」が生まれる。
 *
 * ## 壊れていても、壊れたところだけを捨てる
 *
 * 旧形式の parse は all-or-nothing で、`delayMs` が1つ壊れているだけで
 * Editor の設定が丸ごと既定へ戻っていた。新しい形では落とす単位を段階にしてある。
 *
 * | 壊れている場所         | 失われるもの         |
 * | ---------------------- | -------------------- |
 * | 文書全体（JSON でない） | すべて（既定で始まる） |
 * | schemaVersion          | すべて               |
 * | sections               | すべて               |
 * | 1つの section          | その section だけ    |
 * | 1つの key              | その key だけ        |
 *
 * ## 知らないものは書き戻す
 *
 * 知らない section・知らない key・文書直下の知らない項目は、**捨てずにそのまま
 * 持ち回して書き戻す**（`preserved`）。新しい版で設定を増やした後に古い版で
 * 一度起動しただけで、増やした設定が消えるのを避けるため。
 * 逆に **Renderer から届いた知らない key は保存しない** ── ディスクにある未知の値は
 * 「新しい版が書いたもの」でありうるが、Renderer から届く未知の値は
 * 契約に無い値でしかない（ARCHITECTURE.md §5）。
 */

/**
 * 現在の版。
 *
 * **上げるのは構造を変えるときだけ**にする（section の名前を変える、
 * 入れ子の形を変える、など）。key を足す・意味の変わらない key を消す、といった
 * 変更では上げない ── 知らない key は読む側が落とし、知らない key は書き戻されるため、
 * それだけで前後の版が同じファイルを読める。
 *
 * この約束の裏返しとして、**既にある key の意味は版をまたいで変えない。**
 * 変えたくなったら新しい key 名にする。これが成り立っている限り、
 * 新しい版が書いたファイルを古い版が読んでも取り違えが起きない（`future` の扱い）。
 */
export const SETTINGS_SCHEMA_VERSION = 1

/**
 * 保存文書の上限（バイト）。
 *
 * 既知の設定は数百バイトにしかならない。これを超えるのは、知らない section を
 * 抱えすぎているか、想定外の書き込みが起きた場合しかない ── 超えた場合は
 * **既知の設定だけを読み、知らない内容は書き戻さない**（main/store/settingsDocument.ts）。
 * 文書ごと捨てないのは、それが利用者の設定を失う一番大きな捨て方だから。
 */
export const SETTINGS_DOCUMENT_MAX_BYTES = 64 * 1024

/**
 * 書き戻すために持ち回す、知らない内容1つあたりの上限（バイト）。
 *
 * 「知らないものは書き戻す」は将来の版のためのものであって、
 * 大きな内容の置き場所ではない。超えるものは持ち回さない。
 */
export const SETTINGS_PRESERVED_MAX_BYTES = 4 * 1024

/**
 * 文字列の値の上限（文字数）。
 *
 * mode の名前は十数文字にしかならない。超える文字列は key ごと落とす
 * （文書を捨てずに済む一番小さな捨て方）。
 */
export const SETTINGS_TEXT_MAX_LENGTH = 256

/**
 * この版が知らない内容。読んだ形のまま持ち回し、保存時にそのまま書き戻す。
 *
 * 中身は**一度も解釈しない**（Main も Renderer も読まない）。ここに入るのは
 * 将来の版が書いた内容か、人が手で足した内容のどちらかで、どちらも
 * この版が意味を決めてよいものではない。
 */
export interface PreservedSettings {
  /** 文書の直下にあった、知らない項目（`schemaVersion` / `sections` 以外）。 */
  readonly document: Readonly<Record<string, unknown>>
  /** `sections` の直下にあった、知らない section。 */
  readonly sections: Readonly<Record<string, unknown>>
  /** 既知の section の中にあった、知らない key。 */
  readonly fields: Readonly<Record<SettingsSectionId, Readonly<Record<string, unknown>>>>
}

/**
 * 読み込み済みの設定（Main のメモリ上の形）。
 *
 * これは**ディスクの形そのものではない** ── 書くときは
 * `toStoredSettings`（main/store/settingsDocument.ts）が組み立て直す。
 */
export interface SettingsDocument {
  /**
   * 読み込んだファイルが名乗っていた版。
   *
   * **書き戻す版ではない**（書くときは常に `SETTINGS_SCHEMA_VERSION`）。
   * 新しい版のファイルを読んだことを記録として残しておくためのもので、
   * 保存が無い場合は現在の版になる。
   */
  readonly sourceVersion: number
  readonly sections: SettingsSections
  readonly preserved: PreservedSettings
}

/**
 * 読み込んだファイルの版が、この版から見てどれにあたるか。
 *
 * 「正の整数なら受け入れる」だけでは、`schemaVersion: 99` のファイルを
 * 現在の形として読んでしまう。区別しておけば、
 *
 *   - `current`  … そのまま読む
 *   - `outdated` … migration を通してから読む（settingsMigration.ts）
 *   - `future`   … 既知の key だけを読み、知らない内容は書き戻す
 *   - `invalid`  … 版として読めない。既定で始める
 *
 * という分岐を、読む側が取り違えずに書ける。
 */
export type SettingsSchemaVersion =
  | { readonly kind: 'current' }
  | { readonly kind: 'outdated'; readonly version: number }
  | { readonly kind: 'future'; readonly version: number }
  | { readonly kind: 'invalid' }

/** 素の値を版として読む。 */
export function classifySettingsSchemaVersion(value: unknown): SettingsSchemaVersion {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { kind: 'invalid' }
  }

  if (value === SETTINGS_SCHEMA_VERSION) {
    return { kind: 'current' }
  }

  return value < SETTINGS_SCHEMA_VERSION
    ? { kind: 'outdated', version: value }
    : { kind: 'future', version: value }
}
