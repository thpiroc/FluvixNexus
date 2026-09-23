import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { AgentTerminalProposedEvent, ApprovalRequestedEvent } from '@shared/ipc'
import type { SafeTerminalCommandDisplay, SafeTerminalRunResult } from '@shared/security'
import { fluvix } from '../api/fluvix'
import { AgentTerminalDialog, AgentTerminalResultDialog } from './AgentTerminalDialog'
import { matchAgentTerminal } from './agentTerminalPrompt'

/**
 * FN Agent の Terminal の確認と結果を、アプリ全体で1つだけ出す器（Security Core v1 の STEP8）。
 *
 * AgentFileWriteProvider.tsx と同じ作り。Main から届く2つの知らせ
 * （`agent-terminal:proposed` と `approval:requested`）を持ち、揃ったら確認を出す。
 * **判断は持たない** ── 出してよいかは agentTerminalPrompt.ts が決め、承認するかは
 * Main が決める。
 *
 * ## Renderer が返すのは意思表示だけ
 *
 * `approval.respond` へ返すのは、**Main が発番した `approvalId`** と
 * `actionKind: 'terminal.run'` と `'continue'` / `'cancel'` の3つ。コマンドも引数も
 * 承認の状態も返さない（契約の型にも無い）。
 *
 * ## 続行の後も画面は閉じない
 *
 * Native の確認の結果が出るまで、ボタンを押せないまま残る。Main が
 * `agent-terminal:settled` を送ってきたら、
 *
 *   - 実行した（結果が載っている）→ 結果の画面へ替える。閉じるのは利用者
 *   - 実行しなかった（拒否・取り消し・期限切れ）→ そのまま閉じる
 *
 * 結果の画面は**見るだけ**で、もう一度実行する・コマンドを変えて実行する、にあたる
 * 操作は置かない（Renderer から Main を呼ぶ口を作らない）。
 */
export function AgentTerminalProvider(): JSX.Element | null {
  const [proposal, setProposal] = useState<AgentTerminalProposedEvent | null>(null)
  const [approval, setApproval] = useState<ApprovalRequestedEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState<{
    readonly command: SafeTerminalCommandDisplay
    readonly result: SafeTerminalRunResult
  } | null>(null)

  /*
    settled の知らせは購読の中で受けるため、今の提案を ref でも持つ
    （state の更新関数の中で別の state を変える形にしない）。
  */
  const proposalRef = useRef<AgentTerminalProposedEvent | null>(null)

  useEffect(() => {
    proposalRef.current = proposal
  }, [proposal])

  useEffect(() => {
    const unsubscribe = fluvix.agent.onTerminalProposed((event) => {
      // 描き直しを待たずに控える（すぐ後に settled が届いても取りこぼさない）。
      proposalRef.current = event
      setProposal(event)
      setBusy(false)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = fluvix.agent.onTerminalSettled((event) => {
      const current = proposalRef.current

      if (current?.proposalId !== event.proposalId) {
        // 終わったのは別の提案。今出しているものはそのまま。
        return
      }

      proposalRef.current = null
      setProposal(null)
      setApproval(null)
      setBusy(false)

      if (event.result !== null) {
        setFinished({ command: current.command, result: event.result })
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = fluvix.approval.onRequested((event) => {
      if (event.actionKind !== 'terminal.run') {
        // File Write の承認（STEP7）。この画面の対象ではない。
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
      await fluvix.approval.respond({ approvalId, actionKind: 'terminal.run', intent })
    } catch {
      /*
        返事を届けられなかった。**実行は起きない**（承認は Main の側で期限まで
        pending のまま残り、やがて失効する）。画面は settled を待って閉じる。
      */
    }
  }, [])

  const match = matchAgentTerminal(proposal, approval)
  const mismatchedApprovalId = match.kind === 'mismatch' ? match.approvalId : null

  useEffect(() => {
    if (mismatchedApprovalId === null) {
      return
    }

    void respond(mismatchedApprovalId, 'cancel')
  }, [mismatchedApprovalId, respond])

  if (match.kind === 'ready') {
    const { prompt } = match

    return (
      <AgentTerminalDialog
        prompt={prompt}
        busy={busy}
        onContinue={() => void respond(prompt.approvalId, 'continue')}
        onCancel={() => void respond(prompt.approvalId, 'cancel')}
      />
    )
  }

  if (finished !== null) {
    return (
      <AgentTerminalResultDialog
        command={finished.command}
        result={finished.result}
        onClose={() => setFinished(null)}
      />
    )
  }

  return null
}
