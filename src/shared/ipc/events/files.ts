import type { WorkspaceFileChange } from '../../files/change'

/**
 * files ドメインの Main → Renderer イベント。
 *
 * 要求と応答（contracts/files.ts）と対になる形で、Main の側から一方的に流れる通知を定義する。
 */

/**
 * その変化がどこで起きたか。
 *
 * | 値        | いつ                                                     |
 * | --------- | -------------------------------------------------------- |
 * | `app`     | Renderer からの要求（作成 / 改名 / 削除）の結果          |
 * | `watcher` | アプリの外での変更（main/files/workspaceWatcher.ts）     |
 *
 * **変化1件の形（WorkspaceFileChange）は同じにしてある。** 受け手の大半は
 * どちらから来たかを気にしない（消えたフォルダを畳む・親を読み直す、は理由によらず同じ）。
 * それでも区別を残すのは、Editor の Conflict の扱いが**アプリの外での変更に限られる**ため。
 * 自分の保存で自分の Model を Conflict にしてしまわないよう、
 * 「これは外で起きた」と言える手段を型として持たせておく。
 */
export type WorkspaceFileChangeSource = 'app' | 'watcher'

export interface WorkspaceFilesChangedEvent {
  /**
   * どの Workspace で起きた変化か。
   *
   * 応答（ReadWorkspaceDirectoryResponse）に workspaceId を載せているのと同じ理由。
   * 切り替えの前後で通知が行き違うため、受け手は自分が今表示している Workspace の
   * id と突き合わせ、違えば捨てる。イベントには「要求」という対応関係が無く、
   * 受け手側で世代を数える手段が無いぶん、この照合の重みは応答より大きい。
   */
  readonly workspaceId: string
  /** どこで起きた変化か。 */
  readonly source: WorkspaceFileChangeSource
  /**
   * 起きた変化。
   *
   * 配列で運ぶのは、ファイル変更監視（main/files/workspaceWatcher.ts）が
   * 同じイベントを使うため。監視では複数の変化がまとめて届き、1件ずつ通知すると
   * 受け手が同じフォルダを何度も読み直すことになる。
   */
  readonly changes: readonly WorkspaceFileChange[]
}

/**
 * files ドメインのイベント契約。
 *
 * 要求と応答の契約（FilesIpcContract）が `{ request, response }` を持つのに対し、
 * イベントは片道なので payload の型そのものを値にする。
 */
export interface FilesIpcEventContract {
  'files:changed': WorkspaceFilesChangedEvent
}
