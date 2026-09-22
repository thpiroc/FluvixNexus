import { join } from 'path'
import type { SettingsDocument, SettingsSectionUpdate, SettingsSections } from '@shared/settings'
import { createJsonFileWriter, readJsonFile, writeJsonFile } from './jsonFile'
import {
  LEGACY_SETTINGS_FILE_NAMES,
  migrateLegacySettings,
  type LegacySettingsSectionId
} from './legacySettings'
import {
  defaultSettingsDocument,
  parseSettingsDocument,
  toStoredSettings,
  withSettingsSection
} from './settingsDocument'

/**
 * `settings.json` の読み書き（Session 4-3A）。
 *
 * 保存先のフォルダを引数で受け取るのは、**実際のディスクを使って試せるように**
 * するため（`app.getPath('userData')` を直に見ると Electron に縛られ、
 * Vitest から読み込めなくなる）。userData を渡すのは store/settings.ts の役目で、
 * ここは「渡されたフォルダの中の settings.json」しか知らない。
 *
 * ## 読むのは1度だけ
 *
 * 読み込んだ文書はメモリに残す。設定は起動時に1度読むだけのもので、
 * 2度目からは同じ答えを返す ── **移行（旧3ファイルの取り込み）を
 * 繰り返さない**ためでもある。
 *
 * ## 保存は section 単位で、他を巻き込まない
 *
 * `saveSection` はメモリ上の文書の section を1つ差し替えてから、
 * 文書全体を書き直す。ファイルが1つになった以上、書くときは必ず全体になるが、
 * **差し替わるのは指定された section だけ**で、他の section も
 * 知らない内容（`preserved`）もそのまま残る。
 *
 * ## `settings.json` が無いときだけ、旧3ファイルを読む
 *
 * 旧ファイルからの取り込みは「まだ `settings.json` が無い」場合に限る。
 * 壊れている場合は取り込まない ── 壊れているのは**この形式のファイルが
 * 既にある**ということで、そこへ旧ファイルの内容を混ぜると、
 * 利用者が最後に選んだ設定より古いものが復活しうる。
 *
 * 取り込めたものがあれば、その場で1度だけ書く（間引きを待たない）。
 * 次の起動では `settings.json` が見つかり、旧ファイルは二度と読まれない。
 * **旧ファイルは消さない**（戻れる道を残す。legacySettings.ts）。
 */

export const SETTINGS_FILE_NAME = 'settings.json'

export interface SettingsStore {
  /** 保存済みの設定。初回の呼び出しで読み込む（必要なら旧ファイルから取り込む）。 */
  read(): SettingsSections
  /** 1つの section を保存する。連続呼び出しは間引かれる。 */
  saveSection(update: SettingsSectionUpdate): void
  /** 予約済みの書き込みを即座に反映する。 */
  flush(): void
}

/** 読み込み中に落としたもの・移行したものの知らせ（ログの言い回しは呼ぶ側が持つ）。 */
export type SettingsStoreReporter = (message: string, ...details: readonly unknown[]) => void

export interface SettingsStoreOptions {
  readonly onIssue?: SettingsStoreReporter
}

export function createSettingsStore(
  directory: string,
  options: SettingsStoreOptions = {}
): SettingsStore {
  const filePath = join(directory, SETTINGS_FILE_NAME)
  const report = options.onIssue ?? ((): void => {})

  const writer = createJsonFileWriter(filePath, (cause) => {
    // 保存に失敗してもアプリの動作は継続する。次回起動時に既定へ戻るだけで済むため。
    report(`failed to write "${SETTINGS_FILE_NAME}".`, cause)
  })

  let document: SettingsDocument | null = null

  function load(): SettingsDocument {
    const found = readJsonFile(filePath)

    if (found.kind === 'present') {
      const parsed = parseSettingsDocument(found.raw)

      for (const issue of parsed.issues) {
        report(`"${SETTINGS_FILE_NAME}": ${issue}`)
      }

      /*
        撤去した key が残っていたら、その場で1度だけ書き直す（間引きを待たない）。
        読んだ文書はもうそれを持たないので、書けば次の起動からは見つからない
        ── 利用者が何も保存しなくても、使われない設定がファイルに残り続けない。
        書けなければ次の起動でもう一度試す。
      */
      if (parsed.hasRetiredFields) {
        const written = writeJsonFile(filePath, toStoredSettings(parsed.document))

        if (!written.ok) {
          report(`failed to remove retired settings from "${SETTINGS_FILE_NAME}".`, written.cause)
        }
      }

      return parsed.document
    }

    if (found.kind === 'unreadable') {
      report(`failed to read "${SETTINGS_FILE_NAME}"; falling back to defaults.`, found.cause)
      return defaultSettingsDocument()
    }

    return loadFromLegacyFiles()
  }

  /** `settings.json` がまだ無い場合だけ通る道。 */
  function loadFromLegacyFiles(): SettingsDocument {
    const migration = migrateLegacySettings({
      editor: readLegacy('editor'),
      files: readLegacy('files'),
      terminal: readLegacy('terminal')
    })

    if (migration.migrated.length === 0) {
      // 初回起動。移すものが無いので何も書かない（中身の無いファイルを作らない）。
      return defaultSettingsDocument()
    }

    const migrated: SettingsDocument = {
      ...defaultSettingsDocument(),
      sections: migration.sections
    }

    /*
      間引きを待たずにここで書く。読み込みの直後に落ちても移行が済んでいるように
      するためで、**移行が起きるのは一度きり**という前提はこの書き込みが支えている。
    */
    const written = writeJsonFile(filePath, toStoredSettings(migrated))

    if (written.ok) {
      report(
        `migrated legacy settings (${migration.migrated.join(', ')}) into "${SETTINGS_FILE_NAME}".`
      )
    } else {
      // 書けなくても設定は使える（次の保存でもう一度書かれる）。
      report(`failed to write migrated settings to "${SETTINGS_FILE_NAME}".`, written.cause)
    }

    return migrated
  }

  function readLegacy(section: LegacySettingsSectionId): unknown {
    const fileName = LEGACY_SETTINGS_FILE_NAMES[section]
    const found = readJsonFile(join(directory, fileName))

    if (found.kind === 'present') {
      return found.raw
    }

    // 壊れていても他の2つは移す（legacySettings.ts）。無いのは正常。
    if (found.kind === 'unreadable') {
      report(`failed to read "${fileName}" while migrating; that section starts from defaults.`)
    }

    return undefined
  }

  function current(): SettingsDocument {
    document ??= load()
    return document
  }

  return {
    read(): SettingsSections {
      return current().sections
    },

    saveSection(update: SettingsSectionUpdate): void {
      const next = withSettingsSection(current(), update)
      document = next
      writer.save(toStoredSettings(next))
    },

    flush(): void {
      writer.flush()
    }
  }
}
