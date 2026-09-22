import { useId, useState, type FormEvent, type JSX } from 'react'
import {
  MCP_CUSTOM_SERVERS_MAX,
  validateMcpCustomServerDraft,
  type McpCustomServerInvalid,
  type McpCustomServerSummary
} from '@shared/mcp/customServers'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TFunction } from '../i18n/messages'
import {
  describeInvalid,
  draftFromFormState,
  emptyEnvRow,
  formStateFromServer,
  keepsStoredSecret,
  type McpCustomServerFormState,
  type McpEnvRowState
} from './mcpCustomServerDraft'

/**
 * 利用者が足す MCP サーバーの入力欄（§21.10）。新規と編集で同じものを使う。
 *
 * ## 保存するまで何も起動しない
 *
 * 「保存」は Main の登録簿へ書くだけで、サーバーは起動しない。確かめるのは、
 * 保存した後にカードの「接続テスト」から ── 未保存の下書きを起動する口は無い。
 *
 * ## その場の案内と、Main の検証は同じ規則
 *
 * 保存を押したときに、Main と同じ検証（shared/mcp/customServers.ts）をここでも
 * 通し、通らなければ要求を送らずに理由を出す。Main も同じ規則でもう一度確かめる
 * ── ここを迂回した要求も同じ理由で断られる。
 *
 * ## 秘密の値
 *
 * 保存済みの秘密の値は欄に入らない（Main から戻ってこない）。欄を空のまま
 * 保存すれば「今のまま」、入れれば置き換え（mcpCustomServerDraft.ts の
 * `keepsStoredSecret`）。
 */
export function McpCustomServerForm({
  server,
  canStoreSecrets,
  onSaved,
  onCancel
}: {
  /** 編集するサーバー。新規なら null。 */
  readonly server: McpCustomServerSummary | null
  readonly canStoreSecrets: boolean
  readonly onSaved: (server: McpCustomServerSummary) => void
  readonly onCancel: () => void
}): JSX.Element {
  const { t } = useI18n()
  const baseId = useId()
  const [form, setForm] = useState<McpCustomServerFormState>(() => formStateFromServer(server))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (change: Partial<McpCustomServerFormState>): void => {
    setForm((previous) => ({ ...previous, ...change }))
  }

  const updateRow = (key: string, change: Partial<McpEnvRowState>): void => {
    setForm((previous) => ({
      ...previous,
      env: previous.env.map((row) => (row.key === key ? { ...row, ...change } : row))
    }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const checked = validateMcpCustomServerDraft(draftFromFormState(form))

    if (!checked.ok) {
      setError(invalidMessage(t, checked))
      return
    }

    setBusy(true)
    setError(null)

    try {
      const result = await fluvix.mcp.saveCustomServer({
        id: server?.id ?? null,
        draft: checked.draft
      })

      if (!result.ok) {
        setError(t('settings.mcp.custom.notice.saveFailed'))
        return
      }

      const outcome = result.data

      if (outcome.ok) {
        onSaved(outcome.server)
        return
      }

      switch (outcome.failure) {
        case 'invalid':
          setError(invalidMessage(t, outcome))
          return
        case 'not-found':
          setError(t('settings.mcp.custom.notice.notFound'))
          return
        case 'limit-reached':
          setError(t('settings.mcp.custom.notice.limitReached', { max: MCP_CUSTOM_SERVERS_MAX }))
          return
        case 'encryption-unavailable':
          setError(t('settings.mcp.custom.notice.encryptionUnavailable'))
          return
        case 'write-failed':
          setError(t('settings.mcp.custom.notice.saveFailed'))
          return
      }
    } finally {
      setBusy(false)
    }
  }

  const hasSecretRows = form.env.some((row) => row.secret)
  const field = (name: string): string => `${baseId}-${name}`

  return (
    <form
      className="fx-mcp__card fx-mcp__form"
      data-testid="settings-mcp-custom-form"
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="fx-mcp__name">
        {t(server === null ? 'settings.mcp.custom.titleNew' : 'settings.mcp.custom.titleEdit')}
      </h3>

      <div className="fx-mcp__field">
        <label className="fx-mcp__label" htmlFor={field('name')}>
          {t('settings.mcp.custom.fields.name')}
        </label>
        <input
          id={field('name')}
          className="fx-mcp__input"
          data-testid="settings-mcp-custom-name"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('settings.mcp.custom.placeholders.name')}
          value={form.name}
          onChange={(event) => update({ name: event.target.value })}
        />
      </div>

      <div className="fx-mcp__field">
        <label className="fx-mcp__label" htmlFor={field('transport')}>
          {t('settings.mcp.custom.fields.transport')}
        </label>
        {/*
          今は stdio だけ。HTTP（Streamable HTTP）を足すときは、ここに選択肢を
          1つ足し、下の欄を接続方式ごとに切り替える（shared/mcp/customServers.ts）。
        */}
        <select
          id={field('transport')}
          className="fx-mcp__input"
          data-testid="settings-mcp-custom-transport"
          value={form.transportKind}
          onChange={() => update({ transportKind: 'stdio' })}
        >
          <option value="stdio">{t('settings.mcp.custom.transportStdio')}</option>
        </select>
      </div>

      <div className="fx-mcp__field">
        <label className="fx-mcp__label" htmlFor={field('command')}>
          {t('settings.mcp.custom.fields.command')}
        </label>
        <input
          id={field('command')}
          className="fx-mcp__input"
          data-testid="settings-mcp-custom-command"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('settings.mcp.custom.placeholders.command')}
          value={form.command}
          onChange={(event) => update({ command: event.target.value })}
        />
        <p className="fx-mcp__note">{t('settings.mcp.custom.hints.command')}</p>
      </div>

      <div className="fx-mcp__field">
        <label className="fx-mcp__label" htmlFor={field('args')}>
          {t('settings.mcp.custom.fields.args')}
        </label>
        <textarea
          id={field('args')}
          className="fx-mcp__input fx-mcp__textarea"
          data-testid="settings-mcp-custom-args"
          rows={4}
          spellCheck={false}
          placeholder={t('settings.mcp.custom.placeholders.args')}
          value={form.argsText}
          onChange={(event) => update({ argsText: event.target.value })}
        />
        <p className="fx-mcp__note">{t('settings.mcp.custom.hints.args')}</p>
      </div>

      <fieldset className="fx-mcp__field fx-mcp__fieldset">
        <legend className="fx-mcp__label">{t('settings.mcp.custom.fields.env')}</legend>
        {form.env.map((row, index) => (
          <div
            className="fx-mcp__row"
            key={row.key}
            data-testid={`settings-mcp-custom-env-${index}`}
          >
            <input
              className="fx-mcp__input fx-mcp__env-name"
              data-testid={`settings-mcp-custom-env-name-${index}`}
              aria-label={`${t('settings.mcp.custom.placeholders.envName')} ${index + 1}`}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('settings.mcp.custom.placeholders.envName')}
              value={row.name}
              onChange={(event) => updateRow(row.key, { name: event.target.value })}
            />
            <input
              className="fx-mcp__input"
              data-testid={`settings-mcp-custom-env-value-${index}`}
              aria-label={`${t('settings.mcp.custom.placeholders.envValue')} ${index + 1}`}
              // 秘密の値は肩越しに読まれないように伏せる（token の欄と同じ）。
              type={row.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              // 空のまま保存すると「今のまま」になる行だけ、保存済みであることを見せる。
              placeholder={
                keepsStoredSecret({ ...row, value: '' })
                  ? t('settings.mcp.custom.placeholders.storedSecret')
                  : t('settings.mcp.custom.placeholders.envValue')
              }
              value={row.value}
              onChange={(event) => updateRow(row.key, { value: event.target.value })}
            />
            <label className="fx-mcp__check">
              <input
                type="checkbox"
                data-testid={`settings-mcp-custom-env-secret-${index}`}
                checked={row.secret}
                onChange={(event) => updateRow(row.key, { secret: event.target.checked })}
              />
              {t('settings.mcp.custom.envSecret')}
            </label>
            <button
              type="button"
              className="fx-mcp__button"
              data-testid={`settings-mcp-custom-env-remove-${index}`}
              onClick={() =>
                setForm((previous) => ({
                  ...previous,
                  env: previous.env.filter((candidate) => candidate.key !== row.key)
                }))
              }
            >
              {t('settings.mcp.custom.envRemove')}
            </button>
          </div>
        ))}
        <div className="fx-mcp__row">
          <button
            type="button"
            className="fx-mcp__button"
            data-testid="settings-mcp-custom-env-add"
            onClick={() =>
              setForm((previous) => ({ ...previous, env: [...previous.env, emptyEnvRow()] }))
            }
          >
            {t('settings.mcp.custom.envAdd')}
          </button>
        </div>
        <p className="fx-mcp__note">{t('settings.mcp.custom.hints.env')}</p>
        {hasSecretRows && !canStoreSecrets ? (
          <p
            className="fx-mcp__note"
            data-state="warning"
            data-testid="settings-mcp-custom-no-store"
          >
            {t('settings.mcp.custom.cannotStoreSecrets')}
          </p>
        ) : null}
      </fieldset>

      <label className="fx-mcp__check">
        <input
          type="checkbox"
          data-testid="settings-mcp-custom-enabled"
          checked={form.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        {t('settings.mcp.custom.enabledLabel')}
      </label>

      {error === null ? null : (
        <p
          className="fx-mcp__note"
          data-state="warning"
          role="alert"
          data-testid="settings-mcp-custom-error"
        >
          {error}
        </p>
      )}

      <div className="fx-mcp__row">
        <button
          type="submit"
          className="fx-mcp__button"
          data-variant="primary"
          data-testid="settings-mcp-custom-save"
          disabled={busy}
        >
          {t('settings.mcp.custom.save')}
        </button>
        <button
          type="button"
          className="fx-mcp__button"
          data-testid="settings-mcp-custom-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          {t('settings.mcp.custom.cancel')}
        </button>
      </div>
    </form>
  )
}

function invalidMessage(t: TFunction, invalid: McpCustomServerInvalid): string {
  const { fieldKey, reasonKey, position } = describeInvalid(invalid)
  const values = { field: t(fieldKey), reason: t(reasonKey) }

  return position === null
    ? t('settings.mcp.custom.invalidField', values)
    : t('settings.mcp.custom.invalidAt', { ...values, position })
}
