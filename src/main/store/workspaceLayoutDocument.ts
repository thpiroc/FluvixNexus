import {
  WORKSPACE_LAYOUT_DOCUMENT_MAX_BYTES,
  type WorkspaceLayoutDocument
} from '@shared/workspace'

/**
 * 保存された Workspace レイアウト文書の検証。
 *
 * このファイルは Electron に依存しない純粋な関数だけを持つ（store/windowBounds.ts と同じ分け方）。
 * Electron の API を使う側は store/workspaceLayout.ts。
 *
 * **Main が見るのはエンベロープだけ**という線引きがここの要点。
 *
 *   Main が見る    … JSON として読めるか / schemaVersion が正の整数か / layout がオブジェクトか / 大きすぎないか
 *   Renderer が見る … layout の中身（DockNode の木・PanelId・size・タブの並び）
 *
 * レイアウトの意味を知っているのは Renderer だけであり、Main がそれを二重に解釈すると
 * 「どちらが正しいか」が生まれてしまう。Main は保存先と書き込み方に責任を持ち、
 * 中身については「アプリが後で解釈できる形をしているか」だけを確かめる。
 *
 * この検証は読み込み時と保存時の両方で通す。Renderer から届く値も境界の外から来た値として扱い、
 * 想定外の内容をそのままディスクへ書かないようにするため。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 文書としての大きさが妥当か。
 *
 * 保存対象は領域の木だけで、通常は数 KB に収まる。
 * 桁違いに大きい内容は、破損か想定外の使われ方のどちらかとして扱う。
 * （String.length は UTF-16 の要素数だが、上限の目的は「桁違いを弾く」ことなので十分）
 */
function isWithinSizeLimit(document: WorkspaceLayoutDocument): boolean {
  try {
    return JSON.stringify(document).length <= WORKSPACE_LAYOUT_DOCUMENT_MAX_BYTES
  } catch {
    // 循環参照など、そもそも JSON にできない値。
    return false
  }
}

/**
 * 保存ファイル / IPC で受け取った値を、保存してよい文書として検証する。
 *
 * 想定外なら null を返し、呼び出し側は「保存済みレイアウトは無い」ものとして扱う。
 * 戻り値は schemaVersion と layout だけに絞った新しいオブジェクトにする
 * （契約に無いキーが紛れ込んだまま保存され続けないようにするため）。
 */
export function parseWorkspaceLayoutDocument(raw: unknown): WorkspaceLayoutDocument | null {
  if (!isRecord(raw)) {
    return null
  }

  const { schemaVersion, layout } = raw

  // バージョンが読めない文書は、どの形として解釈すればよいか決められない。
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return null
  }

  // 中身の形は Renderer の担当だが、オブジェクトですらないものは通さない。
  if (!isRecord(layout)) {
    return null
  }

  const document: WorkspaceLayoutDocument = { schemaVersion, layout }

  return isWithinSizeLimit(document) ? document : null
}
