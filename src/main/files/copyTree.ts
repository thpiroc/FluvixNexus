import { constants } from 'fs'
import { copyFile, lstat, mkdir, readdir } from 'fs/promises'
import { join } from 'path'

/**
 * フォルダの中身を、既に作ってある行き先へ再帰的に複製する。
 *
 * ## 境界の判断はここに無い
 *
 * 受け取るのは**検証済みの絶対パス2つ**だけ（mutateWorkspaceEntry.ts が
 * 元の親・コピー先の親の realpath を Workspace の中だと確かめ、
 * コピー先が元の中に無いことまで見てから呼ぶ）。ここが持つのは
 * 「その2点の間で fs をどう回すか」だけで、相対位置も Workspace も知らない。
 *
 * 分けてあるのは、境界の検証を1箇所（mutateWorkspaceEntry.ts の resolveParent /
 * resolveExisting）に閉じたままにするため。ここに Workspace の話を持ち込むと、
 * 検証の手順が操作ごとに散り始める。
 *
 * ## リンクは辿らない・作り直さない
 *
 * symlink / ジャンクションに当たったら**とばして数える。**
 *
 *   - 辿ると、Workspace の外にある実体の中身を Workspace の中へ持ち込める
 *     （「Workspace の外を読まない」の抜け道になる。ARCHITECTURE.md §9.3）
 *   - 中を指すリンクでも、祖先を指していれば再帰が終わらない
 *   - 作り直す形にすると、Windows では権限が要るうえ、
 *     **外を指す入口をアプリが新しく増やす**ことになる
 *
 * リンクを辿らない以上、実体のフォルダの木に循環は無い（Windows にフォルダの
 * ハードリンクは無い）。だから深さの上限を置いていない ── 上限を置くと、
 * 攻撃者のいない場所に「深いと失敗する」という失敗だけが増える。
 *
 * **とばしたことは黙らせない。** 数を返し、呼び出し側が応答に載せる
 * （複製したつもりで中身が欠けている方が、断られるより悪い）。
 *
 * ## 上書きしない
 *
 * ファイルは `COPYFILE_EXCL`、フォルダは recursive なしの `mkdir` で作る。
 * どちらも既にあれば EEXIST で失敗する。**先に存在を確かめてから作らない**のは
 * 作成（createWorkspaceEntry）と同じ理由で、確かめてから作るまでの隙間に
 * 同名のものが現れると、そこで中身を消して上書きすることになる。
 *
 * ## 途中で失敗したら、そこで止める（片付けない）
 *
 * 作りかけを消しに行かない。`fs.rm` を持ち出すと、Renderer から届いた要求で
 * **戻せない削除が起きる経路**を1つ増やすことになる（ARCHITECTURE.md §10.2）。
 * 残ったものはツリーに現れるので、利用者が見て消せる。
 * 「残っている」ことは呼び出し側が応答で伝える（shared/files/copy.ts）。
 */

/** 1件ごとの種別。リンクは指し先を見ずに、リンクとして扱う。 */
type EntryKind = 'file' | 'directory' | 'link' | 'other'

export type CopyTreeOutcome =
  | { readonly status: 'ok'; readonly skippedCount: number }
  /** 途中で止まった。cause は呼び出し側が errno へ翻訳する。 */
  | { readonly status: 'failed'; readonly skippedCount: number; readonly cause: unknown }

/** とばした件数の持ち回り（再帰の途中で増える）。 */
interface SkipCounter {
  count: number
}

/**
 * その1件が何か。
 *
 * `readdir` の `withFileTypes` を使わず lstat で見直している。Dirent の種別は
 * ディレクトリエントリの属性から決まり、**再解析ポイント（ジャンクション）を
 * どう答えるかがプラットフォームの実装に委ねられる。** ここでの種別の判断は
 * 「リンクを辿らない」という境界そのものなので、答えを1つの API に寄せて
 * 明示的に lstat で確かめる（1件あたり1回の syscall は、複製そのものの
 * コストに対して無視できる）。
 */
async function kindOf(absolutePath: string): Promise<EntryKind> {
  const stats = await lstat(absolutePath)

  if (stats.isSymbolicLink()) {
    return 'link'
  }

  if (stats.isDirectory()) {
    return 'directory'
  }

  return stats.isFile() ? 'file' : 'other'
}

/** 1階層ぶんを複製し、フォルダなら中へ降りる。失敗はそのまま投げる。 */
async function copyInto(
  sourcePath: string,
  destinationPath: string,
  skipped: SkipCounter
): Promise<void> {
  const names = await readdir(sourcePath)

  for (const name of names) {
    const from = join(sourcePath, name)
    const to = join(destinationPath, name)

    switch (await kindOf(from)) {
      case 'file':
        // 既にあれば EEXIST（作ったばかりのフォルダなので通常は起きない）。
        await copyFile(from, to, constants.COPYFILE_EXCL)
        break

      case 'directory':
        await mkdir(to)
        await copyInto(from, to, skipped)
        break

      /*
        リンクと、ファイルでもフォルダでもないもの（名前付きパイプなど）。
        中身を持ってくる手段が無いか、持ってくると境界を越える。
      */
      case 'link':
      case 'other':
        skipped.count += 1
        break
    }
  }
}

/**
 * `sourcePath` の中身を `destinationPath` の中へ複製する。
 *
 * `destinationPath` は**呼び出し側が既に作っていること**。作る側と中身を運ぶ側を
 * 分けてあるのは、コピー先の名前を決めるのが「排他で作ってみて、既にあれば
 * 次の候補へ」という繰り返しであり（mutateWorkspaceEntry.ts）、
 * その繰り返しをこの層に持ち込む理由が無いため。
 */
export async function copyDirectoryContents(
  sourcePath: string,
  destinationPath: string
): Promise<CopyTreeOutcome> {
  const skipped: SkipCounter = { count: 0 }

  try {
    await copyInto(sourcePath, destinationPath, skipped)
  } catch (cause) {
    return { status: 'failed', skippedCount: skipped.count, cause }
  }

  return { status: 'ok', skippedCount: skipped.count }
}
