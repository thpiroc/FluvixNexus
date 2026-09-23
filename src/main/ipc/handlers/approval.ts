import { IPC_CHANNELS } from '@shared/ipc'
import { respondToApproval } from '../../security/approval'
import { handleIpc } from '../registry'

/**
 * approval ドメインのハンドラ（FN Agent の操作の承認。Security Core v1 の STEP6）。
 *
 * ここが持つのは**経路だけ。** 届いた値が扱ってよい形かの検査も、どの確認に
 * 対するものかの引き当ても、承認するかの判断も、すべて Security Core が行う
 * （main/security/approval/approvalManager.ts）。
 *
 * ## どのウィンドウからの意思表示かは Renderer に言わせない
 *
 * registry が送信元のウィンドウを検証して `context.window` として渡す。その
 * ウィンドウに対して Main の Native 確認を出すため、**アプリのウィンドウ以外から
 * 承認を進める経路がそもそも作れない**（window ドメインの handler と同じ線）。
 *
 * ## 何も返さない
 *
 * 結論を Renderer へ返さない。**承認されたかどうかは Renderer の関心事ではなく**、
 * 承認を使うのは Main の中の後続の Gate（STEP7 / STEP8）にあたるため。
 * 形が違う値・知らない id は、失敗としてではなく**拒否として**静かに捨てられる
 * （Renderer へ「どの id なら生きているか」を教えない）。
 */

export function registerApprovalHandlers(): void {
  handleIpc(IPC_CHANNELS.APPROVAL_RESPOND, async (request, context): Promise<void> => {
    await respondToApproval(request, context.window)
  })
}
