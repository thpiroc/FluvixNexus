import type { McpConfigProblem } from '@shared/mcp'

/**
 * MCP サーバーの秘密情報（token）を読む（MCP 共通。Electron / fs 非依存・テスト対象）。
 *
 * どの環境変数から読むかは表の行が決める（例: notionMcpServer.ts の
 * `FLUVIX_NOTION_MCP_TOKEN`）。ここは読み方と確かめ方だけを持つ。
 *
 * ## 設定ファイルには書かない・読まない
 *
 * userData の JSON は暗号化されておらず、バックアップや診断情報の添付で
 * 外へ出ていきやすい。§21.9 で入った保存先は `settings.json` ではなく、
 * OS の資格情報で暗号化した専用のファイルにあたる（mcpSecretStore.ts）──
 * 「平文でディスクに書かない」線は動かしていない。
 *
 * 形の確かめ方は**保存するときと読むときで同じ1つ**にする
 * （`validateMcpTokenValue`）── 環境変数だけを確かめていた頃の規則が、
 * 画面から入れた token には掛からない、という穴を作らないため。
 *
 * ## token の値は外へ出さない
 *
 * ここが返す `problem` は閉じた集合の語だけで、ログの文にも token の文字は含めない。
 */

export type McpTokenRead =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly problem: Extract<McpConfigProblem, `token-${string}`> }

/**
 * token として使える形か（前後の空白は落とす）。
 *
 * 出どころ（環境変数・保存したもの・画面から入れたもの）に依らず、
 * token がこの関数を通らずに使われる経路は無い。
 */
export function validateMcpTokenValue(raw: string | undefined): McpTokenRead {
  const token = typeof raw === 'string' ? raw.trim() : ''

  if (token.length === 0) {
    return { ok: false, problem: 'token-missing' }
  }

  /*
    token は見える ASCII だけでできている。制御文字（PowerShell 5.1 の
    `Read-Host -AsSecureString` で Ctrl+V を押すと 0x16 が入る）・空白・全角文字が
    混ざると、サーバーは起動するが相手の API がすべての要求を 401 で断る
    ── 原因が見えないので先に断る。
  */
  if (!/^[\x21-\x7e]+$/.test(token)) {
    return { ok: false, problem: 'token-invalid' }
  }

  return { ok: true, token }
}

export function readMcpToken(
  env: Readonly<Record<string, string | undefined>>,
  variable: string
): McpTokenRead {
  return validateMcpTokenValue(env[variable])
}

/**
 * 文字列の中に現れた token を伏せる。
 *
 * サーバーの stderr には、失敗した HTTP 要求の中身（`Authorization` ヘッダーを
 * 含む）がそのまま出てくることがある。ログの側の伏せ字（main/logger/logRedaction.ts）は
 * `Bearer …` の形は拾うが、token が単独で現れた場合は拾えない
 * ── 値そのものを知っているこの層で先に伏せる。
 */
export function redactToken(text: string, token: string | null): string {
  if (token === null || token.length === 0) {
    return text
  }

  return text.split(token).join('<redacted>')
}
