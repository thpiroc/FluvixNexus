import {
  DEBUG_PROFILES_DOCUMENT_MAX_BYTES,
  DEBUG_PROFILES_MAX_PER_WORKSPACE,
  DEBUG_PROFILES_MAX_WORKSPACES,
  isDebugProfileIdShape,
  type DebugProfile,
  type DebugProfilesDocument,
  type StoredDebugProfileWorkspace
} from '@shared/debug'
import { validateDebugProfileDraft } from '../debug/profileValidation'

/**
 * 保存された Debug Profile 文書の検証（Session 6-10）。
 *
 * このファイルは Electron に依存しない純粋な関数だけを持つ
 * （store/debugBreakpointsDocument.ts と同じ分け方）。Electron の API を使う側は
 * store/debugProfiles.ts。
 *
 * ## 読み込んだ中身も、境界の外から来た値として扱う
 *
 * 保存ファイルは userData 配下にあり、利用者が手で編集できる。**保存時と同じ検証**
 * （main/debug/profileValidation.ts ── 型・長さ・相対位置の1段目・環境変数の方針）を
 * 1件ずつ通し、通らないものはその1件だけを落とす。絶対パスが書き込まれていれば、
 * それが Renderer への一覧に載ることは無い。
 *
 * 相対位置の2段目（realpath）はここでは見ない ── 読み込みのたびにディスクを
 * 触ることになり、起動時の解決（main/debug/programPath.ts）が必ず両段を通すため。
 *
 * ## 1件が壊れても全部を捨てない
 *
 * breakpoint と同じく、壊れた1件だけを落とす。エンベロープ（`schemaVersion` /
 * `workspaces`）が読めない場合だけ文書ごと捨てる。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 1件ぶん。読めなければ null（その1件だけを落とす）。 */
function parseProfile(raw: unknown): DebugProfile | null {
  if (!isRecord(raw) || !isDebugProfileIdShape(raw.profileId)) {
    return null
  }

  const check = validateDebugProfileDraft(raw)

  return check.status === 'ok' ? { ...check.draft, profileId: raw.profileId } : null
}

/** Workspace 1つぶん。1件も読めなければ空として通す（key ごと落とさない）。 */
function parseWorkspace(raw: unknown): StoredDebugProfileWorkspace | null {
  if (!isRecord(raw) || !Array.isArray(raw.profiles)) {
    return null
  }

  const profiles: DebugProfile[] = []
  const seen = new Set<string>()

  for (const candidate of raw.profiles) {
    const profile = parseProfile(candidate)

    // 手で編集されたファイルには同じ id が2つ並びうる。最初の1件だけを残す。
    if (profile === null || seen.has(profile.profileId)) {
      continue
    }

    seen.add(profile.profileId)
    profiles.push(profile)

    if (profiles.length >= DEBUG_PROFILES_MAX_PER_WORKSPACE) {
      break
    }
  }

  const { updatedAt } = raw

  return {
    updatedAt:
      typeof updatedAt === 'number' && Number.isSafeInteger(updatedAt) && updatedAt >= 0
        ? updatedAt
        : 0,
    profiles
  }
}

/**
 * 保存ファイルの内容を、扱ってよい文書として検証する。
 *
 * 想定外なら null を返し、呼び出し側は「保存済みの profile は無い」ものとして扱う。
 */
export function parseDebugProfilesDocument(raw: unknown): DebugProfilesDocument | null {
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

  const candidates = Object.entries(workspaces)
    .map(([rootPath, value]) => ({ rootPath, workspace: parseWorkspace(value) }))
    .filter(
      (candidate): candidate is { rootPath: string; workspace: StoredDebugProfileWorkspace } =>
        candidate.rootPath.length > 0 && candidate.workspace !== null
    )
    .sort((a, b) => b.workspace.updatedAt - a.workspace.updatedAt)
    .slice(0, DEBUG_PROFILES_MAX_WORKSPACES)

  const document: DebugProfilesDocument = {
    schemaVersion,
    workspaces: Object.fromEntries(
      candidates.map((candidate) => [candidate.rootPath, candidate.workspace])
    )
  }

  return isWithinSizeLimit(document) ? document : null
}

function isWithinSizeLimit(document: DebugProfilesDocument): boolean {
  try {
    return JSON.stringify(document).length <= DEBUG_PROFILES_DOCUMENT_MAX_BYTES
  } catch {
    return false
  }
}
