import { useCallback, useEffect, useState, type JSX } from 'react'
import type { AgentFileWriteProposedEvent, ApprovalRequestedEvent } from '@shared/ipc'
import { fluvix } from '../api/fluvix'
import { AgentFileWriteDialog } from './AgentFileWriteDialog'
import { matchAgentFileWrite } from './agentFileWritePrompt'

/**
 * FN Agent の File Write の確認を、アプリ全体で1つだけ出す器（Security Core v1 の STEP7）。
 *
 * Main から届く2つの知らせ（`agent-file-write:proposed` と `approval:requested`）を
 * 持ち、揃ったら画面を出す。**判断は持たない** ── 出してよいかは
 * agentFileWritePrompt.ts が決め、承認するかは Main が決める。
 *
 * ## Renderer が返すのは意思表示だけ
 *
 * `approval.respond` へ返すのは、**Main が発番した `approvalId`** と
 * `actionKind` と `'continue'` / `'cancel'` の3つ。本文も Diff も承認の状態も
 * 返さない（契約の型にも無い。shared/ipc/contracts/approval.ts）。
 *
 * ## 続行の後も画面は閉じない
 *
 * `'continue'` を返すと Main が Native の確認を出す。その結果が出るまで、この画面は
 * **ボタンを押せない状態のまま残る** ── 先に閉じてしまうと、Native の確認だけが
 * 宙に浮いて「何に対する確認か」が画面から消える。閉じるのは Main が
 * `agent-file-write:settled` を送ってきたとき（承認されて書かれた・拒否された・
 * 期限切れ、のいずれでも届く）。
 *
 * ## 取り違えたら、待たずに取り消す
 *
 * 2つの知らせが別の変更を指していた場合は、画面を出さずに `'cancel'` を返す。
 * 見せられない承認を 5 分の期限まで放っておくと、利用者には「何も起きない」ように
 * しか見えない。
 */
export function AgentFileWriteProvider(): JSX.Element | null {
  const [proposal, setProposal] = useState<AgentFileWriteProposedEvent | null>(null)
  const [approval, setApproval] = useState<ApprovalRequestedEvent | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsubscribe = fluvix.agent.onFileWriteProposed((event) => {
      setProposal(event)
      setBusy(false)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = fluvix.agent.onFileWriteSettled((event) => {
      // 終わった提案の分だけ片付ける（次の提案がもう届いているかもしれない）。
      setProposal((current) => (current?.proposalId === event.proposalId ? null : current))
      setApproval(null)
      setBusy(false)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = fluvix.approval.onRequested((event) => {
      if (event.actionKind !== 'file.write') {
        // Terminal の承認（STEP8）。この画面の対象ではない。
        return
      }

      setApproval(event)
      setBusy(false)
    })

    return unsubscribe
  }, [])

  const respond = useCallback(async (approvalId: string, intent: 'continue' | 'cancel') => {
    setBusy(true)

    try {
      await fluvix.approval.respond({ approvalId, actionKind: 'file.write', intent })
    } catch {
      /*
        返事を届けられなかった。**書き込みは起きない**（承認は Main の側で期限まで
        pending のまま残り、やがて失効する）。画面は settled を待って閉じる。
      */
    }
  }, [])

  const match = matchAgentFileWrite(proposal, approval)

  /*
    依存に入れるのは**識別子だけ。** 判定そのものは描くたびに新しい値になるため、
    それを依存にすると取り消しを送り続けることになる。
  */
  const mismatchedApprovalId = match.kind === 'mismatch' ? match.approvalId : null

  useEffect(() => {
    if (mismatchedApprovalId === null) {
      return
    }

    void respond(mismatchedApprovalId, 'cancel')
  }, [mismatchedApprovalId, respond])

  if (match.kind !== 'ready') {
    return null
  }

  const { prompt } = match

  return (
    <AgentFileWriteDialog
      prompt={prompt}
      busy={busy}
      onContinue={() => void respond(prompt.approvalId, 'continue')}
      onCancel={() => void respond(prompt.approvalId, 'cancel')}
    />
  )
}
