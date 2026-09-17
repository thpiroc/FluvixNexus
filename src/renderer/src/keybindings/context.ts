import { createContext, useContext } from 'react'
import type { KeybindingsFileStatus, StoredKeybindingEntry } from '@shared/keybindings'
import type { ResolvedKeybinding } from './resolve'
import type { InvalidUserKeybinding } from './userKeybindings'
import type { WhenKey } from './when'

/**
 * 打鍵の受け口（Session 4-7A）。
 *
 * 配るのは次のものだけ。
 *
 *   - 効いている割り当ての表（Settings の一覧が読む）
 *   - 条件を申告する口（`useWhenFlag`）
 *   - `keybindings.json` の中身と、それを保存する口（Shortcuts S3。画面は S4）
 *
 * **command を実行する口はここに無い。** 実行は `useCommands().execute` の
 * 一本で、打鍵はその呼び出し元の1つにすぎない。
 */

/**
 * `keybindings.json` の読み込みの状態。
 *
 *   loading … まだ読み込みが返ってきていない（既定の割り当てだけで動いている）
 *   failed  … IPC そのものが失敗した（ファイルの中身は分からない）
 *   それ以外 … Main が返した `KeybindingsFileStatus`
 */
export type UserKeybindingsStatus = 'loading' | 'failed' | KeybindingsFileStatus

export interface UserKeybindingsState {
  readonly status: UserKeybindingsStatus
  /** ファイルの行（並び順のまま。読めない行も含む）。 */
  readonly entries: readonly StoredKeybindingEntry[]
  /** Main が形で読み飛ばした行の数。 */
  readonly skippedCount: number
  /** 意味として読めなかった行（`entries` の中の位置と理由）。 */
  readonly invalid: readonly InvalidUserKeybinding[]
}

export interface KeybindingController {
  readonly entries: readonly ResolvedKeybinding[]
  /**
   * 条件を申告する。返り値を呼ぶと取り下げる。
   *
   * DOM から見て取れない条件（React が持っている真偽値）だけがここを通る。
   * Session 4-7A では `settingsOpen`（WorkspaceShell が持つ）1つ。
   */
  readonly setFlag: (key: WhenKey, value: boolean) => () => void
  readonly userKeybindings: UserKeybindingsState
  /**
   * `keybindings.json` を丸ごと書き換え、表を作り直す。保存できたら true。
   *
   * 読み込みが済んでいない（`loading` / `failed`）間は何もせず false ──
   * 中身を知らないまま書くと、利用者の割り当てを消しうる。
   */
  readonly saveUserKeybindings: (entries: readonly StoredKeybindingEntry[]) => Promise<boolean>
}

export const KeybindingContext = createContext<KeybindingController | null>(null)

export function useKeybindings(): KeybindingController {
  const controller = useContext(KeybindingContext)

  if (controller === null) {
    throw new Error('useKeybindings must be used inside <KeybindingProvider>.')
  }

  return controller
}
