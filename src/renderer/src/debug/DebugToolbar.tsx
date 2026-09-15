import { useCallback, useMemo, useState, type JSX } from 'react'
import { DEBUG_PROFILE_LANGUAGES, type DebugProfileLanguage } from '@shared/debug'
import { useCommands } from '../commands/context'
import { useCommand } from '../commands/useCommand'
import { useI18n } from '../i18n/context'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import {
  DEBUG_TOOLBAR_ACTIONS,
  EMPTY_DEBUG_PROFILE_FORM,
  canRunDebugToolbarAction,
  debugProfileLanguageNameKey,
  draftFromDebugProfileForm,
  formFromDebugProfile,
  isDebugProfileLanguageChoice,
  type DebugProfileFormState
} from './debugToolbarModel'
import { useDebug } from './debugControlContext'

type EditorMode = 'create' | 'edit'

interface EditorState {
  readonly mode: EditorMode
  readonly profileId: string | null
  readonly form: DebugProfileFormState
}

/**
 * Debug Panel 上部の操作面（Session 6-11）。
 *
 * Profile の一覧・選択と実行 command は DebugProvider が持つ。ここは Panel 内の
 * 表示と Profile 編集フォームだけを受け持つため、Panel が作り直されても F5 が
 * 使う選択 Profile は失われない。
 */
export function DebugToolbar(): JSX.Element {
  const { t } = useI18n()
  const commands = useCommands()
  const debug = useDebug()
  const workspaceFolder = useWorkspaceFolder()
  const [editor, setEditor] = useState<EditorState | null>(null)

  const hasWorkspace = workspaceFolder.status === 'ready' && workspaceFolder.workspace !== null
  const hasSelectedProfile = debug.selectedProfile !== null

  const showCreateEditor = useCallback((): void => {
    debug.setMessageKey(null)
    setEditor({ mode: 'create', profileId: null, form: EMPTY_DEBUG_PROFILE_FORM })
  }, [debug])

  const showEditEditor = useCallback((): void => {
    if (debug.selectedProfile === null) {
      debug.setMessageKey('debug.toolbar.noSelectedProfile')
      return
    }

    debug.setMessageKey(null)
    setEditor({
      mode: 'edit',
      profileId: debug.selectedProfile.profileId,
      form: formFromDebugProfile(debug.selectedProfile)
    })
  }, [debug])

  const deleteCurrentProfile = useCallback(async (): Promise<void> => {
    if (debug.selectedProfile === null || !window.confirm(t('debug.profile.confirmDelete'))) {
      return
    }

    if (await debug.deleteSelectedProfile()) {
      setEditor(null)
    }
  }, [debug, t])

  const actionEnabled = useMemo(
    () =>
      Object.fromEntries(
        DEBUG_TOOLBAR_ACTIONS.map((action) => [
          action.id,
          hasWorkspace &&
            !debug.busy &&
            canRunDebugToolbarAction(action.id, debug.status, debug.selectedProfile !== null)
        ])
      ) as Readonly<Record<(typeof DEBUG_TOOLBAR_ACTIONS)[number]['id'], boolean>>,
    [debug.busy, debug.selectedProfile, debug.status, hasWorkspace]
  )

  useCommand('debug.addProfile', showCreateEditor, hasWorkspace && !debug.busy)
  useCommand('debug.editProfile', showEditEditor, hasWorkspace && hasSelectedProfile && !debug.busy)
  useCommand(
    'debug.deleteProfile',
    deleteCurrentProfile,
    hasWorkspace && hasSelectedProfile && !debug.busy
  )

  const saveEditor = useCallback(async (): Promise<void> => {
    if (editor === null) {
      return
    }

    const formDraft = draftFromDebugProfileForm(editor.form)

    if (formDraft.status === 'invalid-env-line') {
      debug.setMessageKey('debug.profile.invalidEnvLine')
      return
    }

    const saved =
      editor.mode === 'create'
        ? await debug.createProfile(formDraft.draft)
        : await debug.updateProfile(editor.profileId ?? '', formDraft.draft)

    if (saved) {
      setEditor(null)
    }
  }, [debug, editor])

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
            value={debug.selectedProfileId ?? ''}
            disabled={!hasWorkspace || debug.loadingProfiles || debug.profiles.length === 0}
            onChange={(event) => debug.selectProfile(event.target.value || null)}
          >
            {debug.profiles.length === 0 ? (
              <option value="">{t('debug.toolbar.noProfile')}</option>
            ) : (
              debug.profiles.map((profile) => (
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
          disabled={!hasWorkspace || debug.busy}
          onClick={() => commands.execute('debug.addProfile')}
        >
          {t('debug.toolbar.addProfile')}
        </button>
        <button
          type="button"
          className="fx-debug-toolbar__button"
          data-testid="debug-edit-profile"
          disabled={!hasWorkspace || !hasSelectedProfile || debug.busy}
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

      {debug.loadingProfiles ? (
        <p className="fx-debug-toolbar__notice">{t('debug.toolbar.loadingProfiles')}</p>
      ) : null}
      {!hasWorkspace && workspaceFolder.status === 'ready' ? (
        <p className="fx-debug-toolbar__notice">{t('debug.toolbar.noWorkspace')}</p>
      ) : null}
      {debug.status === 'unavailable' ? (
        <p className="fx-debug-toolbar__notice">{t('debug.toolbar.unavailable')}</p>
      ) : null}
      {debug.messageKey === null ? null : (
        <p className="fx-debug-toolbar__message" role="status">
          {t(debug.messageKey)}
        </p>
      )}
      {editor === null ? null : (
        <DebugProfileEditor
          editor={editor}
          busy={debug.busy}
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
