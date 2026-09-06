import { useEffect, useRef } from 'react'
import type { LanguageServerStatus } from '@shared/lsp'
import { fluvix } from '../../api/fluvix'
import type { EditorDocumentStore } from '../monaco/documentStore'

export function useCompletion(documents: EditorDocumentStore, workspaceId: string | null): void {
  const statusesRef = useRef<readonly LanguageServerStatus[]>([])
  const sequenceRef = useRef(0)

  useEffect(() => {
    if (workspaceId === null) {
      statusesRef.current = []

      return
    }

    let disposed = false
    let cleanupRegistration: (() => void) | null = null

    const completionModule = import('../monaco/lspCompletion')

    function setStatuses(statuses: readonly LanguageServerStatus[]): void {
      statusesRef.current = statuses
    }

    const unsubscribeStatus = fluvix.lsp.onStatusChanged((event) => {
      setStatuses(event.servers)
    })

    void fluvix.lsp.getStatus().then((result) => {
      if (!disposed && result.ok && statusesRef.current.length === 0) {
        setStatuses(result.data.servers)
      }
    })

    void completionModule.then(({ registerLspCompletionProvider }) => {
      if (disposed) {
        return
      }

      const registration = registerLspCompletionProvider({
        documents,
        getStatuses: () => statusesRef.current,
        nextSequence: () => {
          sequenceRef.current += 1
          return sequenceRef.current
        },
        isLatestSequence: (sequence) => sequence === sequenceRef.current
      })

      if (disposed) {
        registration.dispose()
        return
      }

      cleanupRegistration = registration.dispose
    })

    return () => {
      disposed = true
      unsubscribeStatus()
      cleanupRegistration?.()
      statusesRef.current = []
      sequenceRef.current += 1
    }
  }, [documents, workspaceId])
}
