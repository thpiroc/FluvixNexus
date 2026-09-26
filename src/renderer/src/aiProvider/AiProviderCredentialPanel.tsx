import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import {
  readAiProviderApiKey,
  SUPPORTED_PROVIDER_IDS,
  type AiProviderCredentialFailure,
  type AiProviderCredentialStatus,
  type SupportedProviderId
} from '@shared/aiProvider'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'
import { aiProviderNameKey } from './aiProviderLabels'

/**
 * AI Provider の API Key の面（STEP10-5）。Settings の AI Provider カテゴリの、選択の行の下に続く。
 *
 * ## Key は入れる方向にしか流れない
 *
 * 出すのは**状態だけ**（設定済み / 未設定 / 使えない）。保存した Key を取り寄せて欄に出す・
 * 伏せ字で長さを見せる、のどちらもしない ── Main から Key が戻る経路そのものが無い
 * （shared/aiProvider/credential.ts）。変えるときは新しい Key を入れて置き換える。
 *
 * ## 入れた Key を持ち続けない
 *
 * 入力欄は password の欄で、値はこの欄の state にしか置かない（console・ログ・通知・保存する
 * 設定・他の state へは渡さない）。**保存を押した時点で欄を空にする**（成功でも失敗でも）──
 * 送った値は IPC の要求の中にだけあり、画面には残らない。
 *
 * Provider ごとに1枚（今は OpenAI だけ）。選んでいる Provider とは別に置くのは、Key を先に
 * 入れてから Provider を選ぶ順でも迷わないようにするため。
 */
export function AiProviderCredentialPanel(): JSX.Element {
  return (
    <div className="fx-ai-provider" data-testid="settings-ai-provider-panel">
      {SUPPORTED_PROVIDER_IDS.map((providerId) => (
        <AiProviderCredentialCard key={providerId} providerId={providerId} />
      ))}
    </div>
  )
}

type Notice = { readonly key: TranslationKey; readonly tone: 'info' | 'warning' }

function AiProviderCredentialCard({
  providerId
}: {
  readonly providerId: SupportedProviderId
}): JSX.Element {
  const { t } = useI18n()
  const [status, setStatus] = useState<AiProviderCredentialStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const result = await fluvix.aiProvider.hasCredential({ providerId })

    if (!mounted.current) {
      return
    }

    if (result.ok) {
      setStatus(result.data)
    } else {
      setNotice({ key: 'settings.aiProvider.credential.notice.loadFailed', tone: 'warning' })
    }
  }, [providerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    // 送る値は手元の変数にだけ置き、欄はすぐに空にする（成功でも失敗でも残さない）。
    const apiKey = draft
    setDraft('')

    if (readAiProviderApiKey(apiKey) === null) {
      setNotice({ key: 'settings.aiProvider.credential.notice.invalid', tone: 'warning' })
      return
    }

    setBusy(true)
    setNotice(null)

    const result = await fluvix.aiProvider.setCredential({ providerId, apiKey })

    if (!mounted.current) {
      return
    }

    setBusy(false)

    if (!result.ok) {
      setNotice({ key: 'settings.aiProvider.credential.notice.writeFailed', tone: 'warning' })
      void refresh()
      return
    }

    setStatus(result.data.status)
    setNotice(
      result.data.ok
        ? { key: 'settings.aiProvider.credential.notice.saved', tone: 'info' }
        : { key: failureNoticeKey(result.data.failure), tone: 'warning' }
    )
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setNotice(null)

    const result = await fluvix.aiProvider.deleteCredential({ providerId })

    if (!mounted.current) {
      return
    }

    setBusy(false)

    if (!result.ok || !result.data.ok) {
      setNotice({ key: 'settings.aiProvider.credential.notice.deleteFailed', tone: 'warning' })

      if (result.ok) {
        setStatus(result.data.status)
      } else {
        void refresh()
      }

      return
    }

    setStatus(result.data.status)
    setNotice({ key: 'settings.aiProvider.credential.notice.deleted', tone: 'info' })
  }

  const canStore = status?.canStore ?? false
  const stored = status !== null && status.state !== 'not-set'
  const provider = t(aiProviderNameKey(providerId))

  return (
    <section
      className="fx-ai-provider__card"
      data-testid={`settings-ai-provider-credential-${providerId}`}
      data-state={status?.state ?? 'loading'}
    >
      <div className="fx-ai-provider__head">
        <span className="fx-ai-provider__name">
          {t('settings.aiProvider.credential.title', { provider })}
        </span>
        <span
          className="fx-ai-provider__status"
          data-tone={status === null ? 'muted' : statusTone(status)}
          data-testid={`settings-ai-provider-credential-status-${providerId}`}
        >
          {t(statusKey(status))}
        </span>
      </div>

      <p className="fx-ai-provider__note">{t('settings.aiProvider.credential.note')}</p>

      {status !== null && !canStore ? (
        <p
          className="fx-ai-provider__note"
          data-state="warning"
          data-testid={`settings-ai-provider-credential-cannot-store-${providerId}`}
        >
          {t('settings.aiProvider.credential.cannotStore')}
        </p>
      ) : null}

      <form className="fx-ai-provider__row" onSubmit={(event) => void save(event)}>
        <input
          className="fx-ai-provider__input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={t('settings.aiProvider.credential.label', { provider })}
          placeholder={t('settings.aiProvider.credential.placeholder')}
          data-testid={`settings-ai-provider-credential-input-${providerId}`}
          value={draft}
          disabled={busy || !canStore}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="fx-ai-provider__button"
          data-variant="primary"
          data-testid={`settings-ai-provider-credential-save-${providerId}`}
          disabled={busy || !canStore || draft.length === 0}
        >
          {t(
            stored
              ? 'settings.aiProvider.credential.replace'
              : 'settings.aiProvider.credential.save'
          )}
        </button>
        <button
          type="button"
          className="fx-ai-provider__button"
          data-variant="danger"
          data-testid={`settings-ai-provider-credential-delete-${providerId}`}
          disabled={busy || !stored}
          onClick={() => void remove()}
        >
          {t('settings.aiProvider.credential.delete')}
        </button>
      </form>

      {notice === null ? null : (
        <p
          className="fx-ai-provider__note"
          data-state={notice.tone}
          data-testid={`settings-ai-provider-credential-notice-${providerId}`}
        >
          {t(notice.key)}
        </p>
      )}
    </section>
  )
}

function statusKey(status: AiProviderCredentialStatus | null): TranslationKey {
  switch (status?.state) {
    case undefined:
      return 'settings.aiProvider.credential.status.loading'
    case 'set':
      return 'settings.aiProvider.credential.status.set'
    case 'not-set':
      return 'settings.aiProvider.credential.status.notSet'
    case 'unusable':
      return 'settings.aiProvider.credential.status.unusable'
  }
}

function statusTone(status: AiProviderCredentialStatus): 'connected' | 'muted' | 'attention' {
  switch (status.state) {
    case 'set':
      return 'connected'
    case 'not-set':
      return 'muted'
    case 'unusable':
      return 'attention'
  }
}

function failureNoticeKey(failure: AiProviderCredentialFailure): TranslationKey {
  switch (failure) {
    case 'encryption-unavailable':
      return 'settings.aiProvider.credential.notice.encryptionUnavailable'
    case 'value-invalid':
      return 'settings.aiProvider.credential.notice.invalid'
    case 'write-failed':
      return 'settings.aiProvider.credential.notice.writeFailed'
  }
}
