import { stat } from 'fs/promises'
import type { FileEntryType } from '@shared/files'

/**
 * symlink / ジャンクションを、ツリーに並べるときの種別へ落とす。
 *
 * 列挙（readWorkspaceDirectory.ts）と検索（searchWorkspaceFiles.ts）の
 * **両方が同じ答えを要る**ため、判断をここ1箇所に置く。
 * 2箇所に書くと、ツリーではフォルダに見えるものが検索結果ではファイルとして出る、
 * という食い違いが生まれる（種別は FileEntry.id の一部でもある）。
 *
 * 指し先が壊れている（消えている・権限が無い・リンクのループ）場合は file として扱う。
 * 一覧から消してしまうと「あるのに見えない」状態になるため、
 * 展開できないものとして並べておく方が実際の状態に近い。
 *
 * **種別を決めるだけで、辿ってよいかは答えない。** 指し先が Workspace の外にありうる
 * 以上、リンクの中へ潜るかどうかは呼び出し側の判断になる
 * （列挙は1階層しか読まないので関係が無く、検索とコピーは潜らない）。
 */
export async function resolveLinkEntryType(absolutePath: string): Promise<FileEntryType> {
  try {
    return (await stat(absolutePath)).isDirectory() ? 'directory' : 'file'
  } catch {
    return 'file'
  }
}
