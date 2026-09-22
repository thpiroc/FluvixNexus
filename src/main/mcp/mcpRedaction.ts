/**
 * ログへ出す前に秘密の値を伏せる（MCP 共通。Electron / fs 非依存・テスト対象）。
 *
 * MCP サーバーの stderr には、失敗した HTTP 要求の中身（`Authorization` ヘッダーを
 * 含む）がそのまま出てくることがある。ログの側の伏せ字（main/logger/logRedaction.ts）は
 * `Bearer …` の形は拾うが、値が単独で現れた場合は拾えない ── 値そのものを知っている
 * この層（サーバーへ渡した秘密の環境変数の値。mcpCustomServerDefinition.ts の
 * `redactions`）で先に伏せる。
 *
 * ここが返す文字列にも、ログの文にも、秘密の値そのものは含めない。
 */

/** 文字列の中に現れた値1つを伏せる。 */
export function redactToken(text: string, token: string | null): string {
  if (token === null || token.length === 0) {
    return text
  }

  return text.split(token).join('<redacted>')
}

/**
 * 複数の秘密の値を伏せる。
 *
 * 長いものから伏せる ── 短い値が長い値の一部だった場合に、長い方の残りが
 * ログに出るのを防ぐ。
 */
export function redactSecrets(text: string, secrets: readonly (string | null)[]): string {
  const values = secrets
    .filter((value): value is string => value !== null && value.length > 0)
    .sort((a, b) => b.length - a.length)

  return values.reduce((current, value) => redactToken(current, value), text)
}
