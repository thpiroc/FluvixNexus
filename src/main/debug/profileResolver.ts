import { isAbsolute, posix as posixPath, win32 as windowsPath } from 'path'
import type { PlatformId } from '@shared/api'
import type { DebugProfile, DebugProfileLanguage, DebugStartFailure } from '@shared/debug'
import { isInsideWorkspace } from '../files/workspacePath'
import {
  findExecutableOnPath,
  findInDirectory,
  type FileExistsCheck
} from '../platform/executablePath'
import { resolveDebugAdapterExecutable, type DebugAdapterCatalogEntry } from './adapterCatalog'
import { createDebugAdapterProcessEnvironment } from './environmentPolicy'
import { resolveDebugProgramPath, type DebugProgramFileSystem } from './programPath'
import { validateDebugProfileDraft } from './profileValidation'
import type { DebugLaunchLanguageOptions, ResolvedLaunchConfiguration } from './resolvedLaunch'

/**
 * Debug Profile → ResolvedLaunchConfiguration（Session 6-10。Electron / fs 非依存・テスト対象）。
 *
 * docs/ARCHITECTURE.md §20.2 / §20.6。**STEP 6 で最もテストが効く場所**にあたり、
 * main/git/gitExecutable.ts・main/terminal/shellCommand.ts と同じく、外の世界
 * （PATH の実体・realpath・環境）はすべて引数で受け取る。
 *
 * ```
 * DebugProfile（app-domain の7欄）
 *   ├ 欄の検証をもう一度      … profileValidation.ts（環境変数の方針を含む。保存時に通っていても見る）
 *   ├ program → 絶対パス      … programPath.ts（2段。実在するファイルで、実体が Workspace の中）
 *   ├ 言語 → adapter の行     … adapterCatalog.ts（integrated の行だけ）
 *   ├ adapter → 絶対パス      … PATH を辿る（Workspace の中は探さない）
 *   ├ cwd                     … Workspace root（realpath）
 *   ├ adapter の環境          … 親の環境から Electron 由来の2つを落とす
 *   └ launch request の引数   … 言語ごとの `type` の表 + profile の欄
 * ```
 *
 * **Renderer はこの変換を1段も知らない。** `debug:start` に載るのは `profileId` だけで、
 * ここで作った形は IPC に載らない（resolvedLaunch.ts）。
 *
 * ## 言語ごとの違いはここに閉じる
 *
 * 言語ごとの launch 構成の違い（`type` と、固定で足す欄）はこのファイルの表にあり、Renderer には
 * 現れない（§20.10）。python の行は Session 6-12 で実 debugpy に当てて確定させた。
 * csharp の行は Session 6-14 で実 netcoredbg に当てて確定させた。
 * node は実 adapter を繋ぐ Session が確定させる。
 */

/**
 * launch 構成の `type` と `initialize` の `adapterID`（言語ごとの閉じた表）。
 *
 * VS Code の拡張が使う名前に揃えてある（vscode-js-debug は `pwa-node`・debugpy は
 * `debugpy`・netcoredbg は `coreclr`）。debugpy と netcoredbg は実 adapter で確かめた。
 */
export const DEBUG_LAUNCH_TYPES: Readonly<Record<DebugProfileLanguage, string>> = {
  node: 'pwa-node',
  python: 'debugpy',
  csharp: 'coreclr'
}

/**
 * 言語ごとに launch request へ足す固定の欄（Session 6-12。閉じた表）。
 *
 * python は実 debugpy（1.8.21）で確かめた値。`type: 'debugpy'` もそのまま通った。
 * csharp は実 netcoredbg（3.2.0-1）で追加の固定欄なしに通った。
 * node は実 adapter を繋ぐ Session が決める。
 */
export const DEBUG_LAUNCH_LANGUAGE_OPTIONS: Readonly<
  Record<DebugProfileLanguage, DebugLaunchLanguageOptions>
> = {
  node: {},
  python: { subProcess: false },
  csharp: {}
}

/**
 * 例外で止まる条件（Session 6-13。言語ごとの閉じた表）。
 *
 * v1 は **「捕まえられなかった例外でだけ止まる」の1通り**で、設定の欄は作らない。
 * python は実 debugpy 1.8.21 で3つの filter を比べて `uncaught` だけにした:
 *
 * | filter          | 実際の振る舞い                                                                        |
 * | --------------- | ------------------------------------------------------------------------------------- |
 * | `uncaught`      | 捕まえられなかった例外の raise の位置で1回だけ止まる。`try` で捕まえた例外では止まらない |
 * | `raised`        | 捕まえた例外でも止まり、捕まえられなかった例外は呼び出しを遡りながら何度も止まる       |
 * | `userUnhandled` | 型名に adapter の注記（`(note: full exception trace is shown …)`）が混ざる            |
 *
 * csharp は実 netcoredbg 3.2.0-1 で `user-unhandled` が未処理例外の raise 位置で止まり、
 * `exceptionInfo` まで返ることを確かめた。node は未統合なので空（何も送らない）。
 */
export const DEBUG_EXCEPTION_BREAKPOINT_FILTERS: Readonly<
  Record<DebugProfileLanguage, readonly string[]>
> = {
  node: [],
  python: ['uncaught'],
  csharp: ['user-unhandled']
}

const WINDOWS_DOTNET_DIRECTORIES = ['C:\\Program Files\\dotnet', 'C:\\Program Files (x86)\\dotnet']

export interface DebugProfileResolverContext {
  /** 今の Workspace root（currentWorkspaceFolder の値。realpath は中で取る）。 */
  readonly workspaceRootPath: string
  readonly platform: PlatformId
  /** 親（Main）の環境。PATH を辿るのと、adapter のプロセスの環境の元にするのに使う。 */
  readonly parentEnv: Readonly<Record<string, string | undefined>>
  /** adapter の実行ファイルの実体があるか。 */
  readonly exists: FileExistsCheck
  /** program の realpath / ファイルかどうか。 */
  readonly fileSystem: DebugProgramFileSystem
  /** 言語 → catalog の行（既定は adapterCatalog.ts の表）。 */
  readonly getCatalogEntry: (language: DebugProfileLanguage) => DebugAdapterCatalogEntry
  /**
   * adapter のプロセスの cwd（Session 6-12）。Main が持つ **Workspace の外**のフォルダ
   * （既定は userData）。Renderer から来る値ではない。
   */
  readonly adapterWorkingDirectory: string
}

export type DebugProfileResolution =
  | { readonly status: 'resolved'; readonly configuration: ResolvedLaunchConfiguration }
  | { readonly status: 'failed'; readonly reason: Exclude<DebugStartFailure, 'spawn-failed'> }

export function resolveDebugProfile(
  profile: DebugProfile,
  context: DebugProfileResolverContext
): DebugProfileResolution {
  /*
    1. 欄の検証をもう一度（§20.9「断る場所は保存時と解決時の両方」）。
       保存ファイルは手で編集でき、方針の表は後の版で増えうる。検証を通った
       作り直しの値（draft）だけを以降で使う ── profile に余計な欄が付いていても届かない。
  */
  const check = validateDebugProfileDraft(profile)

  if (check.status !== 'ok') {
    return failed('invalid-profile')
  }

  const draft = check.draft

  // 2. 対象のプログラム。起動時は両段を通し、実在するファイルであることまで求める。
  const program = resolveDebugProgramPath(
    context.workspaceRootPath,
    draft.programRelativePath,
    context.fileSystem
  )

  switch (program.status) {
    case 'invalid-path':
      return failed('invalid-profile')

    case 'outside-workspace':
      return failed('program-outside-workspace')

    case 'not-found':
      return failed('program-not-found')

    case 'ok':
      break
  }

  // 3. adapter。行き先は `language`（閉じた集合）だけで決まる。
  const entry = context.getCatalogEntry(draft.language)

  if (entry.language !== draft.language) {
    return failed('adapter-unavailable')
  }

  const executable = resolveDebugAdapterExecutable(
    entry,
    context.platform,
    context.parentEnv,
    context.exists
  )

  if (executable === null) {
    return failed('adapter-unavailable')
  }

  /*
    4. adapter のプロセスの cwd（Session 6-12。§20.20）。**Workspace の外でなければ起動しない。**
       `python -m debugpy.adapter` は cwd を sys.path の先頭に置くため、cwd が Workspace だと
       Workspace の中の `debugpy/` が本物の adapter の代わりに読み込まれる（実 debugpy で確認）。
       プログラムの cwd（launch の `cwd`）はこれとは別で、Workspace root のまま。

       C# / netcoredbg は Windows x64 版（3.2.0-1092 / 3.1.3-1062）で Unicode path を渡すと
       `configurationDone` が 0x80004005 になり、CLI でも path が `???` に崩れることを確認した。
       Workspace を移したり複製したりはせず、Main が安全に決められる adapter cwd だけを
       netcoredbg.exe のある ASCII-only のフォルダへ寄せる。
  */
  const adapterCwd = resolveAdapterWorkingDirectory(
    draft.language,
    executable.file,
    program.rootRealPath,
    context
  )

  if (adapterCwd === null) {
    return failed('adapter-unavailable')
  }

  const csharpLaunch = resolveCsharpLaunch(draft.language, program, context, executable)

  if (csharpLaunch.status === 'invalid-profile') {
    return failed('invalid-profile')
  }

  if (csharpLaunch.status === 'adapter-unavailable') {
    return failed('adapter-unavailable')
  }

  /*
    5. 組み立て。プログラムの cwd は常に Workspace root（§20.3）で、検証に使った root の
       realpath を使う ── 確かめた場所と起動する場所を同じ手順から出す。
  */
  const cwd = program.rootRealPath
  const type = DEBUG_LAUNCH_TYPES[draft.language]
  const stopAtEntry =
    draft.language === 'csharp' ? ({ stopAtEntry: draft.stopOnEntry } as const) : {}
  const stopOnEntry =
    draft.language === 'csharp' ? {} : ({ stopOnEntry: draft.stopOnEntry } as const)
  const launchProgram =
    csharpLaunch.status === 'ok' ? csharpLaunch.runtimeExecutable : program.absolutePath
  const launchArgs =
    csharpLaunch.status === 'ok' ? [program.absolutePath, ...draft.programArgs] : draft.programArgs
  /*
    繋ぎ方と子セッションの受け方（Session 6-15A）は catalog の行がそのまま決める。
    行が持たなければ欄ごと載せない ── 6-14 までの解決済みの形と1欄も変わらない。
  */
  const transport = entry.adapter?.transport
  const childSessions = entry.adapter?.childSessions

  return {
    status: 'resolved',
    configuration: {
      profileId: profile.profileId,
      language: draft.language,
      adapterId: type,
      adapterCommand: {
        name: entry.name,
        file: executable.file,
        args: executable.args,
        cwd: adapterCwd,
        env: createDebugAdapterProcessEnvironment(context.parentEnv),
        ...(transport === undefined ? {} : { transport })
      },
      launchArguments: {
        ...DEBUG_LAUNCH_LANGUAGE_OPTIONS[draft.language],
        ...stopAtEntry,
        name: draft.name,
        type,
        request: 'launch',
        program: launchProgram,
        args: launchArgs,
        cwd,
        env: draft.env,
        ...stopOnEntry,
        console: 'internalConsole'
      },
      waitForLaunchResponseBeforeConfiguration: draft.language === 'csharp',
      exceptionBreakpointFilters: DEBUG_EXCEPTION_BREAKPOINT_FILTERS[draft.language],
      ...(childSessions === undefined
        ? {}
        : { childSessions: { launchType: type, targetIdKey: childSessions.targetIdKey } })
    }
  }
}

function failed(reason: Exclude<DebugStartFailure, 'spawn-failed'>): DebugProfileResolution {
  return { status: 'failed', reason }
}

function resolveAdapterWorkingDirectory(
  language: DebugProfileLanguage,
  adapterExecutablePath: string,
  workspaceRootRealPath: string,
  context: DebugProfileResolverContext
): string | null {
  const adapterCwd =
    language === 'csharp'
      ? dirnameForPlatform(adapterExecutablePath, context.platform)
      : context.adapterWorkingDirectory

  if (
    adapterCwd.length === 0 ||
    !isAbsolute(adapterCwd) ||
    isInsideWorkspace(workspaceRootRealPath, adapterCwd) ||
    isInsideWorkspace(context.workspaceRootPath, adapterCwd)
  ) {
    return null
  }

  if (language === 'csharp' && !isAsciiOnlyPath(adapterCwd)) {
    return null
  }

  return adapterCwd
}

type CsharpLaunchResolution =
  | { readonly status: 'not-csharp' }
  | { readonly status: 'ok'; readonly runtimeExecutable: string }
  | { readonly status: 'invalid-profile' }
  | { readonly status: 'adapter-unavailable' }

function resolveCsharpLaunch(
  language: DebugProfileLanguage,
  program: { readonly absolutePath: string; readonly rootRealPath: string },
  context: DebugProfileResolverContext,
  adapterExecutable: { readonly file: string; readonly args: readonly string[] }
): CsharpLaunchResolution {
  if (language !== 'csharp') {
    return { status: 'not-csharp' }
  }

  if (extensionForPlatform(program.absolutePath, context.platform).toLowerCase() !== '.dll') {
    return { status: 'invalid-profile' }
  }

  const runtimeExecutable = resolveDotnetExecutable(
    context.platform,
    context.parentEnv,
    context.exists
  )

  if (runtimeExecutable === null) {
    return { status: 'adapter-unavailable' }
  }

  const netcoredbgVisiblePaths = [
    adapterExecutable.file,
    ...adapterExecutable.args,
    runtimeExecutable,
    program.absolutePath,
    program.rootRealPath
  ]

  if (!netcoredbgVisiblePaths.every(isAsciiOnlyPath)) {
    return { status: 'adapter-unavailable' }
  }

  return { status: 'ok', runtimeExecutable }
}

function resolveDotnetExecutable(
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): string | null {
  if (platform !== 'win32') {
    return findExecutableOnPath(['dotnet'], platform, env, exists)
  }

  for (const directory of WINDOWS_DOTNET_DIRECTORIES) {
    const found = findInDirectory(directory, ['dotnet.exe'], platform, exists)

    if (found !== null) {
      return found
    }
  }

  return findExecutableOnPath(['dotnet.exe'], platform, env, exists)
}

function dirnameForPlatform(path: string, platform: PlatformId): string {
  return platform === 'win32' ? windowsPath.dirname(path) : posixPath.dirname(path)
}

function extensionForPlatform(path: string, platform: PlatformId): string {
  return platform === 'win32' ? windowsPath.extname(path) : posixPath.extname(path)
}

function isAsciiOnlyPath(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) > 0x7f) {
      return false
    }
  }

  return true
}
