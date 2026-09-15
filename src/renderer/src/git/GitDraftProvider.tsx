import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
  type SetStateAction
} from 'react'

/*
 * Commit message は Git パネルの一時入力だが、パネルのタブ切り替えや Dock の都合で
 * GitView が作り直されても失わせてはいけない。Workspace ごとに分け、Commit 成功時に
 * 空へ戻すだけにして、失敗時の書き直しや merge message の自動入力は GitView 側の
 * 既存の経路をそのまま使う。
 */

type DraftUpdater = SetStateAction<string>

interface GitDraftContextValue {
  readonly drafts: ReadonlyMap<string, string>
  readonly setDraft: (workspaceKey: string, updater: DraftUpdater) => void
}

const GitDraftContext = createContext<GitDraftContextValue | null>(null)

function applyDraftUpdater(previous: string, updater: DraftUpdater): string {
  return typeof updater === 'function'
    ? (updater as (current: string) => string)(previous)
    : updater
}

export function GitDraftProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map())

  const setDraft = useCallback((workspaceKey: string, updater: DraftUpdater): void => {
    setDrafts((previous) => {
      const current = previous.get(workspaceKey) ?? ''
      const draft = applyDraftUpdater(current, updater)

      if (draft === current) {
        return previous
      }

      const next = new Map(previous)

      if (draft.length === 0) {
        next.delete(workspaceKey)
      } else {
        next.set(workspaceKey, draft)
      }

      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      drafts,
      setDraft
    }),
    [drafts, setDraft]
  )

  return <GitDraftContext.Provider value={value}>{children}</GitDraftContext.Provider>
}

export function useGitCommitDraft(workspaceKey: string): {
  readonly message: string
  readonly setMessage: (updater: DraftUpdater) => void
} {
  const value = useContext(GitDraftContext)

  if (value === null) {
    throw new Error('useGitCommitDraft must be used inside <GitDraftProvider>.')
  }

  const message = value.drafts.get(workspaceKey) ?? ''

  const setMessage = useCallback(
    (updater: DraftUpdater): void => {
      value.setDraft(workspaceKey, updater)
    },
    [value, workspaceKey]
  )

  return { message, setMessage }
}
