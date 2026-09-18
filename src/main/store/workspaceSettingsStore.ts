import { join } from 'path'
import type { SettingsSections, SettingsSectionUpdate } from '@shared/settings'
import { createJsonFileWriter, readJsonFile } from './jsonFile'
import {
  emptyWorkspaceSettingsCollection,
  parseWorkspaceSettings,
  readWorkspaceSections,
  toStoredWorkspaceSettings,
  withWorkspaceSection,
  type WorkspaceSettingsCollection
} from './workspaceSettingsDocument'
import type { SettingsStoreOptions } from './settingsStore'

/**
 * `workspace-settings.json` の読み書き（feature/settings-scope）。
 *
 * settingsStore.ts と同じ形で、保存先のフォルダを引数で受け取る（Vitest から
 * 実際のディスクで試せるように）。**どの Workspace の欄かを決める key も
 * 引数で受け取る** ── key を realpath で揃えるのは Electron 側の薄い層
 * （store/settings.ts）の役目で、ここは渡された key の欄しか知らない。
 *
 * 読むのは最初の1度だけで、以降はメモリの写しを返す（settingsStore.ts と同じ）。
 * 書くときは文書全体になるが、差し替わるのは指定された Workspace の指定された
 * section だけ（workspaceSettingsDocument.ts）。
 */

export const WORKSPACE_SETTINGS_FILE_NAME = 'workspace-settings.json'

export interface WorkspaceSettingsStore {
  /** その Workspace のワークスペース設定。欄が無ければすべて空。 */
  read(workspaceKey: string): SettingsSections
  /** その Workspace の section を1つ保存する。連続呼び出しは間引かれる。 */
  saveSection(workspaceKey: string, update: SettingsSectionUpdate): void
  /** 予約済みの書き込みを即座に反映する。 */
  flush(): void
}

export interface WorkspaceSettingsStoreOptions extends SettingsStoreOptions {
  /** 時刻（試験で差し替える）。 */
  readonly now?: () => number
}

export function createWorkspaceSettingsStore(
  directory: string,
  options: WorkspaceSettingsStoreOptions = {}
): WorkspaceSettingsStore {
  const filePath = join(directory, WORKSPACE_SETTINGS_FILE_NAME)
  const report = options.onIssue ?? ((): void => {})
  const now = options.now ?? Date.now

  const writer = createJsonFileWriter(filePath, (cause) => {
    // 保存に失敗してもアプリの動作は継続する（settingsStore.ts と同じ扱い）。
    report(`failed to write "${WORKSPACE_SETTINGS_FILE_NAME}".`, cause)
  })

  let collection: WorkspaceSettingsCollection | null = null

  function load(): WorkspaceSettingsCollection {
    const found = readJsonFile(filePath)

    if (found.kind === 'present') {
      const parsed = parseWorkspaceSettings(found.raw)

      for (const issue of parsed.issues) {
        report(`"${WORKSPACE_SETTINGS_FILE_NAME}": ${issue}`)
      }

      return parsed.collection
    }

    if (found.kind === 'unreadable') {
      report(
        `failed to read "${WORKSPACE_SETTINGS_FILE_NAME}"; workspace settings start empty.`,
        found.cause
      )
    }

    // 無いのは正常（まだどの Workspace でも変えていない）。ファイルは作らない。
    return emptyWorkspaceSettingsCollection()
  }

  function current(): WorkspaceSettingsCollection {
    collection ??= load()
    return collection
  }

  return {
    read(workspaceKey: string): SettingsSections {
      return readWorkspaceSections(current(), workspaceKey)
    },

    saveSection(workspaceKey: string, update: SettingsSectionUpdate): void {
      collection = withWorkspaceSection(current(), workspaceKey, update, now())
      writer.save(toStoredWorkspaceSettings(collection))
    },

    flush(): void {
      writer.flush()
    }
  }
}
