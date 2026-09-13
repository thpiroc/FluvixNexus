import { isAbsolute } from 'path'
import type { PlatformId } from '@shared/api'
import type { DebugProfile, DebugProfileLanguage, DebugStartFailure } from '@shared/debug'
import { isInsideWorkspace } from '../files/workspacePath'
import type { FileExistsCheck } from '../platform/executablePath'
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
 * node / csharp は実 adapter を繋ぐ Session が確定させる。
 */

/**
 * launch 構成の `type` と `initialize` の `adapterID`（言語ごとの閉じた表）。
 *
 * VS Code の拡張が使う名前に揃えてある（vscode-js-debug は `pwa-node`・debugpy は
 * `debugpy`・netcoredbg は `coreclr`）。どれも**実 adapter ではまだ確かめていない**。
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
 * node / csharp は実 adapter を繋ぐ Session が決める。
 */
export const DEBUG_LAUNCH_LANGUAGE_OPTIONS: Readonly<
  Record<DebugProfileLanguage, DebugLaunchLanguageOptions>
> = {
  node: {},
  python: { subProcess: false },
  csharp: {}
}

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
  */
  const adapterCwd = context.adapterWorkingDirectory

  if (
    adapterCwd.length === 0 ||
    !isAbsolute(adapterCwd) ||
    isInsideWorkspace(program.rootRealPath, adapterCwd) ||
    isInsideWorkspace(context.workspaceRootPath, adapterCwd)
  ) {
    return failed('adapter-unavailable')
  }

  /*
    5. 組み立て。プログラムの cwd は常に Workspace root（§20.3）で、検証に使った root の
       realpath を使う ── 確かめた場所と起動する場所を同じ手順から出す。
  */
  const cwd = program.rootRealPath
  const type = DEBUG_LAUNCH_TYPES[draft.language]

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
        env: createDebugAdapterProcessEnvironment(context.parentEnv)
      },
      launchArguments: {
        ...DEBUG_LAUNCH_LANGUAGE_OPTIONS[draft.language],
        name: draft.name,
        type,
        request: 'launch',
        program: program.absolutePath,
        args: draft.programArgs,
        cwd,
        env: draft.env,
        stopOnEntry: draft.stopOnEntry,
        console: 'internalConsole'
      }
    }
  }
}

function failed(reason: Exclude<DebugStartFailure, 'spawn-failed'>): DebugProfileResolution {
  return { status: 'failed', reason }
}
