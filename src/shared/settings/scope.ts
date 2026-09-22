import { SETTINGS_SECTION_IDS, type SettingsSectionId, type SettingsSections } from './sections'

/**
 * 設定の **scope**（ユーザー設定 / ワークスペース設定）。
 *
 * VS Code 系のエディタと同じく、設定を2段に分けて持つ。
 *
 * | scope       | 効く範囲                               | 保存先（Main が決める）                          |
 * | ----------- | -------------------------------------- | ------------------------------------------------ |
 * | `user`      | Fluvix Nexus 全体（どの Workspace でも） | `settings.json`（Session 4-3A からの文書そのまま） |
 * | `workspace` | 今開いている Workspace だけ            | `workspace-settings.json` の、その Workspace の欄 |
 *
 * **section と key の形は2つの scope で同じ**（`SettingsSections`）。ワークスペース設定は
 * 「ユーザー設定の一部の key を上書きするもの」で、別の設定体系ではない ──
 * そのため検証（main/store/settingsSections.ts）も読み方（各機能の `fromStored`）も
 * 1つのまま使い回せる。
 *
 * ## どちらが効くか
 *
 * **key 単位で** `ワークスペース設定 > ユーザー設定 > 既定` の順に探す。
 * section 単位にしないのは、「このプロジェクトだけ文字を大きくしたい」ときに
 * さかのぼれる行数までワークスペースへ固定されてしまうため。
 *
 * 既定値そのものはここに無い（既定を知っているのは読む側。shared/settings/sections.ts）。
 * ここが返すのは「どの scope にも無い ＝ 既定で読んでほしい」ことを表す `undefined` まで。
 *
 * ## 呼ぶ側は scope を意識しない
 *
 * 各機能が読むのは `resolveEffectiveSettings` を通した後の値だけで、
 * どちらの scope から来たかを知る必要は無い（Renderer では
 * settings/useSettingsSection.ts、Main では store/settings.ts の
 * `readEffectiveSettingsSections` がこれを通す）。scope を意識するのは
 * Settings 画面（どちらを編集しているか）と保存先だけになる。
 */

/** 設定を編集・保存する先。 */
export type SettingsScope = 'user' | 'workspace'

/** 並べる順（Settings 画面の切り替えもこの順）。 */
export const SETTINGS_SCOPES: readonly SettingsScope[] = ['user', 'workspace']

/**
 * section ごとに、どの scope で変えられるか。
 *
 *   `workspace`   … ユーザー設定・ワークスペース設定の両方で変えられる（既定）
 *   `application` … ユーザー設定でだけ変えられる
 *
 * `general`（表示言語）を `application` にしてあるのは、**アプリの言葉は
 * 使う人のもの**でプロジェクトの持ち物ではないため（VS Code も表示言語は
 * ワークスペースごとに変えられない）。プロジェクトを開き直すたびに
 * メニューの言葉が変わる形は、非エンジニアの利用者を迷わせるだけになる。
 *
 * `mcp` も同じく `application` にあたる（§21.6）。理由は言語とは別で、
 * **外部サービスへ繋ぐ意思が、開いたフォルダに従って変わってはいけない**
 * ため ── ワークスペースで上書きできると、人から受け取ったプロジェクトを
 * 開いただけで外部サービスへの接続が有効になる。登録したサーバーも秘密の値も
 * そもそも設定ファイルに無い（sections.ts の `StoredMcpSettings`）が、
 * 「使う」の側だけでも Workspace に決めさせない。
 *
 * section を足すときはここにも1行足す（`Record` なので書き忘れると型が通らない）。
 */
export const SETTINGS_SECTION_SCOPES: {
  readonly [Id in SettingsSectionId]: 'application' | 'workspace'
} = {
  general: 'application',
  appearance: 'workspace',
  editor: 'workspace',
  lsp: 'workspace',
  files: 'workspace',
  terminal: 'workspace',
  mcp: 'application'
}

/** その section をワークスペース設定で上書きできるか。 */
export function isWorkspaceScopedSection(section: SettingsSectionId): boolean {
  return SETTINGS_SECTION_SCOPES[section] === 'workspace'
}

/** 素の値が scope の名前か（IPC の要求を Main で確かめるため）。 */
export function isSettingsScope(value: unknown): value is SettingsScope {
  return value === 'user' || value === 'workspace'
}

/**
 * 実際に効く設定を組み立てる（key 単位で `workspace > user`）。
 *
 * `workspace` が null（Workspace を開いていない）ならユーザー設定そのもの。
 * `application` の section はワークスペース側に値があっても使わない
 * ── 手で書き足されたファイルでも、変えられないはずの設定が変わらないように。
 *
 * `previous` を渡すと、**中身の変わっていない section は前と同じ object を返す。**
 * Renderer はこの値を描画の依存に載せるため、Terminal の文字を変えただけで
 * Editor の設定まで「変わった」扱いになる形を避ける。
 */
export function resolveEffectiveSettings(
  user: SettingsSections,
  workspace: SettingsSections | null,
  previous?: SettingsSections
): SettingsSections {
  const resolved: Record<string, unknown> = {}

  for (const id of SETTINGS_SECTION_IDS) {
    const overrides = workspace !== null && isWorkspaceScopedSection(id) ? workspace[id] : undefined
    const merged = hasEntries(overrides) ? { ...user[id], ...definedEntries(overrides) } : user[id]
    const before = previous?.[id]

    resolved[id] = before !== undefined && isShallowEqual(before, merged) ? before : merged
  }

  return resolved as unknown as SettingsSections
}

/**
 * 1つの設定の、実際に効く値。
 *
 * `ワークスペース設定 → ユーザー設定` の順に探し、どちらにも無ければ `undefined`
 * （＝呼ぶ側の既定）。各機能は普段 section をまとめて読む（`fromStored` が
 * 既定への落とし込みと上下限を持つため）が、1つの値だけが要る場所ではこちらを使う。
 */
export function getEffectiveSetting<
  Id extends SettingsSectionId,
  K extends keyof SettingsSections[Id]
>(
  user: SettingsSections,
  workspace: SettingsSections | null,
  section: Id,
  key: K
): SettingsSections[Id][K] | undefined {
  if (workspace !== null && isWorkspaceScopedSection(section)) {
    const overridden = workspace[section][key]

    if (overridden !== undefined) {
      return overridden
    }
  }

  return user[section][key]
}

/**
 * その key がワークスペース設定で上書きされているか。
 *
 * Settings 画面が「ワークスペースで変更済み」「ユーザー設定より優先されています」を
 * 出すために使う。
 */
export function isOverriddenInWorkspace(
  workspace: SettingsSections | null,
  section: SettingsSectionId,
  keys: readonly string[]
): boolean {
  if (workspace === null || !isWorkspaceScopedSection(section)) {
    return false
  }

  const values = workspace[section] as Readonly<Record<string, unknown>>

  return keys.some((key) => values[key] !== undefined)
}

function hasEntries(value: object | undefined): value is object {
  return value !== undefined && Object.values(value).some((entry) => entry !== undefined)
}

function definedEntries(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function isShallowEqual(a: object, b: object): boolean {
  const left = a as Readonly<Record<string, unknown>>
  const right = b as Readonly<Record<string, unknown>>
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined)
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined)

  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key])
}
