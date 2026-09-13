import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import {
  DEBUG_PROFILE_LANGUAGES,
  type DebugControlOutcome,
  type DebugProfile,
  type DebugProfileLanguage,
  type DebugProfileSaveOutcome
} from '@shared/debug'
import { fluvix } from '../api/fluvix'
import { useCommands } from '../commands/context'
import { useCommand } from '../commands/useCommand'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import {
  DEBUG_TOOLBAR_ACTIONS,
  EMPTY_DEBUG_PROFILE_FORM,
  canRunDebugToolbarAction,
  debugControlOutcomeKey,
  debugIpcErrorKey,
  debugProfileLanguageNameKey,
  debugProfileRejectionKey,
  debugProfileValidationKey,
  debugStartOutcomeKey,
  draftFromDebugProfileForm,
  formFromDebugProfile,
  isDebugProfileLanguageChoice,
  type DebugProfileFormState
} from './debugToolbarModel'
import { useDebugSessionStatus } from './useDebugSessionStatus'

type EditorMode = 'create' | 'edit'

interface EditorState {
  readonly mode: EditorMode
  readonly profileId: string | null
  readonly form: DebugProfileFormState
}

/**
 * Debug Panel 上部の操作面（Session 6-11）。
 *
 * Profile の選択・編集と、Session 6-4 / 6-10 の typed Debug API だけを繋ぐ。
 * Start に渡すのは選択済みの `profileId` だけで、adapter・cwd・絶対パス・DAP method
 * はこの層に現れない。
 */
export function DebugToolbar(): JSX.Element {
  const { t } = useI18n()
  const commands = useCommands()
  const workspaceFolder = useWorkspaceFolder()
  const status = useDebugSessionStatus()
  const [profiles, setProfiles] = useState<readonly DebugProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [messageKey, setMessageKey] = useState<TranslationKey | null>(null)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [busy, setBusy] = useState(false)

  const workspaceId = workspaceFolder.workspace?.id ?? null
  const hasWorkspace = workspaceFolder.status === 'ready' && workspaceFolder.workspace !== null
  const selectedProfile =
    profiles.find((profile) => profile.profileId === selectedProfileId) ?? null
  const hasSelectedProfile = selectedProfile !== null

  const refreshProfiles = useCallback(async (): Promise<void> => {
    setLoadingProfiles(true)
    const result = await fluvix.debug.listProfiles()

    if (!result.ok) {
      setProfiles([])
      setSelectedProfileId(null)
      setMessageKey(debugIpcErrorKey(result.error))
      setLoadingProfiles(false)
      return
    }

    setProfiles(result.data.profiles)
    setSelectedProfileId((current) => {
      if (
        current !== null &&
        result.data.profiles.some((profile) => profile.profileId === current)
      ) {
        return current
      }

      return result.data.profiles[0]?.profileId ?? null
    })
    setLoadingProfiles(false)
  }, [])

  useEffect(() => {
    setProfiles([])
    setSelectedProfileId(null)
    setEditor(null)
    setMessageKey(null)

    if (workspaceFolder.status !== 'ready') {
      return
    }

    void refreshProfiles()
  }, [refreshProfiles, workspaceFolder.status, workspaceId])

  const showCreateEditor = useCallback((): void => {
    setMessageKey(null)
    setEditor({ mode: 'create', profileId: null, form: EMPTY_DEBUG_PROFILE_FORM })
  }, [])

  const showEditEditor = useCallback((): void => {
    if (selectedProfile === null) {
      setMessageKey('debug.toolbar.noSelectedProfile')
      return
    }

    setMessageKey(null)
    setEditor({
      mode: 'edit',
      profileId: selectedProfile.profileId,
      form: formFromDebugProfile(selectedProfile)
    })
  }, [selectedProfile])

  const deleteCurrentProfile = useCallback(async (): Promise<void> => {
    if (selectedProfile === null || !window.confirm(t('debug.profile.confirmDelete'))) {
      return
    }

    setBusy(true)
    const result = await fluvix.debug.deleteProfile({ profileId: selectedProfile.profileId })

    if (!result.ok) {
      setMessageKey(debugIpcErrorKey(result.error))
      setBusy(false)
      return
    }

    if (result.data.status === 'deleted') {
      setProfiles(result.data.profiles)
      setSelectedProfileId(result.data.profiles[0]?.profileId ?? null)
      setEditor(null)
      setMessageKey('debug.profile.deleted')
    } else {
      setMessageKey(debugProfileRejectionKey(result.data.reason))
    }

    setBusy(false)
  }, [selectedProfile, t])

  const start = useCallback(async (): Promise<void> => {
    if (selectedProfile === null) {
      setMessageKey('debug.toolbar.noSelectedProfile')
      return
    }

    setBusy(true)
    const result = await fluvix.debug.start({ profileId: selectedProfile.profileId })
    setMessageKey(result.ok ? debugStartOutcomeKey(result.data) : debugIpcErrorKey(result.error))
    setBusy(false)
  }, [selectedProfile])

  const runControl = useCallback(async (control: DebugControlCommand) => {
    setBusy(true)
    const result = await control()
    setMessageKey(result.ok ? debugControlOutcomeKey(result.data) : debugIpcErrorKey(result.error))
    setBusy(false)
  }, [])

  const continueDebug = useCallback(() => runControl(fluvix.debug.continue), [runControl])
  const pauseDebug = useCallback(() => runControl(fluvix.debug.pause), [runControl])
  const stepOver = useCallback(() => runControl(fluvix.debug.stepOver), [runControl])
  const stepInto = useCallback(() => runControl(fluvix.debug.stepInto), [runControl])
  const stepOut = useCallback(() => runControl(fluvix.debug.stepOut), [runControl])
  const stopDebug = useCallback(() => runControl(fluvix.debug.stop), [runControl])

  const actionHandlers = useMemo(
    () => ({
      start,
      continue: continueDebug,
      pause: pauseDebug,
      stepOver,
      stepInto,
      stepOut,
      stop: stopDebug
    }),
    [continueDebug, pauseDebug, start, stepInto, stepOut, stepOver, stopDebug]
  )

  const actionEnabled = useMemo(
    () =>
      Object.fromEntries(
        DEBUG_TOOLBAR_ACTIONS.map((action) => [
          action.id,
          !busy && canRunDebugToolbarAction(action.id, status, hasSelectedProfile)
        ])
      ) as Readonly<Record<(typeof DEBUG_TOOLBAR_ACTIONS)[number]['id'], boolean>>,
    [busy, hasSelectedProfile, status]
  )

  useCommand('debug.addProfile', showCreateEditor, hasWorkspace && !busy)
  useCommand('debug.editProfile', showEditEditor, hasWorkspace && hasSelectedProfile && !busy)
  useCommand(
    'debug.deleteProfile',
    deleteCurrentProfile,
    hasWorkspace && hasSelectedProfile && !busy
  )
  useCommand('debug.start', actionHandlers.start, actionEnabled.start)
  useCommand('debug.continue', actionHandlers.continue, actionEnabled.continue)
  useCommand('debug.pause', actionHandlers.pause, actionEnabled.pause)
  useCommand('debug.stepOver', actionHandlers.stepOver, actionEnabled.stepOver)
  useCommand('debug.stepInto', actionHandlers.stepInto, actionEnabled.stepInto)
  useCommand('debug.stepOut', actionHandlers.stepOut, actionEnabled.stepOut)
  useCommand('debug.stop', actionHandlers.stop, actionEnabled.stop)

  const saveEditor = useCallback(async (): Promise<void> => {
    if (editor === null) {
      return
    }

    const formDraft = draftFromDebugProfileForm(editor.form)

    if (formDraft.status === 'invalid-env-line') {
      setMessageKey('debug.profile.invalidEnvLine')
      return
    }

    setBusy(true)
    const result =
      editor.mode === 'create'
        ? await fluvix.debug.createProfile({ profile: formDraft.draft })
        : await fluvix.debug.updateProfile({
            profileId: editor.profileId ?? '',
            profile: formDraft.draft
          })

    applyProfileSaveResult(result)
    setBusy(false)
  }, [editor])

  function applyProfileSaveResult(
    result: Awaited<ReturnType<typeof fluvix.debug.createProfile>>
  ): void {
    if (!result.ok) {
      setMessageKey(debugIpcErrorKey(result.error))
      return
    }

    handleProfileSaveOutcome(result.data)
  }

  function handleProfileSaveOutcome(outcome: DebugProfileSaveOutcome): void {
    switch (outcome.status) {
      case 'saved':
        setProfiles(outcome.profiles)
        setSelectedProfileId(outcome.profile.profileId)
        setEditor(null)
        setMessageKey('debug.profile.saved')
        break

      case 'invalid':
        setMessageKey(debugProfileValidationKey(outcome.field, outcome.reason))
        break

      case 'rejected':
        setMessageKey(debugProfileRejectionKey(outcome.reason))
        break
    }
  }

  const updateForm = useCallback((patch: Partial<DebugProfileFormState>): void => {
    setEditor((current) =>
      current === null ? null : { ...current, form: { ...current.form, ...patch } }
    )
  }, [])

  return (
    <div className="fx-debug-toolbar-shell">
      <div className="fx-debug-toolbar" role="toolbar" aria-label={t('debug.toolbar.aria')}>
        <label className="fx-debug-toolbar__profile">
          <span className="fx-debug-toolbar__profile-label">{t('debug.toolbar.profileLabel')}</span>
          <select
            className="fx-debug-toolbar__select"
            data-testid="debug-profile-selector"
            value={selectedProfileId ?? ''}
            disabled={!hasWorkspace || loadingProfiles || profiles.length === 0}
            onChange={(event) => setSelectedProfileId(event.target.value || null)}
          >
            {profiles.length === 0 ? (
              <option value="">{t('debug.toolbar.noProfile')}</option>
            ) : (
              profiles.map((profile) => (
                <option key={profile.profileId} value={profile.profileId}>
                  {profile.name} ({t(debugProfileLanguageNameKey(profile.language))})
                </option>
              ))
            )}
          </select>
        </label>

        <button
          type="button"
          className="fx-debug-toolbar__button"
          data-testid="debug-add-profile"
          disabled={!hasWorkspace || busy}
          onClick={() => commands.execute('debug.addProfile')}
        >
          {t('debug.toolbar.addProfile')}
        </button>
        <button
          type="button"
          className="fx-debug-toolbar__button"
          data-testid="debug-edit-profile"
          disabled={!hasWorkspace || !hasSelectedProfile || busy}
          onClick={() => commands.execute('debug.editProfile')}
        >
          {t('debug.toolbar.editProfile')}
        </button>

        <div className="fx-debug-toolbar__actions">
          {DEBUG_TOOLBAR_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className="fx-debug-toolbar__button"
              data-testid={`debug-action-${action.id}`}
              disabled={!actionEnabled[action.id]}
              title={t(action.labelKey)}
              aria-label={t(action.labelKey)}
              onClick={() => commands.execute(action.commandId)}
            >
              {t(action.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {loadingProfiles ? (
        <p className="fx-debug-toolbar__notice">{t('debug.toolbar.loadingProfiles')}</p>
      ) : null}
      {!hasWorkspace && workspaceFolder.status === 'ready' ? (
        <p className="fx-debug-toolbar__notice">{t('debug.toolbar.noWorkspace')}</p>
      ) : null}
      {status === 'unavailable' ? (
        <p className="fx-debug-toolbar__notice">{t('debug.toolbar.unavailable')}</p>
      ) : null}
      {messageKey === null ? null : (
        <p className="fx-debug-toolbar__message" role="status">
          {t(messageKey)}
        </p>
      )}
      {editor === null ? null : (
        <DebugProfileEditor
          editor={editor}
          busy={busy}
          onChange={updateForm}
          onSave={saveEditor}
          onDelete={deleteCurrentProfile}
          onCancel={() => setEditor(null)}
        />
      )}
    </div>
  )
}

function DebugProfileEditor({
  editor,
  busy,
  onChange,
  onSave,
  onDelete,
  onCancel
}: {
  readonly editor: EditorState
  readonly busy: boolean
  readonly onChange: (patch: Partial<DebugProfileFormState>) => void
  readonly onSave: () => void
  readonly onDelete: () => void
  readonly onCancel: () => void
}): JSX.Element {
  const { t } = useI18n()
  const form = editor.form

  return (
    <section
      className="fx-debug-profile-editor"
      data-testid="debug-profile-editor"
      aria-label={t(
        editor.mode === 'create' ? 'debug.profile.editorTitleAdd' : 'debug.profile.editorTitleEdit'
      )}
    >
      <div className="fx-debug-profile-editor__heading">
        <span className="fx-debug-profile-editor__title">
          {t(
            editor.mode === 'create'
              ? 'debug.profile.editorTitleAdd'
              : 'debug.profile.editorTitleEdit'
          )}
        </span>
      </div>

      <div className="fx-debug-profile-editor__grid">
        <label className="fx-debug-profile-editor__field">
          <span>{t('debug.profile.name')}</span>
          <input
            data-testid="debug-profile-name"
            value={form.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label className="fx-debug-profile-editor__field">
          <span>{t('debug.profile.language')}</span>
          <select
            data-testid="debug-profile-language"
            value={form.language}
            onChange={(event) => {
              const value = event.target.value

              if (isDebugProfileLanguageChoice(value)) {
                onChange({ language: value })
              }
            }}
          >
            {DEBUG_PROFILE_LANGUAGES.map((language: DebugProfileLanguage) => (
              <option key={language} value={language}>
                {t(debugProfileLanguageNameKey(language))}
              </option>
            ))}
          </select>
        </label>
        <label className="fx-debug-profile-editor__field fx-debug-profile-editor__field--wide">
          <span>{t('debug.profile.programRelativePath')}</span>
          <input
            data-testid="debug-profile-program"
            value={form.programRelativePath}
            placeholder={t('debug.profile.programRelativePathPlaceholder')}
            onChange={(event) => onChange({ programRelativePath: event.target.value })}
          />
        </label>
        <label className="fx-debug-profile-editor__field">
          <span>{t('debug.profile.programArgs')}</span>
          <textarea
            data-testid="debug-profile-args"
            value={form.programArgsText}
            placeholder={t('debug.profile.programArgsPlaceholder')}
            onChange={(event) => onChange({ programArgsText: event.target.value })}
          />
        </label>
        <label className="fx-debug-profile-editor__field">
          <span>{t('debug.profile.env')}</span>
          <textarea
            data-testid="debug-profile-env"
            value={form.envText}
            placeholder={t('debug.profile.envPlaceholder')}
            onChange={(event) => onChange({ envText: event.target.value })}
          />
        </label>
      </div>

      <label className="fx-debug-profile-editor__checkbox">
        <input
          type="checkbox"
          data-testid="debug-profile-stop-on-entry"
          checked={form.stopOnEntry}
          onChange={(event) => onChange({ stopOnEntry: event.target.checked })}
        />
        <span>{t('debug.profile.stopOnEntry')}</span>
      </label>

      <div className="fx-debug-profile-editor__actions">
        <button type="button" onClick={onSave} disabled={busy} data-testid="debug-profile-save">
          {t(editor.mode === 'create' ? 'debug.profile.create' : 'debug.profile.save')}
        </button>
        {editor.mode === 'edit' ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            data-testid="debug-profile-delete"
          >
            {t('debug.profile.delete')}
          </button>
        ) : null}
        <button type="button" onClick={onCancel} disabled={busy} data-testid="debug-profile-cancel">
          {t('debug.profile.cancel')}
        </button>
      </div>
    </section>
  )
}

type DebugControlCommand = () => Promise<
  | { readonly ok: true; readonly data: DebugControlOutcome }
  | { readonly ok: false; readonly error: Parameters<typeof debugIpcErrorKey>[0] }
>
