import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { DebugControlOutcome, DebugProfile, DebugProfileDraft } from '@shared/debug'
import { fluvix } from '../api/fluvix'
import { useCommand } from '../commands/useCommand'
import type { TranslationKey } from '../i18n/messages'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import {
  canRunDebugToolbarAction,
  debugControlOutcomeKey,
  debugIpcErrorKey,
  debugProfileRejectionKey,
  debugProfileValidationKey,
  debugStartOutcomeKey,
  type DebugToolbarActionId
} from './debugToolbarModel'
import { DebugContext, type DebugController } from './debugControlContext'
import { useDebugSessionStatus } from './useDebugSessionStatus'

/**
 * Debug の実行操作と Profile 選択を、Debug Panel の寿命より長く持つ器。
 *
 * DebugToolbar は Panel のレイアウト次第で mount / unmount されるため、F5 などの
 * command と「今どの Profile を選んでいるか」の正本にはできない。ここを
 * WorkspaceFolderProvider の内側、KeybindingProvider の外側に置き、Editor を見ている
 * ときでも同じ command 表から Debug 操作へ届くようにする。
 */
export function DebugProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const workspaceFolder = useWorkspaceFolder()
  const workspaceId = workspaceFolder.workspace?.id ?? null
  const hasWorkspace = workspaceFolder.status === 'ready' && workspaceFolder.workspace !== null
  const status = useDebugSessionStatus()
  const [profiles, setProfiles] = useState<readonly DebugProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [messageKey, setMessageKey] = useState<TranslationKey | null>(null)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const workspaceIdRef = useRef<string | null>(workspaceId)
  const selectedProfileRef = useRef<DebugProfile | null>(null)
  const busyRef = useRef(false)

  workspaceIdRef.current = workspaceId

  const selectedProfile =
    profiles.find((profile) => profile.profileId === selectedProfileId) ?? null
  selectedProfileRef.current = selectedProfile

  const setBusyState = useCallback((next: boolean): void => {
    busyRef.current = next
    setBusy(next)
  }, [])

  const replaceProfiles = useCallback(
    (nextProfiles: readonly DebugProfile[], preferredProfileId?: string | null): void => {
      setProfiles(nextProfiles)
      setSelectedProfileId((current) =>
        selectExistingProfileId(nextProfiles, preferredProfileId ?? current)
      )
    },
    []
  )

  const refreshProfiles = useCallback(async (): Promise<void> => {
    const requestedWorkspaceId = workspaceIdRef.current

    setLoadingProfiles(true)
    const result = await fluvix.debug.listProfiles()

    if (workspaceIdRef.current !== requestedWorkspaceId) {
      return
    }

    if (!result.ok) {
      replaceProfiles([], null)
      setMessageKey(debugIpcErrorKey(result.error))
      setLoadingProfiles(false)
      return
    }

    replaceProfiles(result.data.profiles)
    setLoadingProfiles(false)
  }, [replaceProfiles])

  useEffect(() => {
    replaceProfiles([], null)
    setMessageKey(null)

    if (!hasWorkspace) {
      setLoadingProfiles(false)
      return
    }

    void refreshProfiles()
  }, [hasWorkspace, refreshProfiles, replaceProfiles, workspaceId])

  const createProfile = useCallback(
    async (draft: DebugProfileDraft): Promise<boolean> => {
      setBusyState(true)
      const result = await fluvix.debug.createProfile({ profile: draft })

      if (!result.ok) {
        setMessageKey(debugIpcErrorKey(result.error))
        setBusyState(false)
        return false
      }

      let saved = false

      switch (result.data.status) {
        case 'saved':
          replaceProfiles(result.data.profiles, result.data.profile.profileId)
          setMessageKey('debug.profile.saved')
          saved = true
          break

        case 'invalid':
          setMessageKey(debugProfileValidationKey(result.data.field, result.data.reason))
          break

        case 'rejected':
          setMessageKey(debugProfileRejectionKey(result.data.reason))
          break
      }

      setBusyState(false)
      return saved
    },
    [replaceProfiles, setBusyState]
  )

  const updateProfile = useCallback(
    async (profileId: string, draft: DebugProfileDraft): Promise<boolean> => {
      setBusyState(true)
      const result = await fluvix.debug.updateProfile({ profileId, profile: draft })

      if (!result.ok) {
        setMessageKey(debugIpcErrorKey(result.error))
        setBusyState(false)
        return false
      }

      let saved = false

      switch (result.data.status) {
        case 'saved':
          replaceProfiles(result.data.profiles, result.data.profile.profileId)
          setMessageKey('debug.profile.saved')
          saved = true
          break

        case 'invalid':
          setMessageKey(debugProfileValidationKey(result.data.field, result.data.reason))
          break

        case 'rejected':
          setMessageKey(debugProfileRejectionKey(result.data.reason))
          break
      }

      setBusyState(false)
      return saved
    },
    [replaceProfiles, setBusyState]
  )

  const deleteSelectedProfile = useCallback(async (): Promise<boolean> => {
    const selected = selectedProfileRef.current

    if (selected === null) {
      setMessageKey('debug.toolbar.noSelectedProfile')
      return false
    }

    setBusyState(true)
    const result = await fluvix.debug.deleteProfile({ profileId: selected.profileId })

    if (!result.ok) {
      setMessageKey(debugIpcErrorKey(result.error))
      setBusyState(false)
      return false
    }

    if (result.data.status === 'deleted') {
      replaceProfiles(result.data.profiles, null)
      setMessageKey('debug.profile.deleted')
      setBusyState(false)
      return true
    }

    setMessageKey(debugProfileRejectionKey(result.data.reason))
    setBusyState(false)
    return false
  }, [replaceProfiles, setBusyState])

  const start = useCallback(async (): Promise<void> => {
    const selected = selectedProfileRef.current

    if (selected === null) {
      setMessageKey('debug.toolbar.noSelectedProfile')
      return
    }

    if (busyRef.current) {
      return
    }

    setBusyState(true)
    const result = await fluvix.debug.start({ profileId: selected.profileId })
    setMessageKey(result.ok ? debugStartOutcomeKey(result.data) : debugIpcErrorKey(result.error))
    setBusyState(false)
  }, [setBusyState])

  const runControl = useCallback(
    async (control: DebugControlCommand): Promise<void> => {
      if (busyRef.current) {
        return
      }

      setBusyState(true)
      const result = await control()
      setMessageKey(
        result.ok ? debugControlOutcomeKey(result.data) : debugIpcErrorKey(result.error)
      )
      setBusyState(false)
    },
    [setBusyState]
  )

  const continueDebug = useCallback(() => void runControl(fluvix.debug.continue), [runControl])
  const pauseDebug = useCallback(() => void runControl(fluvix.debug.pause), [runControl])
  const stepOver = useCallback(() => void runControl(fluvix.debug.stepOver), [runControl])
  const stepInto = useCallback(() => void runControl(fluvix.debug.stepInto), [runControl])
  const stepOut = useCallback(() => void runControl(fluvix.debug.stepOut), [runControl])
  const stopDebug = useCallback(() => void runControl(fluvix.debug.stop), [runControl])

  const hasSelectedProfile = selectedProfile !== null
  const actionEnabled = useMemo(
    () =>
      Object.fromEntries(
        DEBUG_ACTION_IDS.map((action) => [
          action,
          hasWorkspace && !busy && canRunDebugToolbarAction(action, status, hasSelectedProfile)
        ])
      ) as Readonly<Record<DebugToolbarActionId, boolean>>,
    [busy, hasSelectedProfile, hasWorkspace, status]
  )

  const startOrContinue = useCallback((): void => {
    if (actionEnabled.start) {
      void start()
      return
    }

    if (actionEnabled.continue) {
      continueDebug()
    }
  }, [actionEnabled, continueDebug, start])

  useCommand('debug.start', () => void start(), actionEnabled.start)
  useCommand('debug.continue', continueDebug, actionEnabled.continue)
  useCommand(
    'debug.startOrContinue',
    startOrContinue,
    actionEnabled.start || actionEnabled.continue
  )
  useCommand('debug.pause', pauseDebug, actionEnabled.pause)
  useCommand('debug.stepOver', stepOver, actionEnabled.stepOver)
  useCommand('debug.stepInto', stepInto, actionEnabled.stepInto)
  useCommand('debug.stepOut', stepOut, actionEnabled.stepOut)
  useCommand('debug.stop', stopDebug, actionEnabled.stop)

  const selectProfile = useCallback(
    (profileId: string | null): void => {
      setSelectedProfileId(selectExistingProfileId(profiles, profileId))
    },
    [profiles]
  )

  const value = useMemo<DebugController>(
    () => ({
      profiles,
      selectedProfileId,
      selectedProfile,
      status,
      loadingProfiles,
      busy,
      messageKey,
      selectProfile,
      setMessageKey,
      createProfile,
      updateProfile,
      deleteSelectedProfile
    }),
    [
      busy,
      createProfile,
      deleteSelectedProfile,
      loadingProfiles,
      messageKey,
      profiles,
      selectProfile,
      selectedProfile,
      selectedProfileId,
      status,
      updateProfile
    ]
  )

  return <DebugContext.Provider value={value}>{children}</DebugContext.Provider>
}

const DEBUG_ACTION_IDS: readonly DebugToolbarActionId[] = [
  'start',
  'continue',
  'pause',
  'stepOver',
  'stepInto',
  'stepOut',
  'stop'
]

function selectExistingProfileId(
  profiles: readonly DebugProfile[],
  requestedProfileId: string | null
): string | null {
  if (
    requestedProfileId !== null &&
    profiles.some((profile) => profile.profileId === requestedProfileId)
  ) {
    return requestedProfileId
  }

  return profiles[0]?.profileId ?? null
}

type DebugControlCommand = () => Promise<
  | { readonly ok: true; readonly data: DebugControlOutcome }
  | { readonly ok: false; readonly error: Parameters<typeof debugIpcErrorKey>[0] }
>
