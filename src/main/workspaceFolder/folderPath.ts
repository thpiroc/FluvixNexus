import { basename, isAbsolute, resolve } from 'path'
import { WORKSPACE_ROOT_PATH_MAX_LENGTH } from '@shared/workspace'

/**
 * Workspace の rootPath の扱い（パス文字列に対する判断だけ）。
 *
 * このファイルは Electron に依存しない純粋な関数だけを持つ
 * （store/windowBounds.ts と store/windowState.ts の分け方に合わせる）。
 * ファイルシステムにも触れない ── 「実在するか」は今の状態であって
 * パス文字列から決まる性質ではないため、workspaceFolder/currentWorkspaceFolder.ts が持つ。
 *
 * 判断をここに集めているのは、パスの出どころが複数あるから。
 *   - ネイティブのフォルダ選択ダイアログが返した値
 *   - 前回の起動時に保存したファイルの中身（利用者が手で編集できる）
 * どちらも「境界の外から来た値」として同じ検証を通す。
 *
 * OS 依存の判定（区切り文字・ドライブレター）は node の path に委ねる。
 * Windows 専用の書き方をここに埋め込むと、将来の Mac 対応で書き換えが要る
 * （DESIGN.md §8）。
 */

/**
 * Workspace の root として扱えるパスへ正規化する。
 *
 * 受け付けないものは null を返す（呼び出し側が「開けない」として扱う）。
 *   - 文字列でない / 空
 *   - 相対パス（どこを基準にするかが決まらない）
 *   - 桁違いに長い
 *   - NUL を含む（fs へ渡すと例外になる）
 *
 * 正規化は resolve に任せる。`.` `..` の解決、区切り文字の統一、末尾の区切りの除去が
 * まとめて済み、同じフォルダが違う文字列として保存されることを防げる。
 */
export function normalizeWorkspaceRootPath(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()

  if (trimmed.length === 0 || trimmed.length > WORKSPACE_ROOT_PATH_MAX_LENGTH) {
    return null
  }

  if (trimmed.includes('\0')) {
    return null
  }

  if (!isAbsolute(trimmed)) {
    return null
  }

  return resolve(trimmed)
}

/**
 * UI に出す既定の名前。
 *
 * 基本はフォルダ名だが、ドライブ直下（`D:\`）のように末尾の要素が無い場合は
 * basename が空文字を返すため、パスそのものを名前にする。
 * 名前が空になると「開いているのに何も表示されない」状態になり、
 * Workspace が開いているかどうかを利用者が判断できなくなる。
 */
export function deriveWorkspaceDisplayName(rootPath: string): string {
  const name = basename(rootPath)

  return name.length > 0 ? name : rootPath
}
