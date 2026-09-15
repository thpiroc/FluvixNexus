import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
  type SetStateAction,
  type JSX
} from 'react'
import { WORKSPACE_ROOT_RELATIVE_PATH } from '@shared/files'

/*
 * Files ツリーのうち、Panel の mount / unmount を越えて残す必要がある状態。
 *
 * 読み込み済みの directories は useFileTree.ts の寿命でよい。戻ってきたときは、
 * ここに残っている expanded から必要なフォルダだけ既存の Lazy Load 経路で読み直す。
 * Workspace ごとの key で分けるため、別 Workspace の展開状態は混ざらない。
 */

type ExpandedUpdater = SetStateAction<ReadonlySet<string>>

interface FileTreeStateContextValue {
  readonly expandedByWorkspace: ReadonlyMap<string, ReadonlySet<string>>
  readonly setExpanded: (workspaceKey: string, updater: ExpandedUpdater) => void
}

const FileTreeStateContext = createContext<FileTreeStateContextValue | null>(null)

function createInitialExpanded(): ReadonlySet<string> {
  return new Set([WORKSPACE_ROOT_RELATIVE_PATH])
}

function applyExpandedUpdater(
  previous: ReadonlySet<string>,
  updater: ExpandedUpdater
): ReadonlySet<string> {
  return typeof updater === 'function'
    ? (updater as (current: ReadonlySet<string>) => ReadonlySet<string>)(previous)
    : updater
}

export function FileTreeStateProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [expandedByWorkspace, setExpandedByWorkspace] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map())

  const setExpanded = useCallback((workspaceKey: string, updater: ExpandedUpdater): void => {
    setExpandedByWorkspace((previous) => {
      const current = previous.get(workspaceKey) ?? createInitialExpanded()
      const expanded = applyExpandedUpdater(current, updater)

      if (expanded === current && previous.has(workspaceKey)) {
        return previous
      }

      const next = new Map(previous)
      next.set(workspaceKey, expanded)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      expandedByWorkspace,
      setExpanded
    }),
    [expandedByWorkspace, setExpanded]
  )

  return <FileTreeStateContext.Provider value={value}>{children}</FileTreeStateContext.Provider>
}

export function useFileTreeExpanded(workspaceKey: string): {
  readonly expanded: ReadonlySet<string>
  readonly setExpanded: (updater: ExpandedUpdater) => void
} {
  const value = useContext(FileTreeStateContext)

  if (value === null) {
    throw new Error('useFileTreeExpanded must be used inside <FileTreeStateProvider>.')
  }

  const expanded = value.expandedByWorkspace.get(workspaceKey) ?? createInitialExpanded()

  const setExpanded = useCallback(
    (updater: ExpandedUpdater): void => {
      value.setExpanded(workspaceKey, updater)
    },
    [value, workspaceKey]
  )

  return { expanded, setExpanded }
}
