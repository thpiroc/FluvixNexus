import { randomUUID } from 'crypto'
import { app } from 'electron'
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { join } from 'path'
import type { PlatformId } from '@shared/api'
import {
  DEBUG_PROFILES_MAX_PER_WORKSPACE,
  DEBUG_PROFILES_MAX_WORKSPACES,
  DEBUG_PROFILES_SCHEMA_VERSION,
  isDebugProfileIdShape,
  type DebugProfile,
  type DebugProfileDeleteOutcome,
  type DebugProfileId,
  type DebugProfileSaveOutcome,
  type DebugProfilesDocument,
  type DebugStartOutcome,
  type StoredDebugProfileWorkspace
} from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import type { FileExistsCheck } from '../platform/executablePath'
import { readDebugProfilesDocument, saveDebugProfilesDocument } from '../store/debugProfiles'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import {
  DEBUG_ADAPTER_ARTIFACTS,
  DEBUG_ADAPTER_ARTIFACTS_DIRECTORY_NAME,
  resolveDebugAdapterArtifactRoot,
  verifyDebugAdapterArtifact,
  type DebugAdapterArtifactId,
  type DebugAdapterArtifactVerification
} from './adapterArtifact'
import {
  getDebugAdapterCatalogEntry,
  type DebugAdapterCatalogEntry,
  type DebugAdapterLanguageId
} from './adapterCatalog'
import {
  getDebugSessionState,
  startDebugSession,
  type DebugSessionStartOptions,
  type DebugSessionState,
  type StartDebugSessionOutcome
} from './debugSessionManager'
import { resolveDebugProfile } from './profileResolver'
import { checkDebugProgramPathForSave, type DebugProgramFileSystem } from './programPath'
import { validateDebugProfileDraft } from './profileValidation'

/**
 * 今の Workspace の Debug Profile の正本と、`debug:start`（Session 6-10）。
 *
 * ```
 * Renderer
 *    ↓  DebugProfileDraft（6欄）/ profileId
 * main/ipc/handlers/debug.ts   要求の形（object か・id の形か）だけを確かめる
 *    ↓
 * ここ                          欄の検証・id の発番・保存・起動の噛み合わせ
 *    ├ profileValidation.ts    欄の形（環境変数の方針を含む）
 *    ├ programPath.ts          相対位置の2段（保存時は在るものだけ実体を見る）
 *    ├ profileResolver.ts      Profile → ResolvedLaunchConfiguration（起動時）
 *    └ debugSessionManager.ts  adapter の起動と lifecycle（6-2 のまま）
 * ```
 *
 * ## id は Main が発番する
 *
 * 作成の要求に id の欄は無く、draft に `profileId` が載っていても読まない（検証が
 * 6欄から作り直す）。Renderer が任意の id を書けると、保存領域の任意の位置を指す形に
 * 近づく（§20.3）。
 *
 * ## Workspace ごと・key を渡す口が無い
 *
 * どの Workspace の分かを Renderer は言わない。返るのは常に今の Workspace の分で、
 * 保存ファイルの key（Workspace root の realpath）は Renderer へ出ない（§20.5）。
 *
 * ## 控えを持つ
 *
 * jsonStore の書き込みは間引かれる（400ms）ので、書いた直後にディスクを読み直すと
 * 古い内容が返りうる。**最初に1度だけ読み、以降は控えを正本にする**
 * （単一インスタンスが前提。main/app/lifecycle.ts）。
 */

export interface DebugProfileServiceDependencies {
  readonly getWorkspace: () => WorkspaceFolder | null
  readonly readDocument: () => DebugProfilesDocument | null
  readonly saveDocument: (document: DebugProfilesDocument) => void
  /** `dp-<uuid>` を返す（テストで決まった値にする）。 */
  readonly createProfileId: () => DebugProfileId
  readonly now: () => number
  readonly fileSystem: DebugProgramFileSystem
  readonly platform: PlatformId
  readonly getParentEnv: () => Readonly<Record<string, string | undefined>>
  readonly exists: FileExistsCheck
  readonly getCatalogEntry: (language: DebugAdapterLanguageId) => DebugAdapterCatalogEntry
  /** adapter のプロセスの cwd。Main が持つ Workspace の外のフォルダ（Session 6-12）。 */
  readonly getAdapterWorkingDirectory: () => string
  /** catalog の行が名乗る配布物を確かめる（Session 6-15B。起動のたびに呼ぶ）。 */
  readonly resolveAdapterArtifact: (
    artifact: DebugAdapterArtifactId
  ) => DebugAdapterArtifactVerification
  readonly getSessionState: () => DebugSessionState
  readonly startSession: (options: DebugSessionStartOptions) => StartDebugSessionOutcome
  readonly log?: (level: 'info' | 'warn', message: string) => void
}

export interface DebugProfileService {
  readonly list: () => readonly DebugProfile[]
  readonly create: (rawDraft: unknown) => DebugProfileSaveOutcome
  readonly update: (profileId: DebugProfileId, rawDraft: unknown) => DebugProfileSaveOutcome
  readonly remove: (profileId: DebugProfileId) => DebugProfileDeleteOutcome
  readonly start: (profileId: DebugProfileId) => DebugStartOutcome
}

const EMPTY_DOCUMENT: DebugProfilesDocument = {
  schemaVersion: DEBUG_PROFILES_SCHEMA_VERSION,
  workspaces: {}
}

/** 発番が既存の id と重なったときに引き直す回数（UUID なので実際には1回で済む）。 */
const PROFILE_ID_ATTEMPTS = 8

export function createDebugProfileService(
  dependencies: DebugProfileServiceDependencies
): DebugProfileService {
  let document: DebugProfilesDocument | null = null
  let loaded = false

  function load(): DebugProfilesDocument {
    if (!loaded) {
      loaded = true
      document = dependencies.readDocument()
    }

    return document ?? EMPTY_DOCUMENT
  }

  /**
   * 保存ファイルの key（Workspace root の realpath。§20.5）。
   *
   * root を realpath で揃えるのは、ジャンクション越しに同じフォルダを開いたときに
   * 別の Workspace として profile が分かれないようにするため。取れなければ
   * （root が今は見えない）開いたときのパスのまま引く。
   */
  function workspaceKey(workspace: WorkspaceFolder): string {
    try {
      return dependencies.fileSystem.realpath(workspace.rootPath)
    } catch {
      return workspace.rootPath
    }
  }

  function profilesFor(key: string): readonly DebugProfile[] {
    return load().workspaces[key]?.profiles ?? []
  }

  function persist(key: string, profiles: readonly DebugProfile[]): void {
    const merged: Record<string, StoredDebugProfileWorkspace> = {
      ...load().workspaces,
      [key]: { updatedAt: dependencies.now(), profiles }
    }

    document = {
      schemaVersion: DEBUG_PROFILES_SCHEMA_VERSION,
      workspaces: trimWorkspaces(merged, key)
    }
    dependencies.saveDocument(document)
  }

  function list(): readonly DebugProfile[] {
    const workspace = dependencies.getWorkspace()

    return workspace === null ? [] : profilesFor(workspaceKey(workspace))
  }

  /**
   * 欄の検証と、相対位置の保存時の検証。
   *
   * 通れば6欄から作り直した draft を返す（要求に載っていた `profileId` / `cwd` /
   * `adapter` などは、ここで消える）。
   */
  function checkDraft(
    workspace: WorkspaceFolder,
    rawDraft: unknown
  ):
    | { readonly status: 'ok'; readonly draft: Omit<DebugProfile, 'profileId'> }
    | Extract<DebugProfileSaveOutcome, { status: 'invalid' }> {
    const check = validateDebugProfileDraft(rawDraft)

    if (check.status !== 'ok') {
      return check
    }

    const path = checkDebugProgramPathForSave(
      workspace.rootPath,
      check.draft.programRelativePath,
      dependencies.fileSystem
    )

    if (path !== 'ok') {
      return { status: 'invalid', field: 'programRelativePath', reason: path }
    }

    return check
  }

  function create(rawDraft: unknown): DebugProfileSaveOutcome {
    const workspace = dependencies.getWorkspace()

    if (workspace === null) {
      return { status: 'rejected', reason: 'no-workspace' }
    }

    const check = checkDraft(workspace, rawDraft)

    if (check.status !== 'ok') {
      return check
    }

    const key = workspaceKey(workspace)
    const current = profilesFor(key)

    if (current.length >= DEBUG_PROFILES_MAX_PER_WORKSPACE) {
      return { status: 'rejected', reason: 'limit-reached' }
    }

    const profile = { profileId: issueProfileId(current), ...check.draft } as DebugProfile
    const profiles = [...current, profile]

    persist(key, profiles)

    return { status: 'saved', profile, profiles }
  }

  function update(profileId: DebugProfileId, rawDraft: unknown): DebugProfileSaveOutcome {
    const workspace = dependencies.getWorkspace()

    if (workspace === null) {
      return { status: 'rejected', reason: 'no-workspace' }
    }

    const key = workspaceKey(workspace)
    const current = profilesFor(key)
    const index = current.findIndex((candidate) => candidate.profileId === profileId)

    if (index === -1) {
      return { status: 'rejected', reason: 'profile-not-found' }
    }

    const check = checkDraft(workspace, rawDraft)

    if (check.status !== 'ok') {
      return check
    }

    // id は保存されていたものを使う（要求の draft に載っていても読まない）。
    const profile = { profileId: current[index].profileId, ...check.draft } as DebugProfile
    const profiles = current.map((candidate, at) => (at === index ? profile : candidate))

    persist(key, profiles)

    return { status: 'saved', profile, profiles }
  }

  function remove(profileId: DebugProfileId): DebugProfileDeleteOutcome {
    const workspace = dependencies.getWorkspace()

    if (workspace === null) {
      return { status: 'rejected', reason: 'no-workspace' }
    }

    const key = workspaceKey(workspace)
    const current = profilesFor(key)

    if (!current.some((candidate) => candidate.profileId === profileId)) {
      return { status: 'rejected', reason: 'profile-not-found' }
    }

    const profiles = current.filter((candidate) => candidate.profileId !== profileId)

    persist(key, profiles)

    return { status: 'deleted', profiles }
  }

  /**
   * 起動（`debug:start`）。
   *
   * 受け取るのは id だけで、何を・どこで・どの adapter で動かすかは、
   * 保存されている profile と Main の表から決まる。**断りも失敗も値で返し、
   * 理由の分類だけを載せる** ── 解決した絶対パス・adapter の実行ファイル・spawn の
   * 文言は Main のログにだけ残す。
   */
  function start(profileId: DebugProfileId): DebugStartOutcome {
    const workspace = dependencies.getWorkspace()

    if (workspace === null) {
      return { status: 'rejected', reason: 'no-workspace' }
    }

    const profile = profilesFor(workspaceKey(workspace)).find(
      (candidate) => candidate.profileId === profileId
    )

    if (profile === undefined) {
      return { status: 'rejected', reason: 'profile-not-found' }
    }

    /*
      解決の前に断る。動いている間に PATH や realpath を辿っても使い道が無く、
      Manager も同じ理由で断る（v1 の同時 Debug Session は1本。§20.11）。
    */
    if (dependencies.getSessionState() !== 'idle') {
      return { status: 'rejected', reason: 'already-running' }
    }

    const resolution = resolveDebugProfile(profile, {
      workspaceRootPath: workspace.rootPath,
      platform: dependencies.platform,
      parentEnv: dependencies.getParentEnv(),
      exists: dependencies.exists,
      fileSystem: dependencies.fileSystem,
      getCatalogEntry: dependencies.getCatalogEntry,
      adapterWorkingDirectory: dependencies.getAdapterWorkingDirectory(),
      resolveAdapterArtifact: dependencies.resolveAdapterArtifact
    })

    if (resolution.status === 'failed') {
      dependencies.log?.(
        'warn',
        `debug profile ${profileId} was not started: ${resolution.reason}.`
      )
      return { status: 'failed', reason: resolution.reason }
    }

    const { configuration } = resolution

    dependencies.log?.(
      'info',
      `starting ${configuration.adapterCommand.name} for debug profile ${profileId}: ` +
        `adapter=${configuration.adapterCommand.file} cwd=${configuration.adapterCommand.cwd}`
    )

    const outcome = dependencies.startSession({
      adapterId: configuration.adapterId,
      adapterCommand: configuration.adapterCommand,
      launchArguments: configuration.launchArguments,
      waitForLaunchResponseBeforeConfiguration:
        configuration.waitForLaunchResponseBeforeConfiguration,
      exceptionBreakpointFilters: configuration.exceptionBreakpointFilters,
      ...(configuration.childSessions === undefined
        ? {}
        : { childSessions: configuration.childSessions })
    })

    switch (outcome.status) {
      case 'started':
        return { status: 'started' }

      case 'already-running':
        return { status: 'rejected', reason: 'already-running' }

      case 'spawn-failed':
        dependencies.log?.('warn', `debug adapter spawn failed: ${outcome.detail}`)
        return { status: 'failed', reason: 'spawn-failed' }
    }
  }

  function issueProfileId(current: readonly DebugProfile[]): DebugProfileId {
    for (let attempt = 0; attempt < PROFILE_ID_ATTEMPTS; attempt += 1) {
      const candidate = dependencies.createProfileId()

      if (
        isDebugProfileIdShape(candidate) &&
        !current.some((profile) => profile.profileId === candidate)
      ) {
        return candidate
      }
    }

    throw new Error('could not issue a unique debug profile id.')
  }

  return { list, create, update, remove, start }
}

/**
 * 覚えておく Workspace の数を上限に収める（main/debug/breakpoints.ts と同じ規則）。
 *
 * 落とすのは**今の Workspace 以外で最も古いもの**。今の分は常に残す。
 */
function trimWorkspaces(
  workspaces: Record<string, StoredDebugProfileWorkspace>,
  keepKey: string
): Record<string, StoredDebugProfileWorkspace> {
  const entries = Object.entries(workspaces)

  if (entries.length <= DEBUG_PROFILES_MAX_WORKSPACES) {
    return workspaces
  }

  const others = entries
    .filter(([key]) => key !== keepKey)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, DEBUG_PROFILES_MAX_WORKSPACES - 1)

  const kept = workspaces[keepKey]

  return Object.fromEntries(kept === undefined ? others : [[keepKey, kept], ...others])
}

/* ------------------------------------------------------------ 既定のサービス */

const log = createLogger('debug-profiles')

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const defaultService = createDebugProfileService({
  getWorkspace: getCurrentWorkspaceFolder,
  readDocument: readDebugProfilesDocument,
  saveDocument: saveDebugProfilesDocument,
  createProfileId: () => `dp-${randomUUID()}`,
  now: () => Date.now(),
  /*
    realpath は native（libuv）を使う。Files ドメインの `fs/promises` の realpath と
    同じ実装で、ジャンクションの解き方を揃える。
  */
  fileSystem: { realpath: (path) => realpathSync.native(path), isFile },
  platform: currentPlatform,
  getParentEnv: () => process.env,
  exists: isFile,
  getCatalogEntry: getDebugAdapterCatalogEntry,
  /*
    adapter のプロセスの cwd（Session 6-12。docs/ARCHITECTURE.md §20.20）。userData は
    Main が作って持つフォルダで、Python のモジュールを置く場所ではない。Workspace の中を
    指していれば profileResolver.ts が起動を断る。
  */
  getAdapterWorkingDirectory: () => app.getPath('userData'),
  /*
    adapter の配布物（Session 6-15B。docs/ARCHITECTURE.md §20.24）。置き場所は userData の下で、
    Renderer から来る値も Workspace も見ない。使えない理由（無い / 形が違う / hash が違う）と
    置き場所は Main のログにだけ残し、起動の結末は `adapter-unavailable` になる。
  */
  resolveAdapterArtifact: (id) => {
    const artifact = DEBUG_ADAPTER_ARTIFACTS[id]
    const rootPath = resolveDebugAdapterArtifactRoot(
      join(app.getPath('userData'), DEBUG_ADAPTER_ARTIFACTS_DIRECTORY_NAME),
      artifact
    )
    const verification = verifyDebugAdapterArtifact(rootPath, artifact, {
      lstat: (path) => lstatSync(path),
      readdir: (path) => readdirSync(path),
      readFile: (path) => readFileSync(path)
    })

    if (verification.status !== 'verified') {
      log.warn(
        `debug adapter artifact ${id} ${artifact.version} is not usable (${verification.status}): ${rootPath}`
      )
    }

    return verification
  },
  getSessionState: getDebugSessionState,
  startSession: startDebugSession,
  log: (level, message) => {
    log[level](message)
  }
})

/** 今の Workspace の Debug Profile（`debug:list-profiles`）。 */
export function listDebugProfiles(): readonly DebugProfile[] {
  return defaultService.list()
}

export function createDebugProfile(rawDraft: unknown): DebugProfileSaveOutcome {
  return defaultService.create(rawDraft)
}

export function updateDebugProfile(
  profileId: DebugProfileId,
  rawDraft: unknown
): DebugProfileSaveOutcome {
  return defaultService.update(profileId, rawDraft)
}

export function deleteDebugProfile(profileId: DebugProfileId): DebugProfileDeleteOutcome {
  return defaultService.remove(profileId)
}

/** `debug:start`。呼ぶのは main/ipc/handlers/debug.ts だけになる。 */
export function startDebugProfile(profileId: DebugProfileId): DebugStartOutcome {
  return defaultService.start(profileId)
}
