/**
 * 走らない / 見張らないフォルダの名前（fs にも Electron にも依存しない）。
 *
 * ## 除外の規則を1つにしておく
 *
 * もとは監視（watchPaths.ts）だけが持っていた。Session 3-6-4 で
 * プロジェクト全体検索（searchWorkspaceFiles.ts）が同じ判断を要るようになったため、
 * **規則そのものをここへ移した**（検索側で書き直していない）。
 *
 * 2箇所に書くと、`.git` の中の変更は届かないのに検索結果には出る、といった
 * 食い違いが生まれる。利用者から見れば「このアプリが日常的に扱う範囲」は1つで、
 * 監視と検索でその範囲が違う理由が無い。
 *
 * ## 見えなくなるわけではない
 *
 * 除外しているのは**再帰的に舐める処理**だけで、Files パネルでフォルダを展開すれば
 * 中身は普通に列挙される（readWorkspaceDirectory.ts はこの表を見ない）。
 * その中のファイルを開いて編集・保存することもできる。効かないのは
 * 「アプリの外での変更の自動追従」と「全体検索の対象になること」の2つだけ。
 *
 * ## 固定である理由
 *
 * VS Code の既定の除外と同じ考え方で、`.git` / `node_modules` は
 * **どのプロジェクトでも数万件になりうる**一方、Files パネルで日常的に見ることも
 * Editor で開くこともほとんど無い。Settings から読む形にするのは後（DESIGN.md）。
 */

const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules'])

/** そのフォルダ名を、走査・監視の対象から外すか。 */
export function isIgnoredDirectoryName(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name)
}

/**
 * その相対位置が、除外するフォルダの中（またはそれ自身）か。
 *
 * どの階層に現れても外す（`src/vendor/node_modules/...` も対象）。
 * 渡すのは正規化済みの relativePath（区切りは `/`）。
 */
export function isIgnoredRelativePath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => isIgnoredDirectoryName(segment))
}
