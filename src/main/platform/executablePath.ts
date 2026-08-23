import type { PlatformId } from '@shared/api'

/**
 * 起動するものを PATH から**辿って**探す（Electron / fs 非依存・テスト対象）。
 *
 * ## PATH を「辿る」ことと、PATH に「任せる」ことは違う
 *
 * 実行ファイル名だけを `spawn` / `execFile` へ渡すと、解決に使われるのは
 * OS の探索規則になる。Windows の CreateProcess は**作業ディレクトリを先に見る**ため、
 * 作業ディレクトリ ── つまり利用者が開いた Workspace ── の中に同じ名前の
 * 実行ファイルが置かれていれば、そちらが起動する。
 * clone してきたリポジトリの中身は、この時点ではただのファイルでしかない。
 * 「フォルダを開いただけ」が「そのフォルダの中の実行ファイルが動く」になっては困る。
 *
 * そこで PATH は**こちらで辿り、実体を確かめてから絶対パスを渡す**。
 *
 *   - 相対の項目（`.` や `bin` のような書き方）は飛ばす。cwd を起点に解決されるため
 *   - 見つからなければ null。呼び出し側が「この環境には無い」として扱う
 *
 * ## ここに置いてある理由
 *
 * この規則を最初に必要としたのは Terminal（Node / Claude Code の解決。§13.2）で、
 * 次に Git（`git` 本体の解決。§14.1）が同じものを必要とした。
 * どちらのドメインにも属さない **OS の探索規則そのもの**なので、
 * OS 依存の判断を集める platform 層へ置く（main/platform/index.ts の冒頭）。
 *
 * 2箇所に書くと、片方だけ「相対の項目も拾う」ように直された時点で、
 * その経路からだけ作業ディレクトリの中身が起動されるようになる。
 */

/**
 * 実行ファイルがそこに在るか。
 *
 * 引数で受け取るのは、`fs` を直接読むとこの規則がテストできなくなるため
 * （`env` を受け取っているのと同じ理由）。実体を渡すのは呼び出し側。
 */
export type FileExistsCheck = (absolutePath: string) => boolean

/**
 * PATH を辿って実体を探す。見つからなければ null。
 *
 * 走査の順は「PATH の項目 → その中で名前の候補」。前の方のフォルダに置かれたものが
 * 勝つ（利用者の PATH の意図をそのまま尊重する）。
 */
export function findExecutableOnPath(
  executableNames: readonly string[],
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): string | null {
  // Windows の環境変数は大文字小文字を区別しないが、Node の process.env は素通しで来る。
  const rawPath = env.PATH ?? env.Path ?? env.path

  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return null
  }

  const separator = platform === 'win32' ? ';' : ':'

  for (const item of rawPath.split(separator)) {
    // PATH の項目は引用符付きで書かれていることがある（`"C:\Program Files\..."`）。
    const entry = item.trim().replace(/^"|"$/g, '')

    if (!isAbsoluteExecutablePath(entry, platform)) {
      continue
    }

    const found = findInDirectory(entry, executableNames, platform, exists)

    if (found !== null) {
      return found
    }
  }

  return null
}

/**
 * 決まったフォルダの中から実体を探す。見つからなければ null。
 *
 * PATH に載っていない場所を当たるための口。Git for Windows のように
 * 「インストールしたが PATH には入れない」選択肢を持つものがあるため、
 * PATH で見つからなかった後の当てとして使う（main/git/gitExecutable.ts）。
 *
 * **相対のフォルダは受け付けない。** PATH の項目を飛ばすのと同じ理由で、
 * cwd を起点に解決される場所を当てにすると、この層が守っている性質が崩れる。
 */
export function findInDirectory(
  directory: string,
  executableNames: readonly string[],
  platform: PlatformId,
  exists: FileExistsCheck
): string | null {
  if (!isAbsoluteExecutablePath(directory, platform)) {
    return null
  }

  /*
    末尾の区切りだけを落とす（絶対かどうかを見た後で）。ドライブ直下（`C:\`）は
    `C:` になるが、下で `\` を足して繋ぐので `C:\git.exe` に戻る。
  */
  const base = trimTrailingSeparator(directory)

  for (const name of executableNames) {
    const candidate = platform === 'win32' ? `${base}\\${name}` : `${base}/${name}`

    if (exists(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * cwd の影響を受けない絶対パスか。
 *
 * Windows では、ドライブ付き（`C:\...`）と UNC（`\\server\share`）だけを絶対と見なす。
 * `C:git.exe`（ドライブ相対）は cwd の影響を受けるため、絶対ではない。
 */
export function isAbsoluteExecutablePath(value: string, platform: PlatformId): boolean {
  if (platform !== 'win32') {
    return value.startsWith('/')
  }

  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

/** 末尾の区切り文字を落とす（区切りが重なったパスを組み立てないため）。 */
export function trimTrailingSeparator(value: string): string {
  return value.replace(/[\\/]+$/, '')
}
