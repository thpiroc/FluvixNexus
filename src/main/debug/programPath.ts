import {
  isInsideWorkspace,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath
} from '../files/workspacePath'

/**
 * Debug Profile の `programRelativePath` を、Main の中だけで絶対パスへ解く
 * （Session 6-10。fs は引数で受け取る・テスト対象）。
 *
 * 検証は Files と**同じ2段**（docs/ARCHITECTURE.md §20.9）で、関数も同じものを通す。
 *
 * ```
 * 1段目 … パス文字列として外を指していないか（normalizeWorkspaceRelativePath → resolveWorkspacePath）
 * 2段目 … 実体（realpath）が Workspace root の realpath の中か（isInsideWorkspace）
 * ```
 *
 * ## Breakpoint と違い、realpath を取る
 *
 * main/debug/breakpointSource.ts は realpath を取らない（まだ無いファイルにも印を置ける
 * 必要があり、守るのは「Renderer から任意の場所を指せないこと」だけだから）。
 * program は逆で、**そのファイルが実際に起動される**。Workspace の中にある symlink /
 * ジャンクションが外の実行ファイルを指していれば、文字列の検査は通ってしまう ──
 * readWorkspaceFile.ts が「外の実体の中身を渡さない」ために対象そのものの realpath を
 * 見るのと同じ理由で、ここも対象そのものを見る。
 *
 * ## 保存時と起動時で、無いファイルの扱いが違う
 *
 * ```
 * 保存時（checkDebugProgramPathForSave） … 無ければ通す。在って外を指していれば断る
 * 起動時（resolveDebugProgramPath）      … 在って・ファイルで・実体が中、の全部を要る
 * ```
 *
 * profile はプログラムを書く前に作ることがある。保存時に「在ること」を求めると、
 * それができない。一方で**在るものが外を指していることは保存時にも分かる**ので、
 * そこは断る。起動時は必ず両段を通すので、保存の後にリンクへ差し替えられても起動はしない。
 *
 * 解いた絶対パスは Main の中だけで使う（ResolvedLaunchConfiguration。Renderer へは出ない）。
 */

/** 実体を見るための fs（テストで差し替える）。どちらも同期で、失敗は投げてよい。 */
export interface DebugProgramFileSystem {
  /** realpath まで解決する。無ければ投げる。 */
  readonly realpath: (path: string) => string
  /** それがファイルか（フォルダ・無い・読めないは false）。 */
  readonly isFile: (path: string) => boolean
}

export type DebugProgramPathResolution =
  /** `absolutePath` は検証した realpath（起動に渡すのはこちら）。`rootRealPath` は root の realpath。 */
  | { readonly status: 'ok'; readonly absolutePath: string; readonly rootRealPath: string }
  | { readonly status: 'invalid-path' }
  | { readonly status: 'outside-workspace' }
  | { readonly status: 'not-found' }

/** 起動時の解決。両段を通り、実在するファイルであることまで求める。 */
export function resolveDebugProgramPath(
  rootPath: string,
  rawRelativePath: unknown,
  fileSystem: DebugProgramFileSystem
): DebugProgramPathResolution {
  const absolutePath = resolveByString(rootPath, rawRelativePath)

  if (absolutePath === 'invalid-path' || absolutePath === 'outside-workspace') {
    return { status: absolutePath }
  }

  const rootRealPath = tryRealpath(fileSystem, rootPath)
  const realPath = tryRealpath(fileSystem, absolutePath)

  if (rootRealPath === null || realPath === null) {
    return { status: 'not-found' }
  }

  if (!isInsideWorkspace(rootRealPath, realPath)) {
    return { status: 'outside-workspace' }
  }

  // 検証したのは realpath 側なので、ファイルかどうかも同じものに訊く。
  if (!fileSystem.isFile(realPath)) {
    return { status: 'not-found' }
  }

  return { status: 'ok', absolutePath: realPath, rootRealPath }
}

export type DebugProgramPathSaveCheck = 'ok' | 'invalid-path' | 'outside-workspace'

/**
 * 保存時の検証。1段目は必ず通し、2段目は**実体が在るときだけ**見る。
 *
 * realpath が取れない（無い・権限が無い・root が消えた）ときは通す ── ここで分かるのは
 * 「今は確かめられない」だけで、起動時の解決がもう一度両段を通す。
 */
export function checkDebugProgramPathForSave(
  rootPath: string,
  rawRelativePath: unknown,
  fileSystem: DebugProgramFileSystem
): DebugProgramPathSaveCheck {
  const absolutePath = resolveByString(rootPath, rawRelativePath)

  if (absolutePath === 'invalid-path' || absolutePath === 'outside-workspace') {
    return absolutePath
  }

  const rootRealPath = tryRealpath(fileSystem, rootPath)
  const realPath = tryRealpath(fileSystem, absolutePath)

  if (rootRealPath === null || realPath === null) {
    return 'ok'
  }

  return isInsideWorkspace(rootRealPath, realPath) ? 'ok' : 'outside-workspace'
}

/** 1段目。root そのもの（空文字）はプログラムではないので invalid-path。 */
function resolveByString(
  rootPath: string,
  rawRelativePath: unknown
): string | 'invalid-path' | 'outside-workspace' {
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  if (relativePath === null || relativePath === '') {
    return 'invalid-path'
  }

  return resolveWorkspacePath(rootPath, relativePath) ?? 'outside-workspace'
}

function tryRealpath(fileSystem: DebugProgramFileSystem, path: string): string | null {
  try {
    return fileSystem.realpath(path)
  } catch {
    return null
  }
}
