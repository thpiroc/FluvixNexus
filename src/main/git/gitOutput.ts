import type { PlatformId } from '@shared/api'
import type { GitLocalBranch } from '@shared/git'

/**
 * git の出力を読む（Electron / fs / child_process 非依存・テスト対象）。
 *
 * 実際に git を動かす層（main/git/runGit.ts）から**読み取りの判断だけ**を
 * 切り離してある。childProcesses.ts で `parseParentPids` を分けているのと同じ形で、
 * ここに集めた判断はテストで固定できる。
 *
 * ## ここが答える問い
 *
 *   - `rev-parse --show-toplevel` が返したパスは、今の Workspace root と同じ場所か
 *   - HEAD はブランチの上に居るか、それとも特定の commit を指しているか
 *   - `for-each-ref` が返した行は、どのローカルブランチか（Session 3-8-6）
 *
 * 1つめが Session 3-8-1 の核心にあたる。**Workspace root がリポジトリ root で
 * ないときは Git 操作を行わない**（設計判断 10）ため、「同じ場所か」の判断を
 * 誤ると、リポジトリの一部しか見えていない状態で Commit / Push を許すことになる。
 */

/**
 * `rev-parse --show-toplevel` の出力からリポジトリ root を読む。
 *
 * 読めなければ null。空の出力は「読めなかった」として扱う ── git が
 * 何も言わずに 0 で終わる形（bare リポジトリの一部の呼ばれ方）を
 * 「root が空文字のリポジトリ」として通してしまわないため。
 */
export function readRepositoryRoot(stdout: string): string | null {
  const line = firstNonEmptyLine(stdout)

  return line === null ? null : line
}

/**
 * `symbolic-ref --quiet --short HEAD` の出力からブランチ名を読む。
 *
 * 読めなければ null。このコマンドは **1つも commit が無いリポジトリでも成功する**
 * （HEAD は `refs/heads/main` を指しており、その先がまだ無いだけ）ので、
 * `git init` 直後のリポジトリでもブランチ名が出る。
 * `rev-parse --abbrev-ref HEAD` にはこの性質が無い（HEAD を解決しようとして失敗する）。
 */
export function readBranchName(stdout: string): string | null {
  return firstNonEmptyLine(stdout)
}

/**
 * `rev-parse --short HEAD` の出力から commit を読む。
 *
 * 16進の並びであることまで確かめる。**形を確かめずに通すと、想定と違う出力
 * （警告・ヒント）がそのまま「commit 名」として画面に出る**ため。
 * detached HEAD の表示にしか使わない値なので、読めなければ null に倒して
 * `unknown` として扱う方がよい。
 */
export function readShortCommit(stdout: string): string | null {
  const line = firstNonEmptyLine(stdout)

  if (line === null || !/^[0-9a-f]{4,40}$/i.test(line)) {
    return null
  }

  return line
}

/**
 * `for-each-ref --format=%(HEAD)%00%(refname:short)` の出力を読む（Session 3-8-6）。
 *
 * 1行が1つのブランチで、形は `*<NUL>main`（今居るブランチ）または
 * ` <NUL>feature/x` になる。**区切りが NUL なのは `%(HEAD)` 自身が空白を
 * 出すため**で、空白区切りにすると区切りと値の区別が消える
 * （main/git/gitCommands.ts の `listLocalBranches`）。
 *
 * ## 上限を「読んだ側」で切る
 *
 * git には上限より1つ多く求めてある（`--count=limit + 1`）。ここで
 * `limit` 件に切り、**切ったかどうか**を一緒に返す ── 呼び出し側が
 * 件数を数え直して判断する形にすると、上限の意味を持つ場所が2つになる。
 *
 * ## 読めない行は落とす（失敗にしない）
 *
 * 区切りが無い行・名前が空の行は、そのまま捨てて先へ進む。1行が読めないことを
 * 一覧全体の失敗にすると、**他のブランチへ切り替える手立てまで消える** ──
 * 変更ファイルの一覧で `unreadable-output` に倒したのとは事情が違い、
 * こちらは「出ていない行がある」だけで嘘にはならない。
 *
 * `current` を名前の一致ではなく `%(HEAD)` の印から決めているのは、
 * **同じ1回の読み取りから出す**ため（shared/git/branch.ts）。
 */
export function readLocalBranches(
  stdout: string,
  limit: number
): { readonly branches: readonly GitLocalBranch[]; readonly truncated: boolean } {
  const branches: GitLocalBranch[] = []
  let truncated = false

  for (const line of stdout.split('\n')) {
    const separator = line.indexOf('\0')

    if (separator < 0) {
      continue
    }

    const name = line.slice(separator + 1).trim()

    if (name.length === 0) {
      continue
    }

    if (branches.length >= limit) {
      // 上限より1つ多く求めてあるので、ここへ来た時点で「まだ先がある」。
      truncated = true
      break
    }

    branches.push({ name, current: line.slice(0, separator).includes('*') })
  }

  return { branches, truncated }
}

/**
 * 2つのパスが同じフォルダを指しているか。
 *
 * ## なぜ単純な文字列比較では足りないか
 *
 * 比べる相手は、次のように**同じ場所を違う文字列で**指してくる。
 *
 * ```
 * git が返す        D:/DEV/PROJECTS/Fluvix Nexus   （区切りは常に `/`）
 * Workspace root    D:\DEV\PROJECTS\Fluvix Nexus   （OS の表記）
 * ```
 *
 * さらに Windows のパスは大文字小文字を区別しないため、`D:\dev\...` と
 * `D:\DEV\...` も同じ場所になる。ここを厳密一致にすると、**リポジトリ root を
 * 開いているのに `nested`（サブフォルダ）として扱われ**、Git パネルが
 * 何もできない状態になる。
 *
 * ## それでも文字列の比較に留める
 *
 * symlink / ジャンクション越しに同じ場所を指す場合は、この関数では見抜けない。
 * 実体まで辿るのは呼び出し側の責務にしてある（main/git/gitRepository.ts が
 * `realpath` を通してから渡す）── ファイルシステムに触れた時点で、
 * この判断をテストで固定できなくなるため。
 *
 * `platform` を引数で受け取るのは同じ理由。node の `path` は動いている OS で
 * 振る舞いが変わるため、それに任せると「Windows でだけ通るテスト」になる。
 */
export function isSameRepositoryPath(a: string, b: string, platform: PlatformId): boolean {
  return normalizeRepositoryPath(a, platform) === normalizeRepositoryPath(b, platform)
}

/**
 * 比較のためにパスの表記を揃える。
 *
 * 「同じ場所か」を決めるためだけの正規化で、**ここで作った文字列を
 * ファイルシステムへ渡さない**（大文字小文字を潰しているため、
 * 表示にも使わない）。
 */
export function normalizeRepositoryPath(value: string, platform: PlatformId): string {
  const trimmed = value.trim()

  if (platform !== 'win32') {
    // 大文字小文字は区別される。落とせるのは末尾の区切りだけ。
    const withoutTrailing = trimmed.replace(/\/+$/, '')

    return withoutTrailing.length === 0 ? '/' : withoutTrailing
  }

  const backslashed = trimmed.replace(/\//g, '\\')
  // UNC（`\\server\share`）の先頭2つは意味のある区切りなので、畳む対象から外す。
  const isUnc = backslashed.startsWith('\\\\')
  const body = isUnc ? backslashed.slice(2) : backslashed
  const collapsed = `${isUnc ? '\\\\' : ''}${body.replace(/\\{2,}/g, '\\')}`
  const withoutTrailing = collapsed.replace(/\\+$/, '')
  // ドライブ直下（`C:\`）は末尾を落とすと `C:`（ドライブ相対）に化けるため戻す。
  const restored = /^[A-Za-z]:$/.test(withoutTrailing) ? `${withoutTrailing}\\` : withoutTrailing

  return restored.toLowerCase()
}

/** 最初の空でない行。無ければ null。 */
function firstNonEmptyLine(value: string): string | null {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return null
}
