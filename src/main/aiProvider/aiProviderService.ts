import { app, safeStorage } from 'electron'
import { normalizeAiProviderPreferences, type AiProviderPreferences } from '@shared/aiProvider'
import { createLogger } from '../logger'
import { readUserSettingsSections } from '../store/settings'
import {
  createAiProviderCredentialStore,
  type AiProviderCredentialStore
} from './aiProviderCredentialStore'

const log = createLogger('ai-provider')

let credentials: AiProviderCredentialStore | null = null

/**
 * AI Provider の API Key の保存先（アプリに1つ。STEP10-5）。
 *
 * Electron の値（userData のフォルダ・`safeStorage`）を渡すのはここだけで、保存の手続きは
 * aiProviderCredentialStore.ts が持つ（Vitest から読み込める側）。app.getPath('userData') は
 * app の準備後に確定するので、最初に使われた時点で作る。
 *
 * **これを import してよいのは IPC の handler（状態・設定・削除だけを使う）と、STEP10-6 の
 * Provider Adapter（`withCredential` を使う）だけ。** Agent Loop・Security Core・Renderer への経路は
 * 作らない（aiProviderCredentialSurface.test.ts）。
 */
export function getAiProviderCredentialStore(): AiProviderCredentialStore {
  credentials ??= createAiProviderCredentialStore(app.getPath('userData'), safeStorage, {
    onIssue: (message) => {
      log.warn(message)
    }
  })

  return credentials
}

/**
 * 今の Provider / Model の選択（STEP10-6 の Adapter が読む）。
 *
 * **ユーザー設定だけを読む。** この section は application scope で（shared/settings/scope.ts）、
 * ワークスペース設定に値があっても効かない ── 効く値を解く `readEffectiveSettingsSections` を
 * 通す必要も無く、通さないことで Workspace の値が混ざる経路を1つも持たない。
 */
export function readAiProviderPreferences(): AiProviderPreferences {
  return normalizeAiProviderPreferences(readUserSettingsSections().aiProvider)
}
