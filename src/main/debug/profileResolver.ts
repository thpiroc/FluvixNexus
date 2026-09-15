import { isAbsolute, posix as posixPath, win32 as windowsPath } from 'path'
import type { PlatformId } from '@shared/api'
import type {
  DebugAdapterUnavailableCause,
  DebugProfile,
  DebugProfileLanguage,
  DebugStartFailure
} from '@shared/debug'
import { isInsideWorkspace } from '../files/workspacePath'
import {
  findExecutableOnPath,
  findInDirectory,
  type FileExistsCheck
} from '../platform/executablePath'
import type { DebugAdapterArtifactId, DebugAdapterArtifactVerification } from './adapterArtifact'
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
 * node の行は Session 6-15B で実 vscode-js-debug（1.117.0）に当てて確定させた（§20.24）。
 */

/**
 * launch 構成の `type` と `initialize` の `adapterID`（言語ごとの閉じた表）。
 *
 * VS Code の拡張が使う名前に揃えてある（vscode-js-debug は `pwa-node`・debugpy は
 * `debugpy`・netcoredbg は `coreclr`）。3つとも実 adapter で確かめた。
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
 * node は実 vscode-js-debug（1.117.0）で確かめた値（resolvedLaunch.ts の各欄の説明）。
 */
export const DEBUG_LAUNCH_LANGUAGE_OPTIONS: Readonly<
  Record<DebugProfileLanguage, DebugLaunchLanguageOptions>
> = {
  node: {
    sourceMaps: false,
    outFiles: [],
    autoAttachChildProcesses: false,
    outputCapture: 'std'
  },
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
 * `exceptionInfo` まで返ることを確かめた。node は実 vscode-js-debug 1.117.0 で `uncaught` が
 * 捕まえられなかった例外の throw の位置で1回だけ止まり（`try` で捕まえた例外では止まらない）、
 * `exceptionInfo` まで返ることを確かめた（`all` は捕まえた例外でも止まる）。
 */
export const DEBUG_EXCEPTION_BREAKPOINT_FILTERS: Readonly<
  Record<DebugProfileLanguage, readonly string[]>
> = {
  node: ['uncaught'],
  python: ['uncaught'],
  csharp: ['user-unhandled']
}

const WINDOWS_DOTNET_DIRECTORIES = ['C:\\Program Files\\dotnet', 'C:\\Program Files (x86)\\dotnet']

/**
 * node の profile で走らせてよいプログラムの拡張子（Session 6-15B。v1 は JavaScript だけ）。
 *
 * TypeScript（`.ts` / `.mts` / `.cts`）は source map と build の段取りが要るので v1 では断る。
 */
export const NODE_DEBUG_PROGRAM_EXTENSIONS: readonly string[] = ['.js', '.mjs', '.cjs']

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
  /**
   * catalog の行が名乗る配布物を、pin した中身と突き合わせる（Session 6-15B。adapterArtifact.ts）。
   *
   * 置き場所は Main が決める（userData の下）。`verified` 以外なら起動しない。
   */
  readonly resolveAdapterArtifact: (
    artifact: DebugAdapterArtifactId
  ) => DebugAdapterArtifactVerification
}

export type DebugProfileResolution =
  | { readonly status: 'resolved'; readonly configuration: ResolvedLaunchConfiguration }
  | {
      readonly status: 'failed'
      readonly reason: Exclude<DebugStartFailure, 'spawn-failed' | 'adapter-unavailable'>
    }
  | {
      readonly status: 'failed'
      readonly reason: 'adapter-unavailable'
      readonly language: DebugProfileLanguage
      /** 閉じた集合の分類だけ（Session 7-1C）。どのパスが原因だったかは載せない。 */
      readonly cause: DebugAdapterUnavailableCause
    }

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
    return adapterUnavailable(draft.language, 'not-integrated')
  }

  const executable = resolveDebugAdapterExecutable(
    entry,
    context.platform,
    context.parentEnv,
    context.exists
  )

  if (executable === null) {
    /*
      行が起動するものを持っていれば、見つからなかったのは PATH の実行ファイル（Session 7-1C）。
      node / python ではそれが runtime そのもの、csharp では adapter（netcoredbg）にあたる。
    */
    if (entry.integrationStatus !== 'integrated' || entry.adapter === undefined) {
      return adapterUnavailable(draft.language, 'not-integrated')
    }

    return adapterUnavailable(
      draft.language,
      draft.language === 'csharp' ? 'adapter-not-found' : 'runtime-not-found'
    )
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

  if (adapterCwd.status === 'unavailable') {
    return adapterUnavailable(draft.language, adapterCwd.cause)
  }

  const csharpLaunch = resolveCsharpLaunch(draft.language, program, context, executable)

  if (csharpLaunch.status === 'invalid-profile') {
    return failed('invalid-profile')
  }

  if (csharpLaunch.status === 'adapter-unavailable') {
    return adapterUnavailable(draft.language, csharpLaunch.cause)
  }

  const nodeLaunch = resolveNodeLaunch(draft.language, entry, program, context, executable)

  if (nodeLaunch.status === 'invalid-profile') {
    return failed('invalid-profile')
  }

  if (nodeLaunch.status === 'adapter-unavailable') {
    return adapterUnavailable(draft.language, nodeLaunch.cause)
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
  /*
    node（Session 6-15B）: adapter の引数の前に、確かめた配布物の入り口の script を置く。
    debuggee は adapter と同じ node.exe で起こす（launch の `runtimeExecutable`）。
  */
  const adapterArgs =
    nodeLaunch.status === 'ok' && nodeLaunch.artifactEntryPath !== null
      ? [nodeLaunch.artifactEntryPath, ...executable.args]
      : executable.args
  const runtimeExecutable =
    nodeLaunch.status === 'ok' ? ({ runtimeExecutable: nodeLaunch.runtimeExecutable } as const) : {}

  return {
    status: 'resolved',
    configuration: {
      profileId: profile.profileId,
      language: draft.language,
      adapterId: type,
      adapterCommand: {
        name: entry.name,
        file: executable.file,
        args: adapterArgs,
        cwd: adapterCwd.path,
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
        ...runtimeExecutable,
        console: 'internalConsole'
      },
      waitForLaunchResponseBeforeConfiguration: draft.language === 'csharp',
      exceptionBreakpointFilters: DEBUG_EXCEPTION_BREAKPOINT_FILTERS[draft.language],
      ...(childSessions === undefined
        ? {}
        : {
            childSessions: {
              launchType: type,
              targetIdKey: childSessions.targetIdKey,
              ...(childSessions.rootOutputCategories === undefined
                ? {}
                : { rootOutputCategories: childSessions.rootOutputCategories })
            }
          })
    }
  }
}

type NodeLaunchResolution =
  | { readonly status: 'not-node' }
  | {
      readonly status: 'ok'
      /** debuggee を起こす node.exe（adapter と同じ絶対パス）。 */
      readonly runtimeExecutable: string
      /** 確かめた配布物の入り口の script。行が配布物を名乗らなければ null。 */
      readonly artifactEntryPath: string | null
    }
  | { readonly status: 'invalid-profile' }
  | { readonly status: 'adapter-unavailable'; readonly cause: DebugAdapterUnavailableCause }

/**
 * node の起動に要るものを確かめる（Session 6-15B。§20.24）。
 *
 * ```
 * プログラム … .js / .mjs / .cjs だけ（TypeScript は v1 の外）
 * runtime   … adapter として PATH から解いた node.exe。実体（realpath）も含めて Workspace の外
 * 配布物    … pin した tree hash と一致したときだけ。入り口の script も Workspace の外
 * ```
 *
 * runtime を Workspace の中に許さないのは、`node_modules/.bin` のようなフォルダを PATH に足した
 * 環境で、clone してきたリポジトリの `node.exe` が adapter と debuggee の両方として動くため。
 */
function resolveNodeLaunch(
  language: DebugProfileLanguage,
  entry: DebugAdapterCatalogEntry,
  program: { readonly absolutePath: string; readonly rootRealPath: string },
  context: DebugProfileResolverContext,
  adapterExecutable: { readonly file: string }
): NodeLaunchResolution {
  if (language !== 'node') {
    return { status: 'not-node' }
  }

  const extension = extensionForPlatform(program.absolutePath, context.platform).toLowerCase()

  if (!NODE_DEBUG_PROGRAM_EXTENSIONS.includes(extension)) {
    return { status: 'invalid-profile' }
  }

  const runtime = adapterExecutable.file

  if (isInsideEitherWorkspaceRoot(runtime, program.rootRealPath, context)) {
    return { status: 'adapter-unavailable', cause: 'runtime-inside-workspace' }
  }

  let runtimeRealPath: string

  try {
    runtimeRealPath = context.fileSystem.realpath(runtime)
  } catch {
    return { status: 'adapter-unavailable', cause: 'runtime-not-found' }
  }

  if (isInsideEitherWorkspaceRoot(runtimeRealPath, program.rootRealPath, context)) {
    return { status: 'adapter-unavailable', cause: 'runtime-inside-workspace' }
  }

  const artifactId = entry.adapter?.artifact

  if (artifactId === undefined) {
    return { status: 'ok', runtimeExecutable: runtime, artifactEntryPath: null }
  }

  const artifact = context.resolveAdapterArtifact(artifactId)

  // 置かれていない（missing）と、置かれているが pin と違う（invalid / hash-mismatch）は準備の仕方が違う。
  if (artifact.status === 'missing') {
    return { status: 'adapter-unavailable', cause: 'adapter-not-found' }
  }

  if (artifact.status !== 'verified') {
    return { status: 'adapter-unavailable', cause: 'adapter-not-verified' }
  }

  if (
    !isAbsolute(artifact.entryPath) ||
    isInsideEitherWorkspaceRoot(artifact.entryPath, program.rootRealPath, context)
  ) {
    return { status: 'adapter-unavailable', cause: 'adapter-inside-workspace' }
  }

  return { status: 'ok', runtimeExecutable: runtime, artifactEntryPath: artifact.entryPath }
}

function isInsideEitherWorkspaceRoot(
  path: string,
  workspaceRootRealPath: string,
  context: DebugProfileResolverContext
): boolean {
  return (
    isInsideWorkspace(workspaceRootRealPath, path) ||
    isInsideWorkspace(context.workspaceRootPath, path)
  )
}

function failed(
  reason: Exclude<DebugStartFailure, 'spawn-failed' | 'adapter-unavailable'>
): DebugProfileResolution {
  return { status: 'failed', reason }
}

function adapterUnavailable(
  language: DebugProfileLanguage,
  cause: DebugAdapterUnavailableCause
): DebugProfileResolution {
  return { status: 'failed', reason: 'adapter-unavailable', language, cause }
}

type AdapterWorkingDirectoryResolution =
  | { readonly status: 'ok'; readonly path: string }
  | { readonly status: 'unavailable'; readonly cause: DebugAdapterUnavailableCause }

function resolveAdapterWorkingDirectory(
  language: DebugProfileLanguage,
  adapterExecutablePath: string,
  workspaceRootRealPath: string,
  context: DebugProfileResolverContext
): AdapterWorkingDirectoryResolution {
  const adapterCwd =
    language === 'csharp'
      ? dirnameForPlatform(adapterExecutablePath, context.platform)
      : context.adapterWorkingDirectory

  /*
    空 / 相対は Main の組み立ての誤りで、利用者が直せるものではない。出荷状態では userData と
    netcoredbg のフォルダ（どちらも絶対パス）しか来ないため、現実に起きるのは「Workspace の中」になる。
  */
  if (
    adapterCwd.length === 0 ||
    !isAbsolute(adapterCwd) ||
    isInsideWorkspace(workspaceRootRealPath, adapterCwd) ||
    isInsideWorkspace(context.workspaceRootPath, adapterCwd)
  ) {
    return { status: 'unavailable', cause: 'adapter-inside-workspace' }
  }

  if (language === 'csharp' && !isAsciiOnlyPath(adapterCwd)) {
    return { status: 'unavailable', cause: 'non-ascii-path' }
  }

  return { status: 'ok', path: adapterCwd }
}

type CsharpLaunchResolution =
  | { readonly status: 'not-csharp' }
  | { readonly status: 'ok'; readonly runtimeExecutable: string }
  | { readonly status: 'invalid-profile' }
  | { readonly status: 'adapter-unavailable'; readonly cause: DebugAdapterUnavailableCause }

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
    return { status: 'adapter-unavailable', cause: 'runtime-not-found' }
  }

  const netcoredbgVisiblePaths = [
    adapterExecutable.file,
    ...adapterExecutable.args,
    runtimeExecutable,
    program.absolutePath,
    program.rootRealPath
  ]

  if (!netcoredbgVisiblePaths.every(isAsciiOnlyPath)) {
    return { status: 'adapter-unavailable', cause: 'non-ascii-path' }
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
