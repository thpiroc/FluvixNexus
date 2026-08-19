import {
  WORKSPACE_FOLDER_DOCUMENT_MAX_BYTES,
  WORKSPACE_FOLDER_SCHEMA_VERSION,
  WORKSPACE_ROOT_PATH_MAX_LENGTH,
  type StoredWorkspaceFolder,
  type WorkspaceFolderDocument
} from '@shared/workspace'

/**
 * 保存された Workspace（開いているプロジェクトフォルダ）文書の検証。
 *
 * このファイルは Electron に依存しない純粋な関数だけを持つ
 * （store/windowBounds.ts / store/workspaceLayoutDocument.ts と同じ分け方）。
 * Electron の API を使う側は store/workspaceFolder.ts。
 *
 * **レイアウト文書との違いは、中身まで Main が見ること。**
 * レイアウトは意味を知っているのが Renderer だけなので Main はエンベロープしか見ないが
 * （store/workspaceLayoutDocument.ts）、Workspace は Main 自身が使う値であり、
 * 中身の判断を任せられる相手が他にいない。
 *
 * 想定外の内容は「保存された Workspace は無い」として扱い、未選択の状態で起動する。
 * 保存ファイルは利用者が手で編集できる場所にあるため、読めることを前提にしない。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

/** 文書としての大きさが妥当か。保存されるのはフォルダ1件で、通常は 1KB にも満たない。 */
function isWithinSizeLimit(document: WorkspaceFolderDocument): boolean {
  try {
    return JSON.stringify(document).length <= WORKSPACE_FOLDER_DOCUMENT_MAX_BYTES
  } catch {
    // 循環参照など、そもそも JSON にできない値。
    return false
  }
}

/**
 * 保存された Workspace 1件を検証する。
 *
 * rootPath が実在するかどうかはここでは見ない（パス文字列としての妥当性だけ）。
 * 実在の確認は復元する時点で行う ── 保存した時点で存在していたことは、
 * 次に起動したときの答えにならないため（workspaceFolder/currentWorkspaceFolder.ts）。
 */
function parseStoredWorkspaceFolder(raw: unknown): StoredWorkspaceFolder | null {
  if (!isRecord(raw)) {
    return null
  }

  const { id, rootPath, displayName, openedAt } = raw

  if (!isNonEmptyString(id, 128)) {
    return null
  }

  if (!isNonEmptyString(rootPath, WORKSPACE_ROOT_PATH_MAX_LENGTH)) {
    return null
  }

  // 表示名は利用者が付け替えられる想定のため、パスとは別に長さの上限を持つ。
  if (!isNonEmptyString(displayName, 256)) {
    return null
  }

  if (typeof openedAt !== 'number' || !Number.isFinite(openedAt) || openedAt < 0) {
    return null
  }

  // 契約に無いキーを持ち回らないよう、必要な項目だけの新しいオブジェクトにする。
  return { id, rootPath, displayName, openedAt }
}

/**
 * 保存ファイルの内容を、扱ってよい文書として検証する。
 *
 * 想定外なら null を返し、呼び出し側は「保存された Workspace は無い」ものとして扱う。
 *
 * schemaVersion は**今の値と一致するものだけ**を受け付ける。レイアウト側が
 * 将来のバージョンも文書として通しているのは、対応の判断を Renderer に委ねているため。
 * こちらは判断する相手がいないので、読めないバージョンはこの場で切り捨てる
 * （形を変えるときは、ここに「1つ前から今の形へ」の変換を足す）。
 */
export function parseWorkspaceFolderDocument(raw: unknown): WorkspaceFolderDocument | null {
  if (!isRecord(raw)) {
    return null
  }

  const { schemaVersion, lastWorkspace } = raw

  if (schemaVersion !== WORKSPACE_FOLDER_SCHEMA_VERSION) {
    return null
  }

  // 「Workspace を閉じた状態」も正しい保存内容なので、null は受け入れる。
  if (lastWorkspace === null || lastWorkspace === undefined) {
    return { schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION, lastWorkspace: null }
  }

  const parsed = parseStoredWorkspaceFolder(lastWorkspace)

  if (parsed === null) {
    return null
  }

  const document: WorkspaceFolderDocument = {
    schemaVersion: WORKSPACE_FOLDER_SCHEMA_VERSION,
    lastWorkspace: parsed
  }

  return isWithinSizeLimit(document) ? document : null
}
