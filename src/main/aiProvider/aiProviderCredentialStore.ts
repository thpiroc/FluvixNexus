import { join } from 'path'
import { rmSync } from 'fs'
import {
  isSupportedProviderId,
  readAiProviderApiKey,
  type AiProviderCredentialFailure,
  type AiProviderCredentialState,
  type AiProviderCredentialStatus,
  type SupportedProviderId
} from '@shared/aiProvider'
import { readJsonFile, writeJsonFile } from '../store/jsonFile'

/**
 * FN Agent の AI Provider の API Key の保存（Security Core v1 の STEP10-5。2026-09-25）。
 *
 * ## 置き場所
 *
 * ```
 * userData/settings.json                  Provider / Model の選択（Key は無い） … 平文・利用者が読める
 * userData/ai-provider-credentials.json   Provider ごとの API Key               … 暗号文・この PC のこの利用者だけ
 * ```
 *
 * どちらも userData（`%APPDATA%/Fluvix Nexus`）で、**Workspace・プロジェクト・リポジトリの中には
 * 何も書かない。** 保存先のフォルダは呼ぶ側（aiProviderService.ts）が userData を渡し、
 * Renderer はパスもファイル名も指定できない。
 *
 * 形は最小限にする ── 版・Provider の識別子・暗号文（base64）だけ。
 *
 * ```json
 * { "version": 1, "credentials": { "openai": "<safeStorage の暗号文を base64 にしたもの>" } }
 * ```
 *
 * ## 暗号化は OS に任せ、できないなら書かない
 *
 * 暗号化は Electron の `safeStorage`（Windows では DPAPI。鍵はログインしている利用者アカウントに
 * 紐づき、ファイルを他の PC・他のアカウントへ持って行っても復号できない）。MCP の秘密の値
 * （main/mcp/mcpSecretStore.ts）と同じ理由で、自前の鍵を同じディスクへ置く形にはしない。
 *
 * **`safeStorage` が使えない・暗号化に失敗した場合は保存を断る（Fail Closed）。**
 * 平文へ落ちる経路は無い ── 利用者から見るとどちらも「保存できた」に見え、落ちたことに気づけない。
 *
 * ## 汎用の Secret Store にしない
 *
 * key は**正式な Provider の識別子（`SupportedProviderId`）だけ**。任意の名前で任意の値を
 * 保存できる口は無い。Scripted Provider（開発 / テスト専用）の Credential も持たない。
 *
 * ## 壊れていたら使わない
 *
 * ファイルが JSON でない・版が違う・知らない Provider がある・暗号文の形が違う・復号できない・
 * 復号した値が Key の形でない、のどれでも **その Key は使えない（`unusable`）** として扱い、
 * 平文として読み直すことも、別の値で補うこともしない。直すのは利用者の操作だけ
 * （新しい Key で置き換える ＝ ファイルを作り直す・削除する ＝ ファイルを消す）。
 *
 * ## 復号した Key を持ち続けない
 *
 * 読んだ内容も復号した Key も**覚えない**（呼ばれるたびにファイルを読み、復号する）。
 * 復号した Key を受け取れるのは Main の中の `withCredential` の callback だけで、callback が
 * 終われば Store は参照を持たない。Agent の状態・Provider の設定 object・Context・global に
 * 置く口は無い（JavaScript の文字列はメモリから消せないので、「参照を残さない」までが保証の範囲）。
 *
 * ## ログに Key も原因の本文も出さない
 *
 * 失敗の知らせ（`onIssue`）に渡すのは**固定の文言だけ**で、OS / Electron の Error も渡さない。
 * Error の本文に何が入っているかはこの module が決められないため。
 *
 * ## Electron を直接見ない
 *
 * `safeStorage` とフォルダを引数で受け取る（mcpSecretStore.ts と同じ）。本物を渡すのは
 * aiProviderService.ts の役目で、ここは Vitest から読み込める。
 */

export const AI_PROVIDER_CREDENTIALS_FILE_NAME = 'ai-provider-credentials.json'

/** この形式の版。違う版は壊れているものとして扱う（使わない・読み替えない）。 */
export const AI_PROVIDER_CREDENTIALS_SCHEMA_VERSION = 1

/**
 * 暗号文（base64）の文字数の上限。Key の上限（1024 文字）を DPAPI で暗号化しても数 KB に収まる。
 * 超えるものは壊れている・書き換えられたものとして扱う。
 */
const ENCRYPTED_MAX_LENGTH = 16 * 1024

/**
 * OS の資格情報による暗号化。Electron の `safeStorage` がそのまま満たす。
 *
 * どの関数も投げうる（`decryptString` は他の PC で作られた暗号文・壊れた暗号文で投げる）。
 * 呼ぶ側（この module）が必ず捕まえる。
 */
export interface AiProviderCredentialCipher {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (plainText: string) => Buffer
  readonly decryptString: (encrypted: Buffer) => string
}

/** Main の中で Key を使えなかった理由。 */
export type AiProviderCredentialUseFailure = 'not-set' | 'unusable' | 'unsupported-provider'

export type AiProviderCredentialUse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AiProviderCredentialUseFailure }

export type AiProviderCredentialWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure: AiProviderCredentialFailure | 'unsupported-provider'
    }

export interface AiProviderCredentialStore {
  /** この PC で Key を暗号化して保存できるか。 */
  readonly canStore: () => boolean
  /**
   * 保存した Key の状態（Key そのものは返さない）。
   *
   * `set` と言えるのは、復号できて Key の形が通ったときだけ ── 復号した値は確かめた後すぐ捨てる。
   */
  readonly getState: (providerId: SupportedProviderId) => AiProviderCredentialState
  /** Renderer へ返してよい状態（状態・保存できるか。Key から推し量れるものは載せない）。 */
  readonly getStatus: (providerId: SupportedProviderId) => AiProviderCredentialStatus
  /** Key を設定する / 置き換える。暗号化できなければ書かない。 */
  readonly setCredential: (
    providerId: SupportedProviderId,
    apiKey: unknown
  ) => AiProviderCredentialWriteResult
  /** Key を消す。無ければ何もしない（成功）。 */
  readonly deleteCredential: (providerId: SupportedProviderId) => AiProviderCredentialWriteResult
  /**
   * **Main の中だけで**、復号した Key を1回使う（STEP10-6 の Provider Adapter が通信の直前に呼ぶ）。
   *
   * Key は `use` の引数としてだけ渡り、Store は返り値にも状態にも Key を持たない。
   * `use` の中で Key を外へ持ち出さない（保存しない・ログに出さない・投げる Error に入れない）のは
   * 呼ぶ側の約束になる。`use` が投げた場合はそのまま投げる（Store は中身を読まない）。
   *
   * この関数は IPC・Preload・Renderer から届かない（aiProviderCredentialSurface.test.ts）。
   */
  readonly withCredential: <T>(
    providerId: SupportedProviderId,
    use: (apiKey: string) => T
  ) => AiProviderCredentialUse<T>
}

export type AiProviderCredentialStoreReporter = (message: string) => void

export interface AiProviderCredentialStoreOptions {
  readonly onIssue?: AiProviderCredentialStoreReporter
}

/** ファイルを読んだ結果。 */
type CredentialDocument =
  | { readonly kind: 'missing' }
  | { readonly kind: 'corrupted' }
  | { readonly kind: 'present'; readonly credentials: Readonly<Record<string, string>> }

export function createAiProviderCredentialStore(
  directory: string,
  cipher: AiProviderCredentialCipher,
  options: AiProviderCredentialStoreOptions = {}
): AiProviderCredentialStore {
  const filePath = join(directory, AI_PROVIDER_CREDENTIALS_FILE_NAME)
  const onIssue = options.onIssue ?? ((): void => {})

  function report(message: string): void {
    try {
      onIssue(`${AI_PROVIDER_CREDENTIALS_FILE_NAME}: ${message}`)
    } catch {
      // 知らせの失敗で、保存・読み込みの結末を変えない。
    }
  }

  function readDocument(): CredentialDocument {
    const found = readJsonFile(filePath)

    if (found.kind === 'missing') {
      return { kind: 'missing' }
    }

    if (found.kind !== 'present') {
      report('the file could not be read.')
      return { kind: 'corrupted' }
    }

    const raw = found.raw

    if (!isPlainObject(raw)) {
      report('the file is not in a readable shape.')
      return { kind: 'corrupted' }
    }

    if (raw.version !== AI_PROVIDER_CREDENTIALS_SCHEMA_VERSION) {
      report('the file has an unknown version.')
      return { kind: 'corrupted' }
    }

    const credentials = raw.credentials

    if (!isPlainObject(credentials)) {
      report('the credentials are not in a readable shape.')
      return { kind: 'corrupted' }
    }

    for (const [providerId, encoded] of Object.entries(credentials)) {
      /*
        知らない Provider が1つでもあれば、ファイルごと使わない。書き換えられた・別の版が書いた
        ファイルの一部だけを信じて読む形にしない。
      */
      if (!isSupportedProviderId(providerId)) {
        report('the file names an unknown provider.')
        return { kind: 'corrupted' }
      }

      if (!isEncodedCipherText(encoded)) {
        report('a stored credential is not in a readable shape.')
        return { kind: 'corrupted' }
      }
    }

    return { kind: 'present', credentials: credentials as Record<string, string> }
  }

  function writeDocument(credentials: Readonly<Record<string, string>>): boolean {
    /*
      1つも残らなければファイルごと消す。空の器を残さない（「設定した覚えがあるのに中身が無い」
      ファイルがディスクに残り続けないように）。
    */
    if (Object.keys(credentials).length === 0) {
      try {
        rmSync(filePath, { force: true })
        return true
      } catch {
        report('the file could not be removed.')
        return false
      }
    }

    // 一時ファイルへ書いてから rename する（jsonFile.ts）。一時ファイルにも暗号文しか入らない。
    const written = writeJsonFile(filePath, {
      version: AI_PROVIDER_CREDENTIALS_SCHEMA_VERSION,
      credentials
    })

    if (!written.ok) {
      report('the file could not be written.')
    }

    return written.ok
  }

  function available(): boolean {
    // 環境によっては投げる。使えないものとして扱う（Settings が開かなくなる形にしない）。
    try {
      return cipher.isEncryptionAvailable() === true
    } catch {
      report('the OS credential store could not be reached.')
      return false
    }
  }

  /** 暗号文1つを復号して、Key の形を確かめる。使えなければ null（理由は知らせに固定の文言で）。 */
  function decrypt(encoded: string): string | null {
    if (!available()) {
      report('the OS encryption is not available, so the stored credential cannot be used.')
      return null
    }

    let decrypted: unknown

    try {
      decrypted = cipher.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      // 他の PC・他のアカウントから持ってきた・壊れた暗号文。原因の本文は出さない。
      report('the stored credential could not be decrypted.')
      return null
    }

    const apiKey = readAiProviderApiKey(decrypted)

    if (apiKey === null) {
      report('the stored credential is not in a usable shape.')
    }

    return apiKey
  }

  /** 保存してある暗号文（無ければ null）。壊れていれば 'corrupted'。 */
  function storedCipherText(providerId: SupportedProviderId): string | null | 'corrupted' {
    const document = readDocument()

    if (document.kind === 'corrupted') {
      return 'corrupted'
    }

    return document.kind === 'present' ? (document.credentials[providerId] ?? null) : null
  }

  function getState(providerId: SupportedProviderId): AiProviderCredentialState {
    if (!isSupportedProviderId(providerId)) {
      return 'unusable'
    }

    const encoded = storedCipherText(providerId)

    if (encoded === 'corrupted') {
      return 'unusable'
    }

    if (encoded === null) {
      return 'not-set'
    }

    // 復号できるかだけを確かめる。値は変数ごとここで捨てる。
    return decrypt(encoded) === null ? 'unusable' : 'set'
  }

  return {
    canStore: available,

    getState,

    getStatus: (providerId) => ({ providerId, state: getState(providerId), canStore: available() }),

    setCredential: (providerId, apiKey) => {
      if (!isSupportedProviderId(providerId)) {
        return { ok: false, failure: 'unsupported-provider' }
      }

      const value = readAiProviderApiKey(apiKey)

      if (value === null) {
        return { ok: false, failure: 'value-invalid' }
      }

      if (!available()) {
        return { ok: false, failure: 'encryption-unavailable' }
      }

      let encoded: string

      try {
        const encrypted: unknown = cipher.encryptString(value)

        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
          throw new TypeError('empty cipher text')
        }

        encoded = encrypted.toString('base64')
      } catch {
        report('the credential could not be encrypted.')
        return { ok: false, failure: 'encryption-unavailable' }
      }

      if (!isEncodedCipherText(encoded)) {
        report('the encrypted credential is too large to store.')
        return { ok: false, failure: 'encryption-unavailable' }
      }

      /*
        壊れたファイルは作り直す（新しい Key での置き換えが、壊れた状態から戻る利用者の操作）。
        壊れた中身は持ち越さない。
      */
      const document = readDocument()
      const kept = document.kind === 'present' ? document.credentials : {}

      return writeDocument({ ...kept, [providerId]: encoded })
        ? { ok: true }
        : { ok: false, failure: 'write-failed' }
    },

    deleteCredential: (providerId) => {
      if (!isSupportedProviderId(providerId)) {
        return { ok: false, failure: 'unsupported-provider' }
      }

      const document = readDocument()

      if (
        document.kind === 'missing' ||
        (document.kind === 'present' && !Object.hasOwn(document.credentials, providerId))
      ) {
        return { ok: true }
      }

      /*
        壊れたファイルは、どの Provider の分も使えない。削除はファイルごと消す
        （壊れた中身の一部を残して書き直すことはしない）。
      */
      const kept =
        document.kind === 'present'
          ? Object.fromEntries(
              Object.entries(document.credentials).filter(([id]) => id !== providerId)
            )
          : {}

      return writeDocument(kept) ? { ok: true } : { ok: false, failure: 'write-failed' }
    },

    withCredential: <T>(
      providerId: SupportedProviderId,
      use: (apiKey: string) => T
    ): AiProviderCredentialUse<T> => {
      if (!isSupportedProviderId(providerId)) {
        return { ok: false, failure: 'unsupported-provider' }
      }

      const encoded = storedCipherText(providerId)

      if (encoded === 'corrupted') {
        return { ok: false, failure: 'unusable' }
      }

      if (encoded === null) {
        return { ok: false, failure: 'not-set' }
      }

      const apiKey = decrypt(encoded)

      if (apiKey === null) {
        return { ok: false, failure: 'unusable' }
      }

      return { ok: true, value: use(apiKey) }
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** base64 の暗号文として読める形か（空・大きすぎる・base64 でない文字を含むものは通さない）。 */
function isEncodedCipherText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= ENCRYPTED_MAX_LENGTH &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}
