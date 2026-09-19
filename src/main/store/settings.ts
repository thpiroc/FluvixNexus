import { realpathSync } from 'fs'
import { app } from 'electron'
import type { WorkspaceSettingsSnapshot } from '@shared/ipc'
import {
  getEffectiveSetting,
  isWorkspaceScopedSection,
  resolveEffectiveSettings,
  type SettingsSectionId,
  type SettingsSections,
  type SettingsSectionUpdate
} from '@shared/settings'
import type { WorkspaceFolder } from '@shared/workspace'
import { createLogger } from '../logger'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../workspaceFolder/currentWorkspaceFolder'
import { createSettingsStore, type SettingsStore } from './settingsStore'
import { createWorkspaceSettingsStore, type WorkspaceSettingsStore } from './workspaceSettingsStore'

/**
 * アプリ設定の保存先（Session 4-3A。feature/settings-scope でユーザー / ワークスペースの2段に）。
 *
 * | scope       | 保存先                                                   |
 * | ----------- | -------------------------------------------------------- |
 * | ユーザー     | `%APPDATA%/Fluvix Nexus/settings.json`（Session 4-3A のまま） |
 * | ワークスペース | `%APPDATA%/Fluvix Nexus/workspace-settings.json` の、その Workspace の欄 |
 *
 * どちらも app.getPath('userData') 配下で、**プロジェクトフォルダの中には何も書かない**
 * ── Workspace ごとの欄は Workspace root の realpath で引く（Debug Profile と同じ。
 * ARCHITECTURE.md §20.5）。
 *
 * このファイルが持つのは Electron に関わる部分だけで、
 *
 *   - 保存先のフォルダ（userData）を決める
 *   - 今の Workspace を、ワークスペース設定の欄の key（realpath）へ引く
 *   - 実際に効く設定（`ワークスペース > ユーザー`）を組み立てて配る
 *   - 読み込みで落ちたものをログに出す
 *
 * 読み書きそのものは store/settingsStore.ts と store/workspaceSettingsStore.ts にある
 * （Electron 非依存・テスト対象）。効く値の決め方は shared/settings/scope.ts の1つだけ。
 *
 * **Renderer は保存先を知らない。** パスもファイル名も指定できず、渡せるのは
 * 「どの scope の、どの section を、どんな値にするか」だけ（shared/ipc/contracts/settings.ts）。
 */

const log = createLogger('settings')

function reportIssue(message: string, ...details: readonly unknown[]): void {
  log.warn(message, ...details)
}

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let userStore: SettingsStore | null = null
let workspaceStore: WorkspaceSettingsStore | null = null

function getUserStore(): SettingsStore {
  userStore ??= createSettingsStore(app.getPath('userData'), { onIssue: reportIssue })
  return userStore
}

function getWorkspaceStore(): WorkspaceSettingsStore {
  workspaceStore ??= createWorkspaceSettingsStore(app.getPath('userData'), {
    onIssue: reportIssue
  })
  return workspaceStore
}

/**
 * ワークスペース設定の欄の key（Workspace root の realpath）。
 *
 * realpath で揃えるのは、ジャンクション越しに同じフォルダを開いたときに
 * 別のプロジェクトとして設定が分かれないようにするため（debug/debugProfiles.ts と同じ）。
 * 取れなければ開いたときのパスのまま引く。
 */
function workspaceKey(workspace: WorkspaceFolder): string {
  try {
    return realpathSync(workspace.rootPath)
  } catch {
    return workspace.rootPath
  }
}

/** ユーザー設定。未保存・破損の section は空（＝既定で始まる）。 */
export function readUserSettingsSections(): SettingsSections {
  return getUserStore().read()
}

/** 今開いている Workspace のワークスペース設定。Workspace が無ければ null。 */
export function readWorkspaceSettingsSnapshot(): WorkspaceSettingsSnapshot | null {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return null
  }

  return {
    workspaceId: workspace.id,
    displayName: workspace.displayName,
    sections: getWorkspaceStore().read(workspaceKey(workspace))
  }
}

/**
 * 実際に効く設定（key 単位で `ワークスペース設定 > ユーザー設定`。無い key は既定）。
 *
 * Main 側で設定を読む機能（最初の1枚の色・Language Server の有効 / 無効）は、
 * どちらの scope から来た値かを気にせずこれを読む。
 */
export function readEffectiveSettingsSections(): SettingsSections {
  return resolveEffectiveSettings(
    readUserSettingsSections(),
    readWorkspaceSettingsSnapshot()?.sections ?? null
  )
}

/** 1つの設定の、実際に効く値（どこにも無ければ undefined ＝ 呼ぶ側の既定）。 */
export function getEffectiveSettingValue<
  Id extends SettingsSectionId,
  K extends keyof SettingsSections[Id]
>(section: Id, key: K): SettingsSections[Id][K] | undefined {
  return getEffectiveSetting(
    readUserSettingsSections(),
    readWorkspaceSettingsSnapshot()?.sections ?? null,
    section,
    key
  )
}

/**
 * 実際に効く設定が変わったかもしれない、という知らせ（Session 5-4 の保存の知らせを置き換え）。
 *
 * 呼ばれるのは、どちらかの scope へ保存したとき・Workspace が切り替わったとき。
 * **本当に変わったかは受け手が確かめる**（同じ値の知らせは珍しくない。
 * main/lsp/languageServerSettings.ts）。
 *
 * この層は誰が聞いているかを知らない ── ここから個別の機能を呼ぶ形にすると、
 * 保存先が LSP の都合を持つことになる（main/workspaceFolder/currentWorkspaceFolder.ts と同じ理由）。
 */
export type EffectiveSettingsListener = (effective: SettingsSections) => void

const effectiveListeners = new Set<EffectiveSettingsListener>()

/** 実際に効く設定が変わりうるときに呼ばれる。戻り値は購読の解除。 */
export function onEffectiveSettingsChange(listener: EffectiveSettingsListener): () => void {
  effectiveListeners.add(listener)

  return () => {
    effectiveListeners.delete(listener)
  }
}

function notifyEffectiveSettings(): void {
  if (effectiveListeners.size === 0) {
    return
  }

  const effective = readEffectiveSettingsSections()

  for (const listener of effectiveListeners) {
    try {
      listener(effective)
    } catch (cause) {
      // 受け手の失敗で、設定の保存そのものを失敗にしない。
      log.error('a settings listener failed.', cause)
    }
  }
}

/**
 * Workspace の切り替えに追従し始める（アプリの起動時に1度だけ）。
 *
 * 切り替わるとワークスペース設定が入れ替わるので、効く設定も変わりうる。
 * **Language Server の設定より先に張る**（app/lifecycle.ts）── 受け手が
 * 登録された時点で、切り替えの知らせを受け取れる状態にしておく。
 */
export function startSettingsScopeTracking(): void {
  onWorkspaceFolderChange(() => {
    notifyEffectiveSettings()
  })
}

/** ユーザー設定の section を1つ保存する。 */
export function saveUserSettingsSection(update: SettingsSectionUpdate): void {
  getUserStore().saveSection(update)

  /*
    知らせるのは保存を予約した後。受け手（main/lsp/languageServerSettings.ts）は
    ディスクではなくこの値を読むので、間引きの待ち時間は関わらない
    ── 押した瞬間にサーバが止まる / 立ち上がる必要がある。
  */
  notifyEffectiveSettings()
}

/** ワークスペース設定の保存の結末。 */
export type SaveWorkspaceSettingsOutcome =
  | 'saved'
  /** Workspace を開いていない / 名乗った Workspace が今開いているものと違う。 */
  | 'workspace-mismatch'
  /** その section はユーザー設定でしか変えられない（shared/settings/scope.ts）。 */
  | 'not-workspace-scoped'

/**
 * 今開いている Workspace のワークスペース設定の section を1つ保存する。
 *
 * `workspaceId` が今の Workspace と一致するときだけ書く ── 切り替えの直前に出た
 * 保存が、次に開いた別のプロジェクトの設定へ混ざらないように。
 */
export function saveWorkspaceSettingsSection(
  workspaceId: string,
  update: SettingsSectionUpdate
): SaveWorkspaceSettingsOutcome {
  if (!isWorkspaceScopedSection(update.section)) {
    return 'not-workspace-scoped'
  }

  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null || workspace.id !== workspaceId) {
    return 'workspace-mismatch'
  }

  getWorkspaceStore().saveSection(workspaceKey(workspace), update)
  notifyEffectiveSettings()

  return 'saved'
}

/**
 * 予約済みの書き込みを即座に反映する。
 *
 * 終了時に呼ぶ（app の will-quit）。設定を変えた直後に終了しても
 * 次回起動で保たれるようにするための保険。
 */
export function flushSettingsDocument(): void {
  // 一度も使っていなければ保存すべきものも無い（ここでストアを作る必要は無い）。
  userStore?.flush()
  workspaceStore?.flush()
}
