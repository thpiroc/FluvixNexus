import { createHash } from 'crypto'
import { join } from 'path'

/**
 * Debug Adapter の配布物（artifact）を pin して確かめる（Session 6-15B。Electron 非依存・テスト対象）。
 *
 * docs/ARCHITECTURE.md §20.24。python / csharp の adapter は PATH に在る実行ファイル（§20.7）だが、
 * vscode-js-debug は **Node で走らせる JavaScript の束**で、PATH に置くものではない。
 * そこで「どの版の、どの中身を走らせるか」を Main の表で固定し、起動のたびに実物と突き合わせる。
 *
 * ```
 * 置き場所 … <userData>/debug-adapters/<installDirectoryName>/<rootDirectoryName>
 *            Main が決める Workspace の外。Renderer から来る値も、Workspace の中も見ない
 * 中身     … 置き場所の下の全ファイルの tree hash が表の値と一致したときだけ使う
 * ```
 *
 * ## tree hash
 *
 * 置き場所の下の全ファイルを `/` 区切りの相対位置で並べ（UTF-16 の code unit 順）、
 * 1行ずつ `<ファイルの SHA-256>  <相対位置>\n` を連ねたものの SHA-256。`sha256sum` の出力を
 * 並べ替えて hash したものと同じ形で、DEVELOPMENT.md の手順で手元でも再計算できる。
 *
 * **入り口の script 1つだけを hash しない。** dapDebugServer.js はデバッグ対象のプロセスへ
 * `bootloader.js` を `--require` で読み込ませ、`watchdog.js` を別プロセスで起こす ── 走るのは
 * 束全体なので、ファイルが1つ増えても1バイト変わっても使わない。
 *
 * ## 断るもの
 *
 * - 置き場所が無い（`missing`）
 * - 置き場所・途中のフォルダ・ファイルが symlink / ジャンクション、ファイルでもフォルダでもない、
 *   深すぎる、読めない（`invalid`）
 * - ファイルの数・合計の大きさ・tree hash のどれかが表と違う（`hash-mismatch`）。数と大きさは
 *   hash を取る前に上限として使い、表より大きな木を読み切らない
 *
 * 結果は Main のログにだけ理由を残し、Renderer へは `adapter-unavailable` の分類だけが届く
 * （profileResolver.ts）。置き場所のパスはこのファイルと Main のログの外へ出ない。
 */

export type DebugAdapterArtifactId = 'vscode-js-debug'

export interface DebugAdapterArtifact {
  readonly id: DebugAdapterArtifactId
  /** 版（表示もしない。ログと docs で追うためのもの）。 */
  readonly version: string
  /** 入手元（公式 GitHub Release の asset）。Main はここから取りに行かない。 */
  readonly source: {
    readonly repository: string
    readonly releaseTag: string
    readonly assetName: string
    readonly url: string
    /** release asset（tar.gz）そのものの SHA-256。展開する前に手で確かめる値。 */
    readonly sha256: string
  }
  readonly license: string
  /** `debug-adapters` の下のフォルダの名前（版ごとに分ける）。 */
  readonly installDirectoryName: string
  /** 展開したときに asset が作るフォルダの名前。 */
  readonly rootDirectoryName: string
  /** 入り口の script（root からの `/` 区切りの相対位置）。 */
  readonly entryRelativePath: string
  /** 展開した木の中身（上の「tree hash」）。起動のたびにこれと突き合わせる。 */
  readonly tree: {
    readonly sha256: string
    readonly fileCount: number
    readonly totalBytes: number
  }
}

/** userData の下の、adapter の配布物を置くフォルダの名前。 */
export const DEBUG_ADAPTER_ARTIFACTS_DIRECTORY_NAME = 'debug-adapters'

/** 木を辿る深さの上限（asset の実物は3段）。 */
export const DEBUG_ADAPTER_ARTIFACT_MAX_DEPTH = 16

/**
 * pin した配布物の表（Session 6-15B）。**勝手に新しい版へ追従しない。**
 *
 * 版を上げるときは、新しい asset の SHA-256 と展開した木の tree hash を取り直し、実 adapter で
 * lifecycle（ready の合図・`startDebugging` の欄）を確かめ直してから、この表を書き換える。
 */
export const DEBUG_ADAPTER_ARTIFACTS: Readonly<
  Record<DebugAdapterArtifactId, DebugAdapterArtifact>
> = {
  'vscode-js-debug': {
    id: 'vscode-js-debug',
    version: '1.117.0',
    source: {
      repository: 'https://github.com/microsoft/vscode-js-debug',
      releaseTag: 'v1.117.0',
      assetName: 'js-debug-dap-v1.117.0.tar.gz',
      url: 'https://github.com/microsoft/vscode-js-debug/releases/download/v1.117.0/js-debug-dap-v1.117.0.tar.gz',
      sha256: 'ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772'
    },
    license: 'MIT',
    installDirectoryName: 'js-debug-dap-v1.117.0',
    rootDirectoryName: 'js-debug',
    entryRelativePath: 'src/dapDebugServer.js',
    tree: {
      sha256: 'fdda8ebfec62c3d898a2332f033408cae035dd6981397416b559fe20743d4933',
      fileCount: 60,
      totalBytes: 2_467_634
    }
  }
}

export interface DebugAdapterArtifactEntryStat {
  readonly isFile: () => boolean
  readonly isDirectory: () => boolean
  readonly isSymbolicLink: () => boolean
  readonly size: number
}

/** 読み取りだけ（同期）。symlink を辿らないよう `lstat` を渡すこと。 */
export interface DebugAdapterArtifactFileSystem {
  readonly lstat: (path: string) => DebugAdapterArtifactEntryStat
  readonly readdir: (path: string) => readonly string[]
  readonly readFile: (path: string) => Uint8Array
}

export type DebugAdapterArtifactVerification =
  | { readonly status: 'verified'; readonly rootPath: string; readonly entryPath: string }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid' }
  | { readonly status: 'hash-mismatch' }

/** 置き場所（Main が決める。userData の下）。 */
export function resolveDebugAdapterArtifactRoot(
  artifactsBaseDirectory: string,
  artifact: DebugAdapterArtifact
): string {
  return join(artifactsBaseDirectory, artifact.installDirectoryName, artifact.rootDirectoryName)
}

export function verifyDebugAdapterArtifact(
  rootPath: string,
  artifact: DebugAdapterArtifact,
  fileSystem: DebugAdapterArtifactFileSystem
): DebugAdapterArtifactVerification {
  let rootStat: DebugAdapterArtifactEntryStat

  try {
    rootStat = fileSystem.lstat(rootPath)
  } catch {
    return { status: 'missing' }
  }

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return { status: 'invalid' }
  }

  const files: { readonly relativePath: string; readonly absolutePath: string }[] = []
  let totalBytes = 0
  let outcome: 'ok' | 'invalid' | 'hash-mismatch' = 'ok'

  function walk(directory: string, prefix: string, depth: number): void {
    if (depth > DEBUG_ADAPTER_ARTIFACT_MAX_DEPTH) {
      outcome = 'invalid'
      return
    }

    for (const name of fileSystem.readdir(directory)) {
      if (outcome !== 'ok') {
        return
      }

      const absolutePath = join(directory, name)
      const relativePath = prefix === '' ? name : `${prefix}/${name}`
      const stat = fileSystem.lstat(absolutePath)

      if (stat.isSymbolicLink()) {
        outcome = 'invalid'
        return
      }

      if (stat.isDirectory()) {
        walk(absolutePath, relativePath, depth + 1)
        continue
      }

      if (!stat.isFile()) {
        outcome = 'invalid'
        return
      }

      files.push({ relativePath, absolutePath })
      totalBytes += stat.size

      // 表より大きな木は、読み切る前に違うと分かる。
      if (files.length > artifact.tree.fileCount || totalBytes > artifact.tree.totalBytes) {
        outcome = 'hash-mismatch'
        return
      }
    }
  }

  try {
    walk(rootPath, '', 0)
  } catch {
    return { status: 'invalid' }
  }

  if (outcome !== 'ok') {
    return { status: outcome }
  }

  if (files.length !== artifact.tree.fileCount || totalBytes !== artifact.tree.totalBytes) {
    return { status: 'hash-mismatch' }
  }

  files.sort((a, b) => compareCodeUnits(a.relativePath, b.relativePath))

  const tree = createHash('sha256')

  try {
    for (const file of files) {
      const digest = createHash('sha256')
        .update(fileSystem.readFile(file.absolutePath))
        .digest('hex')
      tree.update(`${digest}  ${file.relativePath}\n`)
    }
  } catch {
    return { status: 'invalid' }
  }

  if (tree.digest('hex') !== artifact.tree.sha256) {
    return { status: 'hash-mismatch' }
  }

  const entry = files.find((file) => file.relativePath === artifact.entryRelativePath)

  if (entry === undefined) {
    return { status: 'hash-mismatch' }
  }

  return { status: 'verified', rootPath, entryPath: entry.absolutePath }
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
