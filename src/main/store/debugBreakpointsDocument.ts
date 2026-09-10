import {
  DEBUG_BREAKPOINTS_DOCUMENT_MAX_BYTES,
  DEBUG_BREAKPOINTS_MAX_WORKSPACES,
  DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE,
  isDebugBreakpointLine,
  type DebugBreakpointsDocument,
  type StoredDebugBreakpointEntry,
  type StoredDebugBreakpointWorkspace
} from '@shared/debug'

/**
 * 保存された Breakpoint 文書の検証。
 *
 * このファイルは Electron に依存しない純粋な関数だけを持つ
 * （store/workspaceFolderDocument.ts と同じ分け方）。Electron の API を使う側は
 * store/debugBreakpoints.ts。
 *
 * ## ここは中身まで見る
 *
 * レイアウト（store/workspaceLayoutDocument.ts）では Main は**エンベロープだけ**を
 * 見て、中身の意味は Renderer に任せていた。breakpoint は逆で、**中身の意味を
 * 知っているのは Main の側**になる ── 相対位置を絶対パスへ落とし、adapter へ
 * 送るのは Main だからにほかならない。したがって Workspace 文書
 * （store/workspaceFolderDocument.ts）と同じく、1件ずつ形を確かめる。
 *
 * ## 1件が壊れても全部を捨てない
 *
 * 読めない breakpoint はその1件だけを落とし、残りは通す（設定の section と同じ扱い。
 * store/settingsSections.ts）。**印が1つ壊れていたせいで全部消える**のは、
 * 保存ファイルを手で触った利用者にとって一番困る結末になる。
 *
 * ただしエンベロープ（`schemaVersion` / `workspaces`）が読めない場合は文書ごと
 * 捨てる ── どの形として解釈すればよいかが決まらないため。
 *
 * ## 相対位置の中身までは見ない
 *
 * `..` や絶対パスを断つのはここではなく、読み込んだ後の
 * main/debug/breakpointSource.ts になる。**Workspace の境界を判断する関数を
 * 1つに保つ**ためで、ここが見るのは「文字列か・空でないか・桁違いでないか」までに留める。
 */

const RELATIVE_PATH_MAX_LENGTH = 4096

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 1件ぶん。読めなければ null（その1件だけを落とす）。 */
function parseEntry(raw: unknown): StoredDebugBreakpointEntry | null {
  if (!isRecord(raw)) {
    return null
  }

  const { relativePath, line, enabled } = raw

  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.length > RELATIVE_PATH_MAX_LENGTH
  ) {
    return null
  }

  if (!isDebugBreakpointLine(line)) {
    return null
  }

  /*
    `enabled` が欠けている / 真偽値でない場合は true として読む。
    無効として読むと、**保存ファイルが少し古いだけで印が黙って効かなくなる**
    ── 有効側を既定にしておけば、最悪でも「無効にしたはずのものが効く」で済み、
    それは画面から見て分かる。
  */
  return { relativePath, line, enabled: typeof enabled === 'boolean' ? enabled : true }
}

/** Workspace 1つぶん。1件も読めなければ空として通す（key ごと落とさない）。 */
function parseWorkspace(raw: unknown): StoredDebugBreakpointWorkspace | null {
  if (!isRecord(raw)) {
    return null
  }

  const { updatedAt, breakpoints } = raw

  if (!Array.isArray(breakpoints)) {
    return null
  }

  const entries: StoredDebugBreakpointEntry[] = []
  const seen = new Set<string>()

  for (const candidate of breakpoints) {
    const entry = parseEntry(candidate)

    if (entry === null) {
      continue
    }

    // 手で編集されたファイルには同じ位置が2つ並びうる。読み込みの時点で畳む。
    const key = `${entry.relativePath} ${String(entry.line)}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    entries.push(entry)

    if (entries.length >= DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE) {
      break
    }
  }

  return {
    updatedAt:
      typeof updatedAt === 'number' && Number.isSafeInteger(updatedAt) && updatedAt >= 0
        ? updatedAt
        : 0,
    breakpoints: entries
  }
}

/**
 * 保存ファイルの内容を、扱ってよい文書として検証する。
 *
 * 想定外なら null を返し、呼び出し側は「保存済みの breakpoint は無い」ものとして扱う。
 * 戻り値は `schemaVersion` と `workspaces` だけに絞った新しいオブジェクトにする
 * （契約に無い key が紛れ込んだまま保存され続けないようにするため）。
 */
export function parseDebugBreakpointsDocument(raw: unknown): DebugBreakpointsDocument | null {
  if (!isRecord(raw)) {
    return null
  }

  const { schemaVersion, workspaces } = raw

  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return null
  }

  if (!isRecord(workspaces)) {
    return null
  }

  const parsed: Record<string, StoredDebugBreakpointWorkspace> = {}

  /*
    新しいものから順に残す。上限に当たったときに落ちるのが**最も古い Workspace**に
    なるよう、`updatedAt` の降順で並べてから切る。
  */
  const candidates = Object.entries(workspaces)
    .map(([rootPath, value]) => ({ rootPath, workspace: parseWorkspace(value) }))
    .filter(
      (candidate): candidate is { rootPath: string; workspace: StoredDebugBreakpointWorkspace } =>
        candidate.rootPath.length > 0 && candidate.workspace !== null
    )
    .sort((a, b) => b.workspace.updatedAt - a.workspace.updatedAt)
    .slice(0, DEBUG_BREAKPOINTS_MAX_WORKSPACES)

  for (const candidate of candidates) {
    parsed[candidate.rootPath] = candidate.workspace
  }

  const document: DebugBreakpointsDocument = { schemaVersion, workspaces: parsed }

  return isWithinSizeLimit(document) ? document : null
}

/**
 * 文書としての大きさが妥当か。
 *
 * 上限まで詰まっていても数百 KB に収まる（shared/debug/breakpointDocument.ts）。
 * 桁違いに大きい内容は、破損か想定外の使われ方のどちらかとして扱う。
 */
function isWithinSizeLimit(document: DebugBreakpointsDocument): boolean {
  try {
    return JSON.stringify(document).length <= DEBUG_BREAKPOINTS_DOCUMENT_MAX_BYTES
  } catch {
    // 循環参照など、そもそも JSON にできない値。
    return false
  }
}
