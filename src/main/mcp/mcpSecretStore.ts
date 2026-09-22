import { join } from 'path'
import { rmSync } from 'fs'
import type { McpConnectionId, McpCustomServerId } from '@shared/mcp'
import { readMcpEnvVariableSecretValue } from '@shared/mcp/customServers'
import { readJsonFile, writeJsonFile } from '../store/jsonFile'
import { validateMcpTokenValue } from './mcpConfig'

/**
 * MCP の token の保存（§21.9）。
 *
 * ## `settings.json` には絶対に入れない
 *
 * 設定ファイルは利用者が開いて読める場所（`userData/settings.json`）にあり、
 * 質問のたびに貼られ、バックアップにも画面共有にも普通に写る。token は
 * **それとは別のファイル**に、**OS の資格情報で暗号化して**置く。
 *
 * ```
 * userData/settings.json       使う意思（真偽値だけ）  … 平文・利用者が読める
 * userData/mcp-secrets.json    token                   … 暗号文・この PC のこの利用者だけ
 * ```
 *
 * §21.10 で、利用者が足したサーバーの**秘密の環境変数**も同じファイルに入る
 * ようになった（key は `custom-<uuid>:env:<NAME>`）。暗号化・暗号化できないときに
 * 書かないこと・読めない暗号文を無いものとして扱うことは、token とまったく同じ。
 *
 * 暗号化は Electron の `safeStorage` に任せる（Windows では DPAPI ──
 * 鍵はログインしている利用者アカウントに紐づき、ファイルを他の PC や
 * 他のアカウントへ持って行っても復号できない）。自前で鍵を作って
 * 同じディスクへ置く形にはしない ── それは鍵と錠を同じ箱に入れるのと同じで、
 * 暗号化しているように見えるだけになる。
 *
 * ## 暗号化できないなら、書かない
 *
 * `safeStorage` が使えない環境（Linux で資格情報サービスが無い等）では
 * **保存を断る**。平文へ落ちる実装にはしない ── 利用者から見ると
 * どちらも「保存できた」に見えるので、落ちたことに気づけないため。
 * 断られた利用者には環境変数という道が残っている
 * （取り出す順序は mcpConnections.ts の `resolveSecret`）。
 *
 * ## Electron を直接見ない
 *
 * `safeStorage` を引数で受け取るのは、store/settingsStore.ts が保存先の
 * フォルダを受け取っているのとまったく同じ理由にあたる ── Electron を
 * 直に見ると Vitest から読み込めなくなる（vitest.config.ts）。
 * 本物を渡すのは main/mcp/mcpService.ts の役目で、ここは
 * 「渡された暗号化の道具と、渡されたフォルダの中の1ファイル」しか知らない。
 */

export const MCP_SECRETS_FILE_NAME = 'mcp-secrets.json'

/** この形式の版。読めない版は「無い」として扱う（壊れた鍵で起動を止めない）。 */
const MCP_SECRETS_SCHEMA_VERSION = 1

/**
 * OS の資格情報による暗号化。Electron の `safeStorage` がそのまま満たす。
 *
 * `decryptString` は、他の PC で作られた暗号文・壊れた暗号文に対して投げる。
 * 呼ぶ側（この module）が捕まえる。
 */
export interface McpSecretCipher {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (plainText: string) => Buffer
  readonly decryptString: (encrypted: Buffer) => string
}

/** 保存できなかった理由。画面はこれを見て言い回しを決める。 */
export type McpSecretWriteFailure =
  /** この PC では OS の暗号化が使えない（平文では保存しない）。 */
  | 'encryption-unavailable'
  /** token の形が通らない（空・見えない文字が混ざっている）。 */
  | 'token-invalid'
  /** ファイルへ書けなかった。 */
  | 'write-failed'

export type McpSecretWriteResult =
  { readonly ok: true } | { readonly ok: false; readonly failure: McpSecretWriteFailure }

export interface McpSecretStore {
  /** この PC で token を保存できるか。 */
  readonly canStore: () => boolean
  /** 保存されている token。無い・読めないなら `null`。 */
  readonly read: (id: McpConnectionId) => string | null
  /** 保存されているか（token の値は返さない）。 */
  readonly has: (id: McpConnectionId) => boolean
  /** 保存する。既にあれば置き換える。 */
  readonly write: (id: McpConnectionId, token: string) => McpSecretWriteResult
  /** 消す。無かった場合も成功として扱う（押した結果は同じ「無い」）。 */
  readonly clear: (id: McpConnectionId) => boolean
  /**
   * 利用者が足したサーバーの、秘密の環境変数の値（§21.10）。無い・読めないなら `null`。
   * 名前は大文字小文字を区別しない（Windows の環境変数と同じ）。
   */
  readonly readVariable: (id: McpCustomServerId, name: string) => string | null
  /** 秘密の環境変数の値が保存されているか（値は返さない）。 */
  readonly hasVariable: (id: McpCustomServerId, name: string) => boolean
  /**
   * そのサーバーの秘密の環境変数を、この並びに**揃える**（1回の書き込み）。
   *
   * 値が `null` の名前は、保存されている暗号文をそのまま残す（編集で入れ直さなかった）。
   * 並びに無い名前の値は消す（秘密をやめた・変数ごと消した）。
   */
  readonly replaceVariables: (
    id: McpCustomServerId,
    next: ReadonlyMap<string, string | null>
  ) => McpSecretWriteResult
  /** そのサーバーの秘密の環境変数をすべて消す（サーバーを消したとき）。 */
  readonly clearVariables: (id: McpCustomServerId) => boolean
}

/**
 * 秘密の環境変数の key（`custom-<uuid>:env:<NAME>`）。
 *
 * 組み込みの接続の token は接続 id そのものを key にしている（`notion`）。
 * `:` は接続 id にも環境変数の名前にも現れないので、どちらとも重ならない。
 */
function variableKey(id: McpCustomServerId, name: string): string {
  return `${variablePrefix(id)}${name.toUpperCase()}`
}

function variablePrefix(id: McpCustomServerId): string {
  return `${id}:env:`
}

export type McpSecretStoreReporter = (message: string, ...details: readonly unknown[]) => void

export interface McpSecretStoreOptions {
  readonly onIssue?: McpSecretStoreReporter
}

export function createMcpSecretStore(
  directory: string,
  cipher: McpSecretCipher,
  options: McpSecretStoreOptions = {}
): McpSecretStore {
  const filePath = join(directory, MCP_SECRETS_FILE_NAME)
  const report = options.onIssue ?? ((): void => {})

  /*
    読んだ内容は覚えない。設定と違って、この値は**他の場所からも変わりうる**
    （利用者がファイルを消す・別の窓で消す）し、読む回数は接続のたびの1回で、
    速さが要る場所でもない。覚えると「消したのにまだ繋がる」が生まれる。
  */
  function readAll(): Record<string, string> {
    const found = readJsonFile(filePath)

    if (found.kind === 'missing') {
      return {}
    }

    if (found.kind !== 'present') {
      report(`${MCP_SECRETS_FILE_NAME} could not be read.`, found.cause)
      return {}
    }

    const raw = found.raw

    if (typeof raw !== 'object' || raw === null) {
      report(`${MCP_SECRETS_FILE_NAME} is not in a readable shape.`)
      return {}
    }

    const document = raw as { readonly version?: unknown; readonly secrets?: unknown }

    if (document.version !== MCP_SECRETS_SCHEMA_VERSION) {
      report(`${MCP_SECRETS_FILE_NAME} has an unknown version.`)
      return {}
    }

    if (typeof document.secrets !== 'object' || document.secrets === null) {
      return {}
    }

    const secrets: Record<string, string> = {}

    for (const [key, value] of Object.entries(document.secrets)) {
      /* 暗号文は base64 の文字列で持つ（JSON に Buffer は入らない）。 */
      if (typeof value === 'string' && value.length > 0) {
        secrets[key] = value
      }
    }

    return secrets
  }

  function writeAll(secrets: Readonly<Record<string, string>>): boolean {
    /*
      1つも残らなかったらファイルごと消す。空の器を残すと、
      「設定した覚えがあるのに中身が無い」ファイルがディスクに残り続ける。
    */
    if (Object.keys(secrets).length === 0) {
      try {
        rmSync(filePath, { force: true })
        return true
      } catch (cause) {
        report(`${MCP_SECRETS_FILE_NAME} could not be removed.`, cause)
        return false
      }
    }

    const written = writeJsonFile(filePath, { version: MCP_SECRETS_SCHEMA_VERSION, secrets })

    if (!written.ok) {
      report(`${MCP_SECRETS_FILE_NAME} could not be written.`, written.cause)
    }

    return written.ok
  }

  function available(): boolean {
    /*
      `isEncryptionAvailable` は環境によっては投げる。使えないものとして扱う
      ── ここで投げさせると、token を保存していない利用者の Settings が開かなくなる。
    */
    try {
      return cipher.isEncryptionAvailable()
    } catch (cause) {
      report('the OS credential store could not be reached.', cause)
      return false
    }
  }

  /**
   * 暗号文1つを復号して、形を確かめる。読めなければ null。
   *
   * `label` はログ用の呼び名（`token for notion` など）で、値は決して含めない。
   */
  function decrypt(
    encoded: string | undefined,
    label: string,
    validate: (plain: string) => string | null
  ): string | null {
    if (encoded === undefined || !available()) {
      return null
    }

    let decrypted: string

    try {
      decrypted = cipher.decryptString(Buffer.from(encoded, 'base64'))
    } catch (cause) {
      /*
        他の PC・他のアカウントからファイルを持ってきた場合にここへ来る。
        値そのものは決してログへ出さない（例外の中身にも token は入らないが、
        出す理由が無い）。
      */
      report(`the stored ${label} could not be decrypted.`, cause)
      return null
    }

    /* 復号できても、形が通らないものは渡さない（起動してから 401 になるより早く断る）。 */
    const value = validate(decrypted)

    if (value === null) {
      report(`the stored ${label} is not in a usable shape.`)
    }

    return value
  }

  /** 平文1つを暗号化して base64 にする。暗号化できなければ null。 */
  function encrypt(plain: string, label: string): string | null {
    try {
      return cipher.encryptString(plain).toString('base64')
    } catch (cause) {
      report(`the ${label} could not be encrypted.`, cause)
      return null
    }
  }

  return {
    canStore: available,

    read: (id): string | null =>
      decrypt(readAll()[id], `token for ${id}`, (plain) => {
        const token = validateMcpTokenValue(plain)
        return token.ok ? token.token : null
      }),

    has: (id): boolean => readAll()[id] !== undefined,

    write: (id, token): McpSecretWriteResult => {
      const validated = validateMcpTokenValue(token)

      if (!validated.ok) {
        return { ok: false, failure: 'token-invalid' }
      }

      if (!available()) {
        return { ok: false, failure: 'encryption-unavailable' }
      }

      const encoded = encrypt(validated.token, `token for ${id}`)

      if (encoded === null) {
        return { ok: false, failure: 'encryption-unavailable' }
      }

      return writeAll({ ...readAll(), [id]: encoded })
        ? { ok: true }
        : { ok: false, failure: 'write-failed' }
    },

    clear: (id): boolean => {
      const secrets = readAll()

      if (secrets[id] === undefined) {
        return true
      }

      delete secrets[id]

      return writeAll(secrets)
    },

    readVariable: (id, name): string | null =>
      decrypt(readAll()[variableKey(id, name)], `variable ${name} for ${id}`, (plain) => {
        const value = readMcpEnvVariableSecretValue(plain, 0)
        return value.ok ? value.value : null
      }),

    hasVariable: (id, name): boolean => readAll()[variableKey(id, name)] !== undefined,

    replaceVariables: (id, next): McpSecretWriteResult => {
      const current = readAll()
      const prefix = variablePrefix(id)
      const secrets: Record<string, string> = {}

      // ほかのサーバー・組み込みの token はそのまま残す。
      for (const [key, value] of Object.entries(current)) {
        if (!key.startsWith(prefix)) {
          secrets[key] = value
        }
      }

      for (const [name, plain] of next) {
        const key = variableKey(id, name)

        if (plain === null) {
          const kept = current[key]

          if (kept !== undefined) {
            secrets[key] = kept
          }

          continue
        }

        const validated = readMcpEnvVariableSecretValue(plain, 0)

        if (!validated.ok) {
          return { ok: false, failure: 'token-invalid' }
        }

        if (!available()) {
          return { ok: false, failure: 'encryption-unavailable' }
        }

        const encoded = encrypt(validated.value, `variable ${name} for ${id}`)

        if (encoded === null) {
          return { ok: false, failure: 'encryption-unavailable' }
        }

        secrets[key] = encoded
      }

      const unchanged =
        Object.keys(secrets).length === Object.keys(current).length &&
        Object.entries(secrets).every(([key, value]) => current[key] === value)

      // 何も変わらないなら書かない（秘密の変数の無いサーバーを保存するたびに書き直さない）。
      if (unchanged) {
        return { ok: true }
      }

      return writeAll(secrets) ? { ok: true } : { ok: false, failure: 'write-failed' }
    },

    clearVariables: (id): boolean => {
      const current = readAll()
      const prefix = variablePrefix(id)
      const kept = Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(prefix))
      )

      return Object.keys(kept).length === Object.keys(current).length ? true : writeAll(kept)
    }
  }
}

/*
  token をどこから取るか（保存 → 環境変数）の順序は**ここには無い**。
  置き場所は mcpConnections.ts の `resolveSecret` 1つだけで、そこが
  画面へ出す在り処と、実際に子プロセスへ渡す token の両方を返す。

  この module にも同じ順序を書くと、「画面は保存した token を指しているのに、
  繋ぐのは環境変数の方」がありうる ── ここが持つのは「保存されているか」
  までにとどめる。
*/
