import type { PlatformId } from '@shared/api'
import {
  findExecutableOnPath,
  findInDirectory,
  trimTrailingSeparator,
  type FileExistsCheck
} from '../platform/executablePath'

/**
 * GitHub CLI（`gh`）をどこから起動するかを決める（Electron / fs 非依存・テスト対象）。
 *
 * ## 形は `git` の解決とまったく同じ
 *
 * main/git/gitExecutable.ts と同じ規則を、名前と既定の置き場所だけ替えて
 * 使っている ── 規則そのもの（PATH を辿る・相対の項目は飛ばす・実体を
 * 確かめてから絶対パスで渡す）は platform 層が1つだけ持つ
 * （main/platform/executablePath.ts）。
 *
 * **`gh` とだけ書いて起動しない**理由も同じになる。Windows の CreateProcess は
 * 作業ディレクトリを先に見るため、利用者が開いた Workspace の中に `gh.exe` が
 * 置かれていればそちらが動く ── clone してきたリポジトリの中身は、この時点では
 * ただのファイルでしかない。
 *
 * ## PATH に居ないことがある
 *
 * winget / MSI で入れた直後は、**既に開いているプロセスの PATH に反映されない**
 * （環境変数の更新は新しく起動したプロセスにしか届かない）。つまり
 * 「入れたのに使えない」がアプリを開き直すまで続くことになる ──
 * Git for Windows のために既定のインストール先を当たっているのと同じ形で、
 * ここでも `%ProgramFiles%` などから組み立てた絶対パスを当たる。
 *
 * ## 覚えない
 *
 * 解決の結果を控えない（git と同じ）。gh は**公開を押そうとした人が、
 * その場で入れる**ことがいちばんありうるものにあたる ── 案内に winget の
 * 1行を出しているのはそのためで（renderer/src/git/githubPublish.ts）、
 * 覚えてしまうと入れた直後にもう一度押しても「見つかりません」のままになる。
 *
 * 見つからなければ null を返し、呼び出し側は `cli-missing` として扱う
 * （shared/github/publish.ts）。**落ちる理由にはしない** ── gh が無くても
 * Git パネルの他のすべてはそのまま使える。
 */

/** 実行ファイルの名前の候補。 */
function githubCliExecutableNames(platform: PlatformId): readonly string[] {
  return platform === 'win32' ? ['gh.exe'] : ['gh']
}

/**
 * GitHub CLI の既定のインストール先（環境変数からの相対位置）。
 *
 * 並びは「見つかってほしい順」。64bit の既定 → 32bit → ユーザー単位の
 * インストール（winget の user scope）になる。
 */
const WINDOWS_GITHUB_CLI_LOCATIONS: readonly {
  readonly variable: string
  readonly relative: string
}[] = [
  { variable: 'ProgramFiles', relative: 'GitHub CLI' },
  { variable: 'ProgramW6432', relative: 'GitHub CLI' },
  { variable: 'ProgramFiles(x86)', relative: 'GitHub CLI' },
  { variable: 'LOCALAPPDATA', relative: 'Programs\\GitHub CLI' }
]

/**
 * この PC の `gh` の絶対パス。見つからなければ null。
 *
 * `env` と `exists` を引数で受け取るのは、`process.env` / `fs` を直接読むと
 * この判断がテストできなくなるため（gitExecutable.ts と同じ分け方）。
 */
export function resolveGitHubCliExecutable(
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): string | null {
  const names = githubCliExecutableNames(platform)
  const onPath = findExecutableOnPath(names, platform, env, exists)

  if (onPath !== null) {
    return onPath
  }

  /*
    既定の置き場所を当たるのは Windows だけ（v1 の対象。DESIGN.md §8）。
    他の OS で gh が PATH に居ないのは「入っていない」とほぼ同義になる。
  */
  if (platform !== 'win32') {
    return null
  }

  for (const location of WINDOWS_GITHUB_CLI_LOCATIONS) {
    const base = env[location.variable]

    if (typeof base !== 'string' || base.length === 0) {
      continue
    }

    const found = findInDirectory(
      `${trimTrailingSeparator(base)}\\${location.relative}`,
      names,
      platform,
      exists
    )

    if (found !== null) {
      return found
    }
  }

  return null
}
