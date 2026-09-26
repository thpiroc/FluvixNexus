import {
  classifySettingsSchemaVersion,
  emptySettingsSections,
  SETTINGS_DOCUMENT_MAX_BYTES,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_SECTION_IDS,
  type PreservedSettings,
  type SettingsDocument,
  type SettingsSections,
  type SettingsSectionUpdate
} from '@shared/settings'
import { migrateStoredSettings } from './settingsMigration'
import {
  failClosedSettingsSections,
  isPlainObject,
  parseStoredSection,
  preservableEntries
} from './settingsSections'

/**
 * 設定文書の検証と組み立て（Electron にも fs にも依存しない。Session 4-3A）。
 *
 * ## 失敗しない
 *
 * `parseSettingsDocument` は null を返さない。**読めなかったところだけが空になる**
 * だけで、文書としては必ず成立する ── 設定が読めないことはアプリを使えない理由に
 * ならず、「どこまで読めたか」は `issues` に残す（呼ぶ側がログに出す）。
 *
 * 落とす単位は shared/settings/settingsDocument.ts の表のとおりで、
 * 一番大きな捨て方（文書ごと）は「JSON として読めない」「版が読めない」
 * 「sections が無い」の3つに限る。
 *
 * ## 知らないものは書き戻す
 *
 * 知らない section・知らない key・文書直下の知らない項目は `preserved` に持ち、
 * `toStoredSettings` がそのまま書き戻す。新しい版で足した設定が、
 * 古い版で一度起動しただけで消えるのを避けるため。
 *
 * ただし文書が上限を超えている場合は持ち回さない（既知の設定だけを読む）──
 * 書き戻しは将来の版のためのもので、大きな内容の置き場所ではない。
 */

export interface ParsedSettingsDocument {
  readonly document: SettingsDocument
  /** 既定へ落とした場所（ログ用。空なら全部そのまま読めた）。 */
  readonly issues: readonly string[]
  /**
   * 撤去した key（settingsSections.ts の `RETIRED_SECTION_FIELDS`）がファイルに残っていたか。
   * 真なら、読んだ文書はもうそれを持たないので、書き直せばファイルからも消える。
   */
  readonly hasRetiredFields: boolean
}

/** 何も保存されていない状態の文書。 */
export function defaultSettingsDocument(): SettingsDocument {
  return {
    sourceVersion: SETTINGS_SCHEMA_VERSION,
    sections: emptySettingsSections(),
    preserved: emptyPreservedSettings()
  }
}

/**
 * 読めなかった文書の代わり（Security Core v1）。
 *
 * 中身は `defaultSettingsDocument` と同じく空だが、**Security を緩める側へ倒れない
 * 値だけは入っている**（settingsSections.ts の `FAIL_CLOSED_SECTION_VALUES`）──
 * `read` を選んでいた人の設定ファイルが壊れただけで、既定の `ask` へ戻らないように。
 * ファイルが「無い」ときは使わない（そちらは `defaultSettingsDocument`）。
 */
export function failClosedSettingsDocument(): SettingsDocument {
  return { ...defaultSettingsDocument(), sections: failClosedSettingsSections() }
}

function emptyPreservedSettings(): PreservedSettings {
  return {
    document: {},
    sections: {},
    fields: {
      general: {},
      appearance: {},
      editor: {},
      lsp: {},
      files: {},
      terminal: {},
      mcp: {},
      aiProvider: {},
      security: {}
    }
  }
}

/** 素の値を設定文書として読む。読めなかったところは空になる（null は返さない）。 */
export function parseSettingsDocument(raw: unknown): ParsedSettingsDocument {
  if (!isPlainObject(raw)) {
    return {
      document: failClosedSettingsDocument(),
      issues: ['document is not an object'],
      hasRetiredFields: false
    }
  }

  const version = classifySettingsSchemaVersion(raw.schemaVersion)
  const issues: string[] = []

  if (version.kind === 'invalid') {
    return {
      document: failClosedSettingsDocument(),
      issues: ['schemaVersion is not readable'],
      hasRetiredFields: false
    }
  }

  let source = raw
  let sourceVersion = SETTINGS_SCHEMA_VERSION

  if (version.kind === 'outdated') {
    const migrated = migrateStoredSettings(raw, version.version)

    if (migrated === null) {
      return {
        document: failClosedSettingsDocument(),
        issues: [`no migration from schemaVersion ${version.version}`],
        hasRetiredFields: false
      }
    }

    source = migrated
    sourceVersion = version.version
    issues.push(`migrated from schemaVersion ${version.version}`)
  }

  if (version.kind === 'future') {
    /*
      この版より新しいファイル。既知の key の意味は版をまたいで変えない約束
      （shared/settings/settingsDocument.ts）なので、読める分だけ読む。
      知らない内容は `preserved` に入り、書き戻される ── **ダウングレードで
      新しい版の設定を消さない**ための道はここにしかない。
    */
    sourceVersion = version.version
    issues.push(`schemaVersion ${version.version} is newer than ${SETTINGS_SCHEMA_VERSION}`)
  }

  /*
    知らない内容を持ち回すかどうかは、文書全体の大きさで決める。
    桁違いに大きなファイルをそのまま書き戻し続ける状態を作らない。
  */
  const preservable = isWithinSizeLimit(source)

  if (!preservable) {
    issues.push('document exceeds the size limit; unknown contents are not kept')
  }

  const rawSections = source.sections

  if (!isPlainObject(rawSections)) {
    return {
      document: {
        sourceVersion,
        sections: failClosedSettingsSections(),
        preserved: emptyPreservedSettings()
      },
      issues: [...issues, 'sections is not an object'],
      hasRetiredFields: false
    }
  }

  const sections: Record<string, unknown> = {}
  const fields: Record<string, Record<string, unknown>> = {}
  let hasRetiredFields = false

  for (const id of SETTINGS_SECTION_IDS) {
    const parsed = parseStoredSection(id, rawSections[id])

    sections[id] = parsed.value
    fields[id] = preservable ? parsed.unknownFields : {}

    // 「無い」は正常（未保存の section）。読めなかった場合だけ記録する。
    if (!parsed.readable && rawSections[id] !== undefined) {
      issues.push(`section "${id}" is not an object`)
    }

    for (const name of parsed.droppedFields) {
      issues.push(`dropped "${id}.${name}"`)
    }

    for (const name of parsed.retiredFields) {
      hasRetiredFields = true
      issues.push(`removed retired "${id}.${name}"`)
    }
  }

  return {
    document: {
      sourceVersion,
      sections: sections as unknown as SettingsSections,
      preserved: {
        document: preservable ? preservableEntries(source, ['schemaVersion', 'sections']) : {},
        sections: preservable ? preservableEntries(rawSections, [...SETTINGS_SECTION_IDS]) : {},
        fields: fields as PreservedSettings['fields']
      }
    },
    issues,
    hasRetiredFields
  }
}

/**
 * 1つの section を差し替えた文書を作る。
 *
 * **他の section には触れない。** Terminal の文字を大きくしただけで
 * Editor の設定を書き直す形にすると、片方の保存の失敗がもう片方を巻き込む。
 * 知らない key（`preserved.fields`）もそのまま残る ── 保存要求に無いのは
 * 「この版が知らないから」であって、消してよいという意味ではない。
 */
export function withSettingsSection(
  document: SettingsDocument,
  update: SettingsSectionUpdate
): SettingsDocument {
  return {
    ...document,
    sections: { ...document.sections, [update.section]: update.value }
  }
}

/**
 * ディスクへ書く形へ組み立てる。
 *
 * 版は**常に現在の版**を書く。新しい版のファイルを読んでいた場合でも、
 * 書いた内容はこの版が作ったものであり、名乗るべき版もこの版になる
 * （新しい版が持っていた内容は `preserved` として残っている）。
 */
export function toStoredSettings(document: SettingsDocument): Record<string, unknown> {
  const sections: Record<string, unknown> = { ...document.preserved.sections }

  for (const id of SETTINGS_SECTION_IDS) {
    sections[id] = { ...document.preserved.fields[id], ...document.sections[id] }
  }

  return {
    ...document.preserved.document,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    sections
  }
}

function isWithinSizeLimit(value: unknown): boolean {
  try {
    const text = JSON.stringify(value)
    return text !== undefined && text.length <= SETTINGS_DOCUMENT_MAX_BYTES
  } catch {
    // 循環参照など。文書として書けない時点で持ち回さない。
    return false
  }
}
