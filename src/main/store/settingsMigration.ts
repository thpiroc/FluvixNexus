import { SETTINGS_SCHEMA_VERSION } from '@shared/settings'

/**
 * 古い `schemaVersion` の設定文書を、現在の版の形へ持ち上げる入口（Session 4-3A）。
 *
 * **まだ1段も無い。** 現在の版が 1 で、それより古い版が存在しないため
 * （旧 `editor-settings.json` などからの移行は版の話ではなく、
 * 別ファイルからの取り込みにあたる。store/legacySettings.ts）。
 *
 * それでも入口を先に作ってあるのは、**無いと後から差し込む場所が決まらない**ため。
 * `schemaVersion` を「正の整数なら受け入れる」だけにしておくと、版を上げた日に
 * 「古いファイルをどこで直すか」を読み込みの途中で決めることになり、
 * 検証と変換が混ざる。
 *
 * ## 足すときの形
 *
 * `SETTINGS_MIGRATIONS[n]` は「版 n の文書を版 n+1 の形にする」1段。
 * 版を上げるときは
 *
 *   1. `SETTINGS_SCHEMA_VERSION` を上げる（shared/settings/settingsDocument.ts）
 *   2. ここに1段足す
 *
 * の2つだけで閉じる。段が1つでも欠けていれば移行は成立しないので、その場合は
 * null を返し、読む側は既定で始める（**壊れた形のまま読み進めない**）。
 *
 * 段は「素の JSON から素の JSON へ」で書く ── 型を持たせても、それは
 * 「その時代の型」であって、今の型ではないため。
 */

export type SettingsMigrationStep = (raw: Record<string, unknown>) => Record<string, unknown> | null

/** 版 n → n+1 の変換。**現在は空**（上のコメント）。 */
export const SETTINGS_MIGRATIONS: Readonly<Record<number, SettingsMigrationStep>> = {}

/**
 * 段と、持ち上げる先の版。
 *
 * **差し替えられるのはテストのため。** 現在の版が 1 で古い版が存在しない今、
 * 段を1つも持たないこの入口が本当に働くかは、注入しないと確かめられない
 * （**動かない入口を「ある」ことにしない**）。実際の呼び出しでは何も渡さない。
 */
export interface SettingsMigrationOptions {
  readonly steps?: Readonly<Record<number, SettingsMigrationStep>>
  readonly currentVersion?: number
}

/**
 * 古い版の文書を現在の版まで持ち上げる。
 *
 * 途中の段が無い / 段が失敗した場合は null（既定で始まる）。
 */
export function migrateStoredSettings(
  raw: Record<string, unknown>,
  fromVersion: number,
  options: SettingsMigrationOptions = {}
): Record<string, unknown> | null {
  const steps = options.steps ?? SETTINGS_MIGRATIONS
  const currentVersion = options.currentVersion ?? SETTINGS_SCHEMA_VERSION

  if (!Number.isInteger(fromVersion) || fromVersion < 1 || fromVersion > currentVersion) {
    return null
  }

  let current = raw

  for (let version = fromVersion; version < currentVersion; version += 1) {
    const step = steps[version]

    if (step === undefined) {
      return null
    }

    const next = step(current)

    if (next === null) {
      return null
    }

    current = next
  }

  return current
}
