import { randomUUID } from 'crypto'
import { statSync } from 'fs'
import {
  WORKSPACE_FOLDER_SCHEMA_VERSION,
  type StoredWorkspaceFolder,
  type WorkspaceFolder
} from '@shared/workspace'
import { createLogger } from '../logger'
import { readWorkspaceFolderDocument, saveWorkspaceFolderDocument } from '../store/workspaceFolder'
import { deriveWorkspaceDisplayName, normalizeWorkspaceRootPath } from './folderPath'

/**
 * 今開いている Workspace（プロジェクトフォルダ）の正本。
 *
 * **Main 側が持つ**のは、これから Workspace を必要とする機能がすべて Main に居るため。
 *   - Files … ファイルの列挙・読み書きの基点
 *   - Terminal … シェルを起動する作業ディレクトリ
 *   - Git … リポジトリの場所
 *   - LSP / DAP … プロジェクトの root
 * Renderer が持って毎回渡す形にすると、これらが「Renderer から届いたパス」を信じて
 * OS を触ることになり、STEP 1 の責務分離が意味を失う。
 * Renderer が持つのは表示用の写しで、変更は必ずこの層を通る。
 *
 * 一方、状態を Main → Renderer へ**押し出す**経路（イベント）はまだ無い（ARCHITECTURE.md §3.3）。
 * 今のところ Workspace が変わるきっかけは利用者の操作だけで、その応答として
 * 新しい状態が返るため要らない。Main 側の都合で変わる要因（フォルダの消失を監視する等）が
 * できた時点で、Terminal と同じイベント経路に載せる。
 *
 * ## Main 側の機能へは購読で伝える
 *
 * 「今の Workspace が変わった」を知る必要のある Main 側の機能（ファイル監視、
 * 将来の Terminal / LSP）は onWorkspaceFolderChange で受け取る。ここから
 * 個別の機能を呼び出す形にすると、**正本がその機能の都合を知る**ことになり、
 * 機能が増えるたびにこのファイルが太る。呼ぶ側と呼ばれる側を逆にしてある。
 */

const log = createLogger('workspace-folder')

/** 今開いている Workspace。未選択なら null。 */
let current: WorkspaceFolder | null = null

/** 保存内容からの復元を済ませたか（起動後1度だけ行う）。 */
let restored = false

/**
 * 復元できなかった前回の rootPath。
 *
 * 未選択で起動した理由を UI に出すために持つ。利用者が何か操作した時点で消える
 * （「前回の Workspace が無い」は起動時の話でしかないため）。
 */
let unavailableRootPath: string | null = null

/** 「今の Workspace が変わった」の受け手（Main 側の機能）。 */
export type WorkspaceFolderChangeListener = (workspace: WorkspaceFolder | null) => void

const changeListeners = new Set<WorkspaceFolderChangeListener>()

/**
 * Workspace が切り替わったときに呼ばれる（開く / 閉じる の両方）。
 *
 * 戻り値は購読の解除（Main → Renderer のイベントと同じ形。ARCHITECTURE.md §3.3）。
 * **復元では呼ばない。** 復元は「起動時に最初から開いていた」であって切り替えではなく、
 * 購読する側は登録した時点で getCurrentWorkspaceFolder() を読めばよい
 * （復元が済んでいなければそこで済む）。
 */
export function onWorkspaceFolderChange(listener: WorkspaceFolderChangeListener): () => void {
  changeListeners.add(listener)

  return () => {
    changeListeners.delete(listener)
  }
}

function notifyChanged(workspace: WorkspaceFolder | null): void {
  for (const listener of changeListeners) {
    try {
      listener(workspace)
    } catch (cause) {
      // 受け手の失敗で Workspace の切り替えそのものを止めない。
      log.error('a workspace folder listener failed.', cause)
    }
  }
}

/** そのパスが実在するフォルダか。 */
function isExistingDirectory(rootPath: string): boolean {
  try {
    return statSync(rootPath).isDirectory()
  } catch {
    // 存在しない・権限が無い・切断されたネットワークドライブなど。
    // どれも「今は Workspace として使えない」という同じ結論になる。
    return false
  }
}

/**
 * 保存されていた Workspace を復元する（起動後の最初の1回だけ）。
 *
 * **保存されたパスが実在しなくても失敗にしない。** フォルダは削除も移動もされうるし、
 * 外付けドライブなら次に繋いだときには戻っている。落ちる理由にはならないので、
 * 未選択の状態で起動して理由だけを残す。
 *
 * 保存内容は消さない。消してしまうと、一時的に繋がっていないだけのドライブで
 * パスを失う。ディスクにあるのは「次回復元する対象」であって「今開いているもの」ではなく、
 * 次に Workspace を開いた時点で上書きされる。
 */
function ensureRestored(): void {
  if (restored) {
    return
  }
  restored = true

  const lastWorkspace = readWorkspaceFolderDocument()?.lastWorkspace ?? null

  if (lastWorkspace === null) {
    return
  }

  // 保存されたパスも境界の外から来た値として検証する（利用者が手で編集できる場所にある）。
  const rootPath = normalizeWorkspaceRootPath(lastWorkspace.rootPath)

  if (rootPath === null) {
    log.warn('ignored a malformed workspace path in the saved settings.')
    return
  }

  if (!isExistingDirectory(rootPath)) {
    log.info(`the last workspace no longer exists; starting without one: ${rootPath}`)
    unavailableRootPath = rootPath
    return
  }

  current = { ...lastWorkspace, rootPath, exists: true }
}

/** 保存する形へ落とす（exists は「今どうか」なので保存しない）。 */
function toStored(workspace: WorkspaceFolder): StoredWorkspaceFolder {
  return {
    id: workspace.id,
    rootPath: workspace.rootPath,
    displayName: workspace.displayName,
    openedAt: workspace.openedAt
  }
}

function persist(workspace: WorkspaceFolder | null): void {
  saveWorkspaceFolderDocument({
    schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION,
    lastWorkspace: workspace === null ? null : toStored(workspace)
  })
}

/**
 * 今開いている Workspace。
 *
 * Files / Terminal / Git などの Main 側の機能は、パスを引数で受け取るのではなく
 * ここから取る。「どのフォルダを対象に動いているか」の答えを1つに保つため。
 */
export function getCurrentWorkspaceFolder(): WorkspaceFolder | null {
  ensureRestored()
  return current
}

/** 未選択で起動した理由（前回の Workspace が見つからなかった場合）。 */
export function getUnavailableRootPath(): string | null {
  ensureRestored()
  return unavailableRootPath
}

/**
 * フォルダを開く操作の結末。
 *
 * IpcError をここで投げないのは、この層が IPC を知らないため。
 * 失敗の分類（NOT_FOUND など）への翻訳は ipc/handlers/workspaceFolder.ts が持つ。
 */
export type OpenWorkspaceFolderOutcome =
  | { readonly status: 'opened'; readonly workspace: WorkspaceFolder }
  /** パスとして扱えない（絶対パスでない・空・桁違いに長いなど）。 */
  | { readonly status: 'invalid-path' }
  /** パスとしては正しいが、実在するフォルダではない。 */
  | { readonly status: 'not-found' }

/**
 * 指定したフォルダを現在の Workspace にする。
 *
 * 呼び出し元はネイティブのダイアログ（＝実在するフォルダしか返さない）だが、
 * 検証は省かない。将来「最近開いた一覧から開く」を足したときに、
 * 消えたフォルダを開こうとする経路がここに通るため。
 */
export function openWorkspaceFolder(rawRootPath: unknown): OpenWorkspaceFolderOutcome {
  ensureRestored()

  const rootPath = normalizeWorkspaceRootPath(rawRootPath)

  if (rootPath === null) {
    return { status: 'invalid-path' }
  }

  if (!isExistingDirectory(rootPath)) {
    return { status: 'not-found' }
  }

  const workspace: WorkspaceFolder = {
    id: randomUUID(),
    rootPath,
    displayName: deriveWorkspaceDisplayName(rootPath),
    openedAt: Date.now(),
    exists: true
  }

  current = workspace
  unavailableRootPath = null
  persist(workspace)

  log.info(`workspace opened: ${rootPath}`)
  notifyChanged(workspace)

  return { status: 'opened', workspace }
}

/**
 * Workspace を閉じて未選択の状態へ戻す。
 *
 * 保存内容も未選択にする。「閉じたのに次回起動で戻ってくる」のは、
 * 前回の状態で起動するという約束（DESIGN.md §3）に反するため。
 */
export function closeWorkspaceFolder(): void {
  ensureRestored()

  current = null
  unavailableRootPath = null
  persist(null)

  log.info('workspace closed.')
  notifyChanged(null)
}
