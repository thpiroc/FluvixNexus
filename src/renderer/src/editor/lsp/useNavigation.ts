import { useEffect, useRef } from 'react'
import type { LanguageServerStatus } from '@shared/lsp'
import { fluvix } from '../../api/fluvix'
import type { EditorDocumentStore } from '../monaco/documentStore'
import { shouldUseLspNavigation } from './navigationAvailability'

export function useNavigation(
  documents: EditorDocumentStore,
  workspaceId: string | null,
  openFileAt: (input: {
    readonly relativePath: string
    readonly name: string
    readonly line: number
    readonly column: number
    readonly length?: number
  }) => void
): void {
  const statusesRef = useRef<readonly LanguageServerStatus[]>([])
  const definitionSequenceRef = useRef(0)
  const referencesSequenceRef = useRef(0)

  useEffect(() => {
    if (workspaceId === null) {
      statusesRef.current = []

      return
    }

    let disposed = false
    let cleanupRegistration: (() => void) | null = null

    const navigationModule = import('../monaco/lspNavigation')
    const monacoSetupModule = import('../monaco/monacoSetup')

    async function setBuiltInSuppressed(suppressed: boolean): Promise<void> {
      const { setBuiltInDefinitionSuppressed, setBuiltInReferencesSuppressed } =
        await monacoSetupModule
      const next = disposed ? false : suppressed

      setBuiltInDefinitionSuppressed(next)
      setBuiltInReferencesSuppressed(next)
    }

    function applyBuiltInMode(statuses: readonly LanguageServerStatus[]): void {
      const useLsp =
        shouldUseLspNavigation('typescript', statuses) ||
        shouldUseLspNavigation('javascript', statuses)

      void setBuiltInSuppressed(useLsp)
    }

    function setStatuses(statuses: readonly LanguageServerStatus[]): void {
      statusesRef.current = statuses
      applyBuiltInMode(statuses)
    }

    const unsubscribeStatus = fluvix.lsp.onStatusChanged((event) => {
      setStatuses(event.servers)
    })

    void fluvix.lsp.getStatus().then((result) => {
      if (!disposed && result.ok && statusesRef.current.length === 0) {
        setStatuses(result.data.servers)
      }
    })

    void navigationModule.then(({ registerLspNavigationProvider }) => {
      if (disposed) {
        return
      }

      const registration = registerLspNavigationProvider({
        documents,
        openFileAt,
        getStatuses: () => statusesRef.current,
        nextDefinitionSequence: () => {
          definitionSequenceRef.current += 1
          return definitionSequenceRef.current
        },
        isLatestDefinitionSequence: (sequence) => sequence === definitionSequenceRef.current,
        nextReferencesSequence: () => {
          referencesSequenceRef.current += 1
          return referencesSequenceRef.current
        },
        isLatestReferencesSequence: (sequence) => sequence === referencesSequenceRef.current
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
      void setBuiltInSuppressed(false)
      definitionSequenceRef.current += 1
      referencesSequenceRef.current += 1
    }
  }, [documents, openFileAt, workspaceId])
}
