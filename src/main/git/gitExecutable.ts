import type { PlatformId } from '@shared/api'
import {
  findExecutableOnPath,
  findInDirectory,
  trimTrailingSeparator,
  type FileExistsCheck
} from '../platform/executablePath'

/**
 * `git` 本体をどこから起動するかを決める（Electron / fs 非依存・テスト対象）。
 *
 * ## `git` とだけ書かない
 *
 * Terminal の表（main/terminal/shellCommand.ts）と同じ理由になる。
 * 実行ファイル名だけを `execFile` へ渡すと、Windows では
 * **作業ディレクトリが先に見られる**。Git の作業ディレクトリは利用者が開いた
 * Workspace そのもので、その中に `git.exe` が置かれていることは十分ありうる
 * （clone してきたリポジトリの中身は、この時点ではただのファイルでしかない）。
 *
 * 「フォルダを開いて Git パネルを見た」が「そのフォルダの中の実行ファイルが動く」に
 * なっては困る。だから PATH は**こちらで辿り、実体を確かめてから絶対パスを渡す**
 * （main/platform/executablePath.ts）。
 *
 * ## PATH に居ないこともある（Git for Windows）
 *
 * Git for Windows のインストーラは PATH の扱いを3つから選ばせ、その1つが
 * 「**Git Bash からのみ使う**（PATH に入れない）」になっている。これを選んだ PC では
 * git は入っているのに PATH からは見つからない。
 *
 * そこで PATH で見つからなかったときだけ、既定のインストール先を当たる。
 * 当てにするのは `%ProgramFiles%` などの**環境変数から組み立てた絶対パス**だけで、
 * ここでも「名前だけに落とす」ことはしない ── 落とせば結局 cwd が見られる。
 *
 * 見つからなければ null を返し、呼び出し側は `git-unavailable` として扱う
 * （shared/git/repository.ts）。**落ちる理由にはしない。**
 * Git が入っていない PC でも、Git パネル以外はそのまま使える（設計判断 6）。
 *
 * ## 覚えない
 *
 * 解決の結果を控えない（Terminal のシェル一覧と同じ）。利用者はアプリを開いたまま
 * Git を入れることがあり、控えてしまうと「入れたのに使えない」が起動し直すまで続く。
 * 調べるのは Git パネルを見たときだけなので、毎回辿っても代償はほぼ無い。
 */

/** 実行ファイルの名前の候補。 */
function gitExecutableNames(platform: PlatformId): readonly string[] {
  return platform === 'win32' ? ['git.exe'] : ['git']
}

/**
 * Git for Windows の既定のインストール先（環境変数からの相対位置）。
 *
 * `cmd\git.exe` を指しているのは、そちらが**アプリから呼ぶための入口**だから。
 * 隣にある `bin\git.exe` は Git Bash（MSYS2）用で、呼ぶと MSYS のコンソールを
 * 前提にした振る舞いになる。
 *
 * 並びは「見つかってほしい順」。64bit の既定 → 32bit → ユーザー単位のインストール。
 */
const WINDOWS_GIT_LOCATIONS: readonly { readonly variable: string; readonly relative: string }[] = [
  { variable: 'ProgramFiles', relative: 'Git\\cmd' },
  { variable: 'ProgramW6432', relative: 'Git\\cmd' },
  { variable: 'ProgramFiles(x86)', relative: 'Git\\cmd' },
  // インストーラの「自分だけにインストール」を選んだ場合の置き場所。
  { variable: 'LOCALAPPDATA', relative: 'Programs\\Git\\cmd' }
]

/**
 * この PC の `git` の絶対パス。見つからなければ null。
 *
 * `env` と `exists` を引数で受け取るのは、`process.env` / `fs` を直接読むと
 * この判断がテストできなくなるため（shellCommand.ts と同じ分け方）。
 */
export function resolveGitExecutable(
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): string | null {
  const names = gitExecutableNames(platform)
  const onPath = findExecutableOnPath(names, platform, env, exists)

  if (onPath !== null) {
    return onPath
  }

  /*
    PATH に入れない選択肢があるのは Windows のインストーラだけ。
    他の OS で git が PATH に居ないのは「入っていない」とほぼ同義なので、
    当てにいく場所を持たない（v1 の対象は Windows。DESIGN.md §8）。
  */
  if (platform !== 'win32') {
    return null
  }

  for (const location of WINDOWS_GIT_LOCATIONS) {
    const base = env[location.variable]

    if (typeof base !== 'string' || base.length === 0) {
      continue
    }

    /*
      findInDirectory は相対のフォルダを受け付けない。環境変数の中身は
      利用者が書き換えられるため、`%ProgramFiles%` に相対パスが入っていても
      cwd を起点に解決されることはない。
    */
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
