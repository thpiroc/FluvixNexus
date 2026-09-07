import { useCallback, useEffect, useRef } from 'react'
import type { LanguageServerStatus } from '@shared/lsp'
import { fluvix } from '../../api/fluvix'
import { useI18n } from '../../i18n/context'
import type { TranslationKey } from '../../i18n/messages'
import type { EditorDocumentStore } from '../monaco/documentStore'
import type { RenameFailure } from '../monaco/lspRename'

/**
 * Rename の provider を、Workspace が開いている間だけ立てる（Session 5-9）。
 *
 * 組み立ては整形（useFormatting.ts）と同じで、違うのは2つだけになる。
 *
 *   - **断りの文面をここで作る。** i18n は React の外から読めないため、
 *     provider には「理由 → 1行」の関数だけを渡す
 *   - **順番の鍵が2つ**（prepare と rename）。同じ Rename の中で
 *     前者が後者より遅れて返ることがあり、1つの鍵では取り違える
 *
 * Monaco の実体（lspRename.ts）を動的 import するのも同じ理由で、
 * この hook を読むだけで Monaco が読み込まれないようにするため。
 */
export function useRename(documents: EditorDocumentStore, workspaceId: string | null): void {
  const { t } = useI18n()
  const statusesRef = useRef<readonly LanguageServerStatus[]>([])
  const prepareSequenceRef = useRef(0)
  const renameSequenceRef = useRef(0)

  /*
    描画のたびに最新を控える。provider は React の描画とは別の時間軸で走るため、
    翻訳の関数も ref 越しに読む ── 言語を切り替えただけで provider を
    登録し直すことのないようにする（登録し直すと、その瞬間に走っている
    Rename の provider が Monaco から外れる）。
  */
  const translateRef = useRef(t)

  translateRef.current = t

  const describeFailure = useCallback(
    (failure: RenameFailure, files?: readonly string[]): string =>
      translateRef.current(RENAME_FAILURE_KEYS[failure], {
        files: (files ?? []).join(', ')
      }),
    []
  )

  useEffect(() => {
    if (workspaceId === null) {
      statusesRef.current = []

      return
    }

    let disposed = false
    let cleanupRegistration: (() => void) | null = null

    const renameModule = import('../monaco/lspRename')

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

    void renameModule.then(({ registerLspRenameProvider }) => {
      if (disposed) {
        return
      }

      const registration = registerLspRenameProvider({
        documents,
        describeFailure,
        getStatuses: () => statusesRef.current,
        nextPrepareSequence: () => {
          prepareSequenceRef.current += 1
          return prepareSequenceRef.current
        },
        isLatestPrepareSequence: (sequence) => sequence === prepareSequenceRef.current,
        nextRenameSequence: () => {
          renameSequenceRef.current += 1
          return renameSequenceRef.current
        },
        isLatestRenameSequence: (sequence) => sequence === renameSequenceRef.current
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
      /*
        走っている要求の答えを捨てる。Workspace が切り替わった後に届いた答えを
        今の文書へ当てないため（Files / Editor の読み込みと同じ扱い）。
      */
      prepareSequenceRef.current += 1
      renameSequenceRef.current += 1
    }
  }, [describeFailure, documents, workspaceId])
}

/** 理由と、利用者へ出す1行の対応（i18n の鍵）。 */
const RENAME_FAILURE_KEYS: Readonly<Record<RenameFailure, TranslationKey>> = {
  'not-renameable': 'lsp.rename.notRenameable',
  'invalid-name': 'lsp.rename.invalidName',
  'unsupported-edit': 'lsp.rename.unsupportedEdit',
  'outside-workspace': 'lsp.rename.outsideWorkspace',
  'too-many-edits': 'lsp.rename.tooManyEdits',
  malformed: 'lsp.rename.malformed',
  'server-error': 'lsp.rename.serverError',
  stale: 'lsp.rename.stale',
  'write-failed': 'lsp.rename.writeFailed'
}
