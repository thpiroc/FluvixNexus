import {
  DEBUG_PROFILE_LANGUAGES,
  type DebugControlFailure,
  type DebugControlOutcome,
  type DebugControlRejection,
  type DebugProfile,
  type DebugProfileDraft,
  type DebugProfileField,
  type DebugProfileInvalidReason,
  type DebugProfileLanguage,
  type DebugProfileSaveRejection,
  type DebugSessionStatus,
  type DebugStartFailure,
  type DebugStartOutcome,
  type DebugStartRejection
} from '@shared/debug'
import type { IpcErrorPayload } from '@shared/ipc'
import type { CommandId } from '../commands/commandIds'
import type { TranslationKey } from '../i18n/messages'

export type DebugToolbarCommandId = Extract<
  CommandId,
  | 'debug.addProfile'
  | 'debug.editProfile'
  | 'debug.deleteProfile'
  | 'debug.startOrContinue'
  | 'debug.start'
  | 'debug.continue'
  | 'debug.pause'
  | 'debug.stepOver'
  | 'debug.stepInto'
  | 'debug.stepOut'
  | 'debug.stop'
>

export type DebugToolbarActionId =
  'start' | 'continue' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut' | 'stop'

export const DEBUG_TOOLBAR_ACTIONS: readonly {
  readonly id: DebugToolbarActionId
  readonly commandId: DebugToolbarCommandId
  readonly labelKey: TranslationKey
}[] = [
  { id: 'start', commandId: 'debug.start', labelKey: 'debug.toolbar.start' },
  { id: 'continue', commandId: 'debug.continue', labelKey: 'debug.toolbar.continue' },
  { id: 'pause', commandId: 'debug.pause', labelKey: 'debug.toolbar.pause' },
  { id: 'stepOver', commandId: 'debug.stepOver', labelKey: 'debug.toolbar.stepOver' },
  { id: 'stepInto', commandId: 'debug.stepInto', labelKey: 'debug.toolbar.stepInto' },
  { id: 'stepOut', commandId: 'debug.stepOut', labelKey: 'debug.toolbar.stepOut' },
  { id: 'stop', commandId: 'debug.stop', labelKey: 'debug.toolbar.stop' }
]

export function canRunDebugToolbarAction(
  action: DebugToolbarActionId,
  status: DebugSessionStatus | null,
  hasSelectedProfile: boolean
): boolean {
  switch (action) {
    case 'start':
      return status === 'idle' && hasSelectedProfile

    case 'pause':
      return status === 'running'

    case 'stop':
      return status === 'running' || status === 'stopped'

    case 'continue':
    case 'stepOver':
    case 'stepInto':
    case 'stepOut':
      return status === 'stopped'
  }
}

export interface DebugProfileFormState {
  readonly name: string
  readonly language: DebugProfileLanguage
  readonly programRelativePath: string
  readonly programArgsText: string
  readonly envText: string
  readonly stopOnEntry: boolean
}

export const EMPTY_DEBUG_PROFILE_FORM: DebugProfileFormState = {
  name: '',
  language: 'node',
  programRelativePath: '',
  programArgsText: '',
  envText: '',
  stopOnEntry: false
}

export type DebugProfileFormDraft =
  | { readonly status: 'ok'; readonly draft: DebugProfileDraft }
  | { readonly status: 'invalid-env-line' }

export function formFromDebugProfile(profile: DebugProfile): DebugProfileFormState {
  return {
    name: profile.name,
    language: profile.language,
    programRelativePath: profile.programRelativePath,
    programArgsText: profile.programArgs.join('\n'),
    envText: Object.entries(profile.env)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n'),
    stopOnEntry: profile.stopOnEntry
  }
}

export function draftFromDebugProfileForm(form: DebugProfileFormState): DebugProfileFormDraft {
  const env = parseEnvText(form.envText)

  if (env === null) {
    return { status: 'invalid-env-line' }
  }

  return {
    status: 'ok',
    draft: {
      name: form.name,
      language: form.language,
      programRelativePath: form.programRelativePath,
      programArgs: form.programArgsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      env,
      stopOnEntry: form.stopOnEntry
    }
  }
}

function parseEnvText(text: string): Record<string, string> | null {
  const env: Record<string, string> = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (line.length === 0) {
      continue
    }

    const separator = line.indexOf('=')

    if (separator <= 0) {
      return null
    }

    env[line.slice(0, separator).trim()] = line.slice(separator + 1)
  }

  return env
}

export function debugProfileLanguageNameKey(language: DebugProfileLanguage): TranslationKey {
  return `debug.profile.languageName.${language}`
}

export function isDebugProfileLanguageChoice(value: unknown): value is DebugProfileLanguage {
  return typeof value === 'string' && (DEBUG_PROFILE_LANGUAGES as readonly string[]).includes(value)
}

export function debugProfileValidationKey(
  field: DebugProfileField,
  _reason: DebugProfileInvalidReason
): TranslationKey {
  return `debug.profile.validation.${field}`
}

export function debugProfileRejectionKey(reason: DebugProfileSaveRejection): TranslationKey {
  switch (reason) {
    case 'no-workspace':
      return 'debug.profile.rejection.noWorkspace'
    case 'profile-not-found':
      return 'debug.profile.rejection.profileNotFound'
    case 'limit-reached':
      return 'debug.profile.rejection.limitReached'
  }
}

export function debugStartOutcomeKey(outcome: DebugStartOutcome): TranslationKey {
  switch (outcome.status) {
    case 'started':
      return 'debug.operation.started'
    case 'rejected':
      return debugStartRejectionKey(outcome.reason)
    case 'failed':
      return debugStartFailureKey(outcome.reason)
  }
}

export function debugControlOutcomeKey(outcome: DebugControlOutcome): TranslationKey {
  switch (outcome.status) {
    case 'accepted':
      return 'debug.operation.accepted'
    case 'rejected':
      return debugControlRejectionKey(outcome.reason)
    case 'failed':
      return debugControlFailureKey(outcome.reason)
  }
}

export function debugIpcErrorKey(_error: IpcErrorPayload): TranslationKey {
  return 'debug.operation.ipcFailed'
}

function debugStartRejectionKey(reason: DebugStartRejection): TranslationKey {
  switch (reason) {
    case 'no-workspace':
      return 'debug.operation.rejected.noWorkspace'
    case 'profile-not-found':
      return 'debug.operation.rejected.profileNotFound'
    case 'already-running':
      return 'debug.operation.rejected.alreadyRunning'
  }
}

function debugStartFailureKey(reason: DebugStartFailure): TranslationKey {
  switch (reason) {
    case 'invalid-profile':
      return 'debug.operation.failed.invalidProfile'
    case 'program-not-found':
      return 'debug.operation.failed.programNotFound'
    case 'program-outside-workspace':
      return 'debug.operation.failed.programOutsideWorkspace'
    case 'adapter-unavailable':
      return 'debug.operation.failed.adapterUnavailable'
    case 'spawn-failed':
      return 'debug.operation.failed.spawnFailed'
  }
}

function debugControlRejectionKey(reason: DebugControlRejection): TranslationKey {
  switch (reason) {
    case 'no-session':
      return 'debug.operation.rejected.noSession'
    case 'invalid-state':
      return 'debug.operation.rejected.invalidState'
    case 'busy':
      return 'debug.operation.rejected.busy'
  }
}

function debugControlFailureKey(reason: DebugControlFailure): TranslationKey {
  switch (reason) {
    case 'adapter-rejected':
      return 'debug.operation.failed.adapterRejected'
    case 'session-ended':
      return 'debug.operation.failed.sessionEnded'
    case 'no-thread':
      return 'debug.operation.failed.noThread'
    case 'timeout':
      return 'debug.operation.failed.timeout'
  }
}
