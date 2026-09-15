import { createContext, useContext } from 'react'
import type { DebugProfile, DebugProfileDraft, DebugSessionStatus } from '@shared/debug'
import type { TranslationKey } from '../i18n/messages'

export interface DebugController {
  readonly profiles: readonly DebugProfile[]
  readonly selectedProfileId: string | null
  readonly selectedProfile: DebugProfile | null
  readonly status: DebugSessionStatus | null
  readonly loadingProfiles: boolean
  readonly busy: boolean
  readonly messageKey: TranslationKey | null
  readonly selectProfile: (profileId: string | null) => void
  readonly setMessageKey: (messageKey: TranslationKey | null) => void
  readonly createProfile: (draft: DebugProfileDraft) => Promise<boolean>
  readonly updateProfile: (profileId: string, draft: DebugProfileDraft) => Promise<boolean>
  readonly deleteSelectedProfile: () => Promise<boolean>
}

export const DebugContext = createContext<DebugController | null>(null)

export function useDebug(): DebugController {
  const controller = useContext(DebugContext)

  if (controller === null) {
    throw new Error('useDebug must be used inside a <DebugProvider>.')
  }

  return controller
}
