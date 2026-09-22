import type { SettingsDocument, SettingsSections, SettingsSectionUpdate } from '@shared/settings'
import {
  defaultSettingsDocument,
  parseSettingsDocument,
  toStoredSettings,
  withSettingsSection
} from './settingsDocument'
import { isPlainObject, preservableEntries } from './settingsSections'

/**
 * ワークスペース設定の保存文書（Electron にも fs にも依存しない。feature/settings-scope）。
 *
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "workspaces": {
 *     "D:\\work\\project-a": {
 *       "updatedAt": 1789000000000,
 *       "schemaVersion": 1,
 *       "sections": { "terminal": { "fontSize": 18 } }
 *     }
 *   }
 * }
 * ```
 *
 * 保存先は `%APPDATA%/Fluvix Nexus/workspace-settings.json`（store/settings.ts が決める）。
 * **Workspace の中（`.vscode/` や `.fluvix/`）には書かない** ── Debug Profile で
 * 決めた線（ARCHITECTURE.md §20.5）をそのまま当てる。プロジェクトフォルダへ置くと、
 * clone しただけで「このプロジェクトではこう動く」が手元に入ってくる。
 * key は Workspace root の realpath で、Renderer へは出ない。
 *
 * ## 1つの Workspace の欄は `settings.json` と同じ形
 *
 * 欄の中身は `settings.json` の文書（`schemaVersion` + `sections`）そのもので、
 * 読み書きは `parseSettingsDocument` / `toStoredSettings` をそのまま通す。
 * **検証・壊れた key だけを落とす扱い・知らない内容の書き戻し・版の migration を
 * もう1組作らない**ためで、ユーザー設定で成り立つことはワークスペース設定でも
 * 成り立つ。足したのは Workspace ごとに引く外枠と `updatedAt` だけになる。
 *
 * ## 古い Workspace から落とす
 *
 * 開いたプロジェクトの数だけ欄が増えるので、上限（`WORKSPACE_SETTINGS_MAX_WORKSPACES`）を
 * 超えたら**最後に変えたのが最も古い欄**から落とす（breakpoint / profile と同じ扱い）。
 */

export const WORKSPACE_SETTINGS_SCHEMA_VERSION = 1

/** 持ち回す Workspace の数の上限。 */
export const WORKSPACE_SETTINGS_MAX_WORKSPACES = 200

/** 1つの Workspace の欄（メモリ上の形）。 */
export interface WorkspaceSettingsEntry {
  /** 最後に変えた時刻（epoch ミリ秒）。上限に当たったときに古い方から落とす。 */
  readonly updatedAt: number
  readonly document: SettingsDocument
}

/** 読み込み済みのワークスペース設定すべて。 */
export interface WorkspaceSettingsCollection {
  readonly workspaces: Readonly<Record<string, WorkspaceSettingsEntry>>
  /** 文書の直下にあった、この版が知らない項目（書き戻す）。 */
  readonly preserved: Readonly<Record<string, unknown>>
}

export interface ParsedWorkspaceSettings {
  readonly collection: WorkspaceSettingsCollection
  /** 既定へ落とした場所（ログ用）。 */
  readonly issues: readonly string[]
}

export function emptyWorkspaceSettingsCollection(): WorkspaceSettingsCollection {
  return { workspaces: {}, preserved: {} }
}

/** 素の値をワークスペース設定として読む。読めなかった欄は捨てる（null は返さない）。 */
export function parseWorkspaceSettings(raw: unknown): ParsedWorkspaceSettings {
  if (!isPlainObject(raw)) {
    return { collection: emptyWorkspaceSettingsCollection(), issues: ['document is not an object'] }
  }

  const { schemaVersion, workspaces } = raw

  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return {
      collection: emptyWorkspaceSettingsCollection(),
      issues: ['schemaVersion is not readable']
    }
  }

  if (!isPlainObject(workspaces)) {
    return {
      collection: emptyWorkspaceSettingsCollection(),
      issues: ['workspaces is not an object']
    }
  }

  const issues: string[] = []
  const entries: Array<readonly [string, WorkspaceSettingsEntry]> = []

  for (const [key, value] of Object.entries(workspaces)) {
    if (key.length === 0 || !isPlainObject(value)) {
      issues.push('dropped a workspace entry that is not an object')
      continue
    }

    const parsed = parseSettingsDocument(value)

    for (const issue of parsed.issues) {
      issues.push(`workspace entry: ${issue}`)
    }

    entries.push([
      key,
      { updatedAt: readUpdatedAt(value.updatedAt), document: withoutUpdatedAt(parsed.document) }
    ])
  }

  return {
    collection: {
      workspaces: Object.fromEntries(trimToLimit(entries)),
      preserved: preservableEntries(raw, ['schemaVersion', 'workspaces'])
    },
    issues
  }
}

/** その Workspace のワークスペース設定（欄が無ければすべて空）。 */
export function readWorkspaceSections(
  collection: WorkspaceSettingsCollection,
  key: string
): SettingsSections {
  return (collection.workspaces[key]?.document ?? defaultSettingsDocument()).sections
}

/**
 * その Workspace の section を1つ差し替える。
 *
 * **他の Workspace にも、同じ Workspace の他の section にも触れない**
 * （`withSettingsSection` と同じ約束）。
 */
export function withWorkspaceSection(
  collection: WorkspaceSettingsCollection,
  key: string,
  update: SettingsSectionUpdate,
  now: number
): WorkspaceSettingsCollection {
  const current = collection.workspaces[key]?.document ?? defaultSettingsDocument()
  const entries = Object.entries({
    ...collection.workspaces,
    [key]: { updatedAt: now, document: withSettingsSection(current, update) }
  })

  return { ...collection, workspaces: Object.fromEntries(trimToLimit(entries)) }
}

/** ディスクへ書く形へ組み立てる。 */
export function toStoredWorkspaceSettings(
  collection: WorkspaceSettingsCollection
): Record<string, unknown> {
  const workspaces: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(collection.workspaces)) {
    workspaces[key] = { ...toStoredSettings(entry.document), updatedAt: entry.updatedAt }
  }

  return {
    ...collection.preserved,
    schemaVersion: WORKSPACE_SETTINGS_SCHEMA_VERSION,
    workspaces
  }
}

function readUpdatedAt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * `updatedAt` は外枠の欄なので、`settings.json` の形として読んだときの
 * 「知らない項目」（`preserved.document`）から外す。残すと書き戻しで二重になる。
 */
function withoutUpdatedAt(document: SettingsDocument): SettingsDocument {
  const { updatedAt: _updatedAt, ...rest } = document.preserved.document

  return { ...document, preserved: { ...document.preserved, document: rest } }
}

function trimToLimit(
  entries: ReadonlyArray<readonly [string, WorkspaceSettingsEntry]>
): Array<readonly [string, WorkspaceSettingsEntry]> {
  return [...entries]
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, WORKSPACE_SETTINGS_MAX_WORKSPACES)
}
