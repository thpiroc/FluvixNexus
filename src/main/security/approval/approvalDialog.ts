import { dialog, type BrowserWindow } from 'electron'
import { createLogger } from '../../logger'
import type { ApprovalConfirmation, ApprovalWindow } from './approvalManager'
import { describeTerminalCommand, type ApprovalSafeSummary } from './approvalSummary'

/**
 * 承認の第2段階（Security Core v1 の STEP6）。Main の Native 確認。
 *
 * Renderer の確認だけでは承認にしない、という方針の実体がここにあたる。
 * アプリの中のモーダル（files/DeleteConfirm.tsx のような作り）を使わないのは、
 * **Renderer の画面が確認を出したことにできてしまう**ため ── 承認を成立させる
 * 最後の1歩は、Renderer が描けない場所に置く。
 *
 * ## 出すのは安全な要約だけ
 *
 * 書き込む本文も Diff 本文も出さない。出すのは approvalSummary.ts が Mask した後の
 * 文字列（対象の相対 Path・コマンドと引数）だけで、**Secret はここへ届く前に伏せてある。**
 *
 * ```
 * File Write   FN Agent が Workspace 内のファイルを変更しようとしています。
 *              対象: src/example.ts
 * Terminal     FN Agent がコマンドを実行しようとしています。
 *              コマンド: npm / 引数を1つずつ / 場所（省略しない。STEP8）
 * ```
 *
 * ## 既定は「許可しない」
 *
 * `defaultId` も `cancelId` も取り消し側に置く。Enter を押した勢いや、
 * ウィンドウを × で閉じた場合は `cancelId` が返るため、**そのまま拒否になる。**
 *
 * ## 失敗は拒否
 *
 * 確認を出せなかった場合は例外をそのまま投げ、Manager が `dialog-failed` として
 * 拒否する（approvalManager.ts）。確認を出せないことを「たぶん良いのだろう」に
 * 読み替える経路は無い。
 */

const log = createLogger('security')

/** 取り消しの選択肢の位置（× で閉じたときもこれが返る）。 */
const CANCEL_BUTTON_INDEX = 0

/** 許可の選択肢の位置。 */
const APPROVE_BUTTON_INDEX = 1

export async function confirmApprovalNatively(
  summary: ApprovalSafeSummary,
  window: ApprovalWindow
): Promise<ApprovalConfirmation> {
  const { message, detail } = describeApproval(summary)

  const result = await dialog.showMessageBox(window as BrowserWindow, {
    type: 'warning',
    title: 'FN Agent の操作の承認',
    message,
    detail,
    buttons: ['許可しない', '許可する'],
    defaultId: CANCEL_BUTTON_INDEX,
    cancelId: CANCEL_BUTTON_INDEX,
    // Windows で選択肢をリンク風に並べ替えさせない（位置が変わると既定が読めなくなる）。
    noLink: true
  })

  if (result.response !== APPROVE_BUTTON_INDEX) {
    return 'cancel'
  }

  log.info(`the user approved an agent ${summary.actionKind} operation.`)

  return 'approve'
}

/** 確認に出す文面。**要約に無いものは書けない。** */
function describeApproval(summary: ApprovalSafeSummary): {
  readonly message: string
  readonly detail: string
} {
  if (summary.actionKind === 'file.write') {
    return {
      message: 'FN Agent が Workspace 内のファイルを変更しようとしています。',
      detail: `対象: ${summary.subject}`
    }
  }

  return {
    message: 'FN Agent がコマンドを実行しようとしています。',
    detail: describeTerminalCommand(summary)
  }
}
