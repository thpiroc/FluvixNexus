import type { FileNameProblem } from '@shared/files'

/**
 * ツリーの中の入力欄が、今どの操作を受け付けるか（React にも DOM にも依存しない）。
 *
 * fileTreeModel.ts が「行の並び」を、editorTabState.ts が「タブの状態」を決めているのと
 * 同じ立ち位置で、**判断だけをデータとして切り出す**（FileNameInput.tsx は結果に従うだけ）。
 * 切り出しているのは、ここが取り違えやすい判断だからでもある。
 *
 * ## 「確定した」と「送信している」は別
 *
 * Enter を押しても、その名前が通るとは限らない。同名のものが既にある、権限が無い、
 * 直前に外から消された ── どれも**入力欄を閉じずに打ち直してもらう**べき失敗で、
 * IPC の往復が終わるまで結果は分からない。
 *
 * ここを1つの印（「もう確定した」）で済ませると、送信したまま失敗した入力欄が
 * **確定済みとして固まる**（Enter も Escape も blur も、二重送信の抑止に飲まれる）。
 * 打ち直すことも取り消すこともできない行がツリーに残り、
 * 逃げ道はパネルを閉じるくらいしかなくなる。
 *
 * ```
 * editing ──Enter──▶ submitting ──失敗──▶ editing      打ち直して再試行できる
 *    │                    │
 *    │                    └───成功──▶ settled           入力欄はこの後消える
 *    └──Escape / blur────────────────▶ settled
 * ```
 *
 * **抑えるのは submitting のあいだだけ。** 二重送信を防ぎたいのは応答を待っている
 * 区間であって、失敗した後ではない。
 */
export type NameEditStatus =
  /** 打っている最中。Enter も Escape も受け付ける。 */
  | 'editing'
  /** 確定を依頼して、結果を待っている。 */
  | 'submitting'
  /** 決着した（確定できた / 取り消した）。入力欄はこの後消える。 */
  | 'settled'

export const INITIAL_NAME_EDIT_STATUS: NameEditStatus = 'editing'

/**
 * Enter を受け付けてよいか。
 *
 * 名前に問題があるあいだは送らない（Main を1文字ごとに呼ぶ意味が無い）。
 * ただし **Main は同じ検査をやり直す**ので、ここを通ったことが許可を意味するわけではない。
 */
export function acceptsCommit(status: NameEditStatus, problem: FileNameProblem | null): boolean {
  return status === 'editing' && problem === null
}

/**
 * Escape / blur を受け付けてよいか。
 *
 * 名前が不正でも取り消しは通す ── 打ち直せない名前のまま閉じられないのは、
 * 固まっているのと変わらない。
 */
export function acceptsCancel(status: NameEditStatus): boolean {
  return status === 'editing'
}

/** 確定を依頼した直後の状態。 */
export function beginCommit(): NameEditStatus {
  return 'submitting'
}

/**
 * 依頼の結果が返った後の状態。
 *
 * **失敗したら editing へ戻す。** ここが戻らないことが、入力欄が固まる原因になる。
 */
export function endCommit(committed: boolean): NameEditStatus {
  return committed ? 'settled' : 'editing'
}

/** 取り消した後の状態。 */
export function cancelEdit(): NameEditStatus {
  return 'settled'
}
