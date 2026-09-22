import { rmSync } from 'fs'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from '../store/jsonFile'
import { MCP_SECRETS_FILE_NAME } from './mcpSecretStore'

/**
 * 旧 Notion MCP（アプリに組み込みだった接続）の token を、`mcp-secrets.json` から
 * 1度だけ取り除く（Electron 非依存・テスト対象）。
 *
 * ## 何が残っていたか
 *
 * 組み込みの Notion MCP は、Settings から入れた token を `mcp-secrets.json` の
 * key `notion` に暗号化して置いていた。接続そのものを撤去した後は誰も読まないので、
 * 暗号文だけがディスクに残り続ける ── 使わない資格情報は持たない。
 *
 * 同じ時期の設定（`settings.json` の `mcp.notionEnabled`）は、設定文書の版を
 * 上げる移行が消す（store/settingsMigration.ts）。環境変数
 * `FLUVIX_NOTION_MCP_TOKEN` は利用者のものなので、アプリからは変えない。
 *
 * ## 消すのは key `notion` だけ
 *
 * 登録したサーバーの秘密の環境変数（`custom-<uuid>:env:<NAME>`）には触れない。
 * 暗号文は復号せず、そのまま書き戻す（この処理は暗号化の道具を持たない）。
 *
 * ## 何度呼んでも同じ
 *
 * key が無ければ何も書かない。起動のたびに呼ぶが、2回目からはファイルを
 * 1度読むだけで終わる。読めない・知らない版のファイルには触れない
 * （mcpSecretStore.ts と同じく「無い」として扱い、壊さない）。
 *
 * 旧 Notion MCP はリリースに含まれていないため、このファイルは移行を
 * 済ませた開発版の環境が無くなった頃に消してよい。
 */

/** 旧 Notion MCP の token の key。 */
export const LEGACY_NOTION_SECRET_KEY = 'notion'

/** この処理が扱う `mcp-secrets.json` の版（mcpSecretStore.ts と同じ）。 */
const SUPPORTED_VERSION = 1

export type LegacyNotionSecretCleanup =
  /** 取り除いた。 */
  | 'removed'
  /** 取り除くものが無かった（ファイルが無い・key が無い・触れない形）。 */
  | 'none'
  /** 取り除こうとしたが書けなかった（次の起動でもう一度試す）。 */
  | 'failed'

/**
 * `report` は書けなかったときだけ呼ぶ（ログ用。値は含めない）。
 */
export function removeLegacyNotionSecret(
  directory: string,
  report: (message: string, ...details: readonly unknown[]) => void = (): void => {}
): LegacyNotionSecretCleanup {
  const filePath = join(directory, MCP_SECRETS_FILE_NAME)
  const found = readJsonFile(filePath)

  if (found.kind !== 'present') {
    return 'none'
  }

  const document = found.raw as { readonly version?: unknown; readonly secrets?: unknown } | null

  if (
    typeof document !== 'object' ||
    document === null ||
    document.version !== SUPPORTED_VERSION ||
    typeof document.secrets !== 'object' ||
    document.secrets === null ||
    !Object.hasOwn(document.secrets, LEGACY_NOTION_SECRET_KEY)
  ) {
    return 'none'
  }

  const kept = Object.fromEntries(
    Object.entries(document.secrets).filter(([key]) => key !== LEGACY_NOTION_SECRET_KEY)
  )

  try {
    if (Object.keys(kept).length === 0) {
      // 何も残らなければファイルごと消す（mcpSecretStore.ts の書き方と同じ）。
      rmSync(filePath, { force: true })
    } else {
      const written = writeJsonFile(filePath, { version: SUPPORTED_VERSION, secrets: kept })

      if (!written.ok) {
        throw written.cause
      }
    }
  } catch (cause) {
    report(`the legacy Notion MCP token in ${MCP_SECRETS_FILE_NAME} could not be removed.`, cause)
    return 'failed'
  }

  return 'removed'
}
