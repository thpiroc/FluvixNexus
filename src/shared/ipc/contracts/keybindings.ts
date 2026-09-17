import type { KeybindingsFileStatus, StoredKeybindingEntry } from '../../keybindings'

/**
 * keybindings ドメインの IPC 契約（Shortcuts S3）。
 *
 * ## 設定の2本とは別の口にする
 *
 * `settings:save-section` は「既知の section を1つ、string / number / boolean の値で」
 * という閉じた形で、配列を持てない。そこを広げると**全 section が配列を受け取れる**
 * ことになるため、用途を1つに限った口を別に切る（ARCHITECTURE.md §5）。
 *
 *   keybindings:load … `keybindings.json` を読む
 *   keybindings:save … `keybindings.json` を丸ごと書き直す
 *
 * ## Renderer は保存先を選べない
 *
 * 要求にパスもファイル名も無い。渡せるのは「行の並び」だけで、Main がその形を
 * 確かめてから書く（main/store/keybindingsDocument.ts）。
 *
 * ## 保存は丸ごと
 *
 * 行の並び順そのものに意味がある（後ろが勝つ・解除は前の行に効く）ので、
 * 1行ずつの差し替えにはしない。数百行が上限で、丸ごと書いても小さい。
 */

export interface LoadKeybindingsResponse {
  readonly status: KeybindingsFileStatus
  /** 形の合った行（並び順のまま）。`missing` / `unreadable` では空。 */
  readonly entries: readonly StoredKeybindingEntry[]
  /** 形が合わず読み飛ばした行の数（オブジェクトでない・`key` が文字列でない など）。 */
  readonly skippedCount: number
}

export interface SaveKeybindingsRequest {
  readonly entries: readonly StoredKeybindingEntry[]
}

export interface KeybindingsIpcContract {
  'keybindings:load': {
    request: void
    response: LoadKeybindingsResponse
  }
  'keybindings:save': {
    request: SaveKeybindingsRequest
    response: void
  }
}
