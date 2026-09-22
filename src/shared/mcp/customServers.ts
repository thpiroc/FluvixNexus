import type { McpCustomServerId } from './index'

/**
 * 利用者が Settings から足す MCP サーバー（「+ New MCP Server」。§21.3）の語彙と検証。
 *
 * ## 置き場所は3つに分かれる
 *
 * ```
 * userData/settings.json     全体の元栓（mcp.enabled）         … 今までどおり
 * userData/mcp-servers.json  名前・Command・引数・環境変数（秘密でないもの）・有効 / 無効
 * userData/mcp-secrets.json  秘密の環境変数の値                 … OS の資格情報で暗号化
 * ```
 *
 * `settings.json` の section は平らな素の値しか持てない（main/store/settingsSections.ts）
 * うえに、「設定ファイルが起動するものを決める場所」にしない、と決めてある。
 * サーバーの一覧はそれとは別の、Main だけが書くファイルへ置く
 * （Debug Profile の `debug-profiles.json` と同じ分け方）。
 *
 * ## Command と引数は最後まで分けて持つ
 *
 * 引数は**配列**で持ち、1つの文字列へ繋いで読み直すことはしない。起動は
 * `shell: false` で、引数は OS へそのまま渡る（main/mcp/mcpServerLaunch.ts）。
 * Command の欄は「起動するプログラム1つ」で、空白で区切って引数を読み取る
 * ことはしない ── `npx -y pkg` を Command に入れると、そういう名前の
 * プログラムを探して見つからない、になる（検証で先に断る）。
 *
 * ## 秘密の値は戻らない
 *
 * 「秘密」にした環境変数は、値が暗号化した別ファイルへ入り、Renderer へ返る
 * 形（`McpCustomServerSummary`）には**保存されているかどうか**だけが載る。
 * 編集で値を入れ直さないときは `value: null`（今のまま）を送る ──
 * 「読めないが入っている」値を画面に出して直させない（§21.3）。
 *
 * ## ここは形だけを見る
 *
 * このファイルは Renderer と Main の両方から読む（入力欄のその場の案内と、
 * Main の最終的な検証が同じ規則になる）。Command が実在するか・秘密の値が
 * 保存されているかは、ディスクを見る Main の側で決める。
 */

/** 登録できるサーバーの数。 */
export const MCP_CUSTOM_SERVERS_MAX = 32
export const MCP_CUSTOM_SERVER_NAME_MAX_LENGTH = 64
export const MCP_CUSTOM_SERVER_COMMAND_MAX_LENGTH = 1024
export const MCP_CUSTOM_SERVER_ARGS_MAX = 64
export const MCP_CUSTOM_SERVER_ARG_MAX_LENGTH = 4096
export const MCP_CUSTOM_SERVER_ENV_MAX = 64
export const MCP_CUSTOM_SERVER_ENV_NAME_MAX_LENGTH = 128
export const MCP_CUSTOM_SERVER_ENV_VALUE_MAX_LENGTH = 8192

/**
 * 接続方式。今は標準入出力（子プロセス）だけ。
 *
 * HTTP（Streamable HTTP）を足すときは、ここに `'http'` と、その形
 * （URL・ヘッダー）を `McpCustomServerTransport` の union に1つ足す。
 * 経路（mcpClient.ts の `McpTransport`）は差し替えられる形になっている。
 */
export type McpCustomServerTransportKind = 'stdio'

export const MCP_CUSTOM_SERVER_TRANSPORT_KINDS = [
  'stdio'
] as const satisfies readonly McpCustomServerTransportKind[]

/** 子プロセスとして起動し、標準入出力で話す。 */
export interface McpStdioServerTransport {
  readonly kind: 'stdio'
  /** 起動するプログラム1つ（絶対パスか、PATH で探す名前）。 */
  readonly command: string
  /** 引数。1つの文字列へ繋がずに、このまま OS へ渡す。 */
  readonly args: readonly string[]
}

export type McpCustomServerTransport = McpStdioServerTransport

/** mcp-servers.json に書く環境変数1つ。秘密の値はここに無い。 */
export type McpStoredEnvVariable =
  | { readonly name: string; readonly secret: false; readonly value: string }
  | { readonly name: string; readonly secret: true }

/** mcp-servers.json に書くサーバー1つ。 */
export interface McpStoredCustomServer {
  readonly id: McpCustomServerId
  readonly name: string
  readonly enabled: boolean
  readonly transport: McpCustomServerTransport
  readonly env: readonly McpStoredEnvVariable[]
}

/** Renderer へ返す環境変数1つ。**秘密の値は付かない**（保存されているかだけ）。 */
export type McpCustomServerEnvVariableSummary =
  | { readonly name: string; readonly secret: false; readonly value: string }
  | { readonly name: string; readonly secret: true; readonly stored: boolean }

/** Renderer へ返すサーバー1つ。 */
export interface McpCustomServerSummary {
  readonly id: McpCustomServerId
  readonly name: string
  readonly enabled: boolean
  readonly transport: McpCustomServerTransport
  readonly env: readonly McpCustomServerEnvVariableSummary[]
}

export interface McpCustomServerList {
  readonly servers: readonly McpCustomServerSummary[]
  /** この PC で秘密の値を保存できるか（OS の資格情報が使えるか）。 */
  readonly canStoreSecrets: boolean
}

/**
 * Renderer から届く環境変数1つ。
 *
 * 秘密の変数の `value: null` は「今保存されている値のまま」。新しく足した
 * 秘密の変数で `null` を送ると、保存されている値が無いので Main が断る
 * （`secret-required`）。
 */
export type McpCustomServerEnvVariableDraft =
  | { readonly name: string; readonly secret: false; readonly value: string }
  | { readonly name: string; readonly secret: true; readonly value: string | null }

/** Renderer から届くサーバー1つ（新規・編集のどちらも同じ形）。 */
export interface McpCustomServerDraft {
  readonly name: string
  readonly enabled: boolean
  readonly transport: McpCustomServerTransport
  readonly env: readonly McpCustomServerEnvVariableDraft[]
}

/** どの欄が通らなかったか。 */
export type McpCustomServerField =
  'server' | 'name' | 'enabled' | 'transport' | 'command' | 'args' | 'env'

/**
 * 通らなかった理由。画面はこれを見て言い回しを決める。
 *
 * | 値                       | 意味                                                          |
 * | ------------------------ | ------------------------------------------------------------- |
 * | `required`               | 空                                                            |
 * | `too-long` / `too-many`  | 長すぎる・多すぎる                                            |
 * | `control-character`      | 改行・NUL などの見えない文字                                  |
 * | `invalid-shape`          | 型が違う（Renderer の不具合か、手で書き換えたファイル）       |
 * | `command-has-arguments`  | PATH で探す名前に空白がある（引数は Arguments へ）            |
 * | `invalid-command`        | 途中に `"` がある・相対パス（`.\x.exe` など）                 |
 * | `invalid-name`           | 環境変数の名前の形ではない                                    |
 * | `reserved-name`          | このアプリが決める変数（`PATH`・`FLUVIX_*` など）             |
 * | `duplicate-name`         | 同じ名前がもうある                                            |
 * | `unsupported-transport`  | この版が知らない接続方式                                      |
 * | `secret-required`        | 秘密の変数に、入れた値も保存された値も無い                    |
 */
export type McpCustomServerInvalidReason =
  | 'required'
  | 'too-long'
  | 'too-many'
  | 'control-character'
  | 'invalid-shape'
  | 'command-has-arguments'
  | 'invalid-command'
  | 'invalid-name'
  | 'reserved-name'
  | 'duplicate-name'
  | 'unsupported-transport'
  | 'secret-required'

export interface McpCustomServerInvalid {
  readonly field: McpCustomServerField
  readonly reason: McpCustomServerInvalidReason
  /** 引数・環境変数の何番目か（0 始まり）。欄そのものの話なら null。 */
  readonly index: number | null
}

export type McpCustomServerDraftCheck =
  | { readonly ok: true; readonly draft: McpCustomServerDraft }
  | ({ readonly ok: false } & McpCustomServerInvalid)

/** 保存しようとした結果。 */
export type McpCustomServerSaveOutcome =
  | { readonly ok: true; readonly server: McpCustomServerSummary }
  | ({ readonly ok: false; readonly failure: 'invalid' } & McpCustomServerInvalid)
  | {
      readonly ok: false
      readonly failure:
        /** 編集しようとしたサーバーが、もう登録簿に無い。 */
        | 'not-found'
        /** 登録できる数の上限に達している。 */
        | 'limit-reached'
        /** 秘密の値を入れたが、この PC では暗号化できない（平文では保存しない）。 */
        | 'encryption-unavailable'
        /** ファイルへ書けなかった。 */
        | 'write-failed'
    }

/**
 * 利用者が決めてはいけない環境変数（大文字で比べる）。
 *
 * | 名前                                   | 理由                                                         |
 * | -------------------------------------- | ------------------------------------------------------------ |
 * | `PATH` / `PATHEXT`                     | Command を探す手がかりそのもの（Main が PATH を辿って決める） |
 * | `COMSPEC` / `SYSTEMROOT` / `WINDIR`    | `.cmd` を包む `cmd.exe` と、終わらせる `taskkill` の在り処    |
 * | `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` | 起動されるものより先に何かを読み込ませる                     |
 * | `FLUVIX_*`                             | このアプリ自身の設定（token を含む）。どのサーバーにも渡さない |
 *
 * 利用者は起動する Command そのものを決められるので、これは「悪いことを
 * 防ぐ」表ではない ── このアプリが決めている前提（どの実行ファイルを、どう
 * 包んで、どう終わらせるか）を、環境変数で黙って変えられないための表。
 */
export const MCP_CUSTOM_SERVER_RESERVED_ENV_NAMES: readonly string[] = [
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'SYSTEMROOT',
  'WINDIR',
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS'
]

const RESERVED_ENV_PREFIX = 'FLUVIX_'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/** その環境変数の名前を、利用者が決めてよいか。 */
export function isReservedMcpEnvName(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    upper.startsWith(RESERVED_ENV_PREFIX) || MCP_CUSTOM_SERVER_RESERVED_ENV_NAMES.includes(upper)
  )
}

type FieldRead<T> =
  { readonly ok: true; readonly value: T } | ({ readonly ok: false } & McpCustomServerInvalid)

function invalid(
  field: McpCustomServerField,
  reason: McpCustomServerInvalidReason,
  index: number | null = null
): { readonly ok: false } & McpCustomServerInvalid {
  return { ok: false, field, reason, index }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 表示名（前後の空白は落とす）。 */
export function readMcpCustomServerName(raw: unknown): FieldRead<string> {
  if (typeof raw !== 'string') {
    return invalid('name', 'invalid-shape')
  }

  const name = raw.trim()

  if (name.length === 0) {
    return invalid('name', 'required')
  }

  if (name.length > MCP_CUSTOM_SERVER_NAME_MAX_LENGTH) {
    return invalid('name', 'too-long')
  }

  if (CONTROL_CHARACTER.test(name)) {
    return invalid('name', 'control-character')
  }

  return { ok: true, value: name }
}

/**
 * Command（前後の空白と、全体を囲む `"` 1組は落とす）。
 *
 * エクスプローラーの「パスのコピー」は `"C:\...\x.exe"` の形で入るので、
 * 囲みの `"` だけは受け入れる。途中の `"` はファイル名に使えない文字で、
 * 何か別のもの（コマンドラインの断片）を貼った印になる。
 */
export function readMcpCustomServerCommand(raw: unknown): FieldRead<string> {
  if (typeof raw !== 'string') {
    return invalid('command', 'invalid-shape')
  }

  let command = raw.trim()

  if (command.length >= 2 && command.startsWith('"') && command.endsWith('"')) {
    command = command.slice(1, -1).trim()
  }

  if (command.length === 0) {
    return invalid('command', 'required')
  }

  if (command.length > MCP_CUSTOM_SERVER_COMMAND_MAX_LENGTH) {
    return invalid('command', 'too-long')
  }

  if (CONTROL_CHARACTER.test(command)) {
    return invalid('command', 'control-character')
  }

  if (command.includes('"')) {
    return invalid('command', 'invalid-command')
  }

  const absolute = isAbsoluteCommandPath(command)

  if (!absolute && /\s/.test(command)) {
    // `npx -y pkg` を1欄に書いた形。引数は Arguments の欄へ（絶対パスは空白を含みうる）。
    return invalid('command', 'command-has-arguments')
  }

  if (!absolute && /[\\/]/.test(command)) {
    /*
      相対パス（`.\server.exe`・`bin/server`）は、どこを起点にするかで
      別のものを指す。サーバーの作業フォルダは userData で、利用者の
      思っている場所ではない ── 絶対パスか、PATH で探す名前だけを受け付ける。
    */
    return invalid('command', 'invalid-command')
  }

  return { ok: true, value: command }
}

/** OS に依らず「絶対パスの形」か（どの OS のパスかは起動するときに Main が見る）。 */
function isAbsoluteCommandPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')
}

/** 引数（配列のまま。空の引数は許す ── `""` を受け取るプログラムがある）。 */
export function readMcpCustomServerArgs(raw: unknown): FieldRead<readonly string[]> {
  if (!Array.isArray(raw)) {
    return invalid('args', 'invalid-shape')
  }

  if (raw.length > MCP_CUSTOM_SERVER_ARGS_MAX) {
    return invalid('args', 'too-many')
  }

  const args: string[] = []

  for (const [index, arg] of raw.entries()) {
    if (typeof arg !== 'string') {
      return invalid('args', 'invalid-shape', index)
    }

    if (arg.length > MCP_CUSTOM_SERVER_ARG_MAX_LENGTH) {
      return invalid('args', 'too-long', index)
    }

    if (CONTROL_CHARACTER.test(arg)) {
      return invalid('args', 'control-character', index)
    }

    args.push(arg)
  }

  return { ok: true, value: args }
}

/** 接続方式とその中身。 */
export function readMcpCustomServerTransport(raw: unknown): FieldRead<McpCustomServerTransport> {
  if (!isRecord(raw)) {
    return invalid('transport', 'invalid-shape')
  }

  if (raw.kind !== 'stdio') {
    return invalid('transport', 'unsupported-transport')
  }

  const command = readMcpCustomServerCommand(raw.command)

  if (!command.ok) {
    return command
  }

  const args = readMcpCustomServerArgs(raw.args)

  if (!args.ok) {
    return args
  }

  return { ok: true, value: { kind: 'stdio', command: command.value, args: args.value } }
}

/** 環境変数の名前。 */
export function readMcpEnvVariableName(raw: unknown, index: number): FieldRead<string> {
  if (typeof raw !== 'string') {
    return invalid('env', 'invalid-shape', index)
  }

  const name = raw.trim()

  if (name.length === 0) {
    return invalid('env', 'required', index)
  }

  if (name.length > MCP_CUSTOM_SERVER_ENV_NAME_MAX_LENGTH) {
    return invalid('env', 'too-long', index)
  }

  if (!ENV_NAME_PATTERN.test(name)) {
    return invalid('env', 'invalid-name', index)
  }

  if (isReservedMcpEnvName(name)) {
    return invalid('env', 'reserved-name', index)
  }

  return { ok: true, value: name }
}

/** 秘密でない値（そのまま使う。空も許す）。 */
export function readMcpEnvVariablePlainValue(raw: unknown, index: number): FieldRead<string> {
  if (typeof raw !== 'string') {
    return invalid('env', 'invalid-shape', index)
  }

  if (raw.length > MCP_CUSTOM_SERVER_ENV_VALUE_MAX_LENGTH) {
    return invalid('env', 'too-long', index)
  }

  if (CONTROL_CHARACTER.test(raw)) {
    return invalid('env', 'control-character', index)
  }

  return { ok: true, value: raw }
}

/**
 * 秘密の値（前後の空白は落とす。空は「入っていない」）。
 *
 * 貼り付けた token の末尾に改行が付いてくるのはよくあるので、前後の空白は
 * 落とす。途中の改行・制御文字は断る（相手の API がすべての要求を断る形に
 * なり、原因が見えない）。
 */
export function readMcpEnvVariableSecretValue(raw: unknown, index: number): FieldRead<string> {
  if (typeof raw !== 'string') {
    return invalid('env', 'invalid-shape', index)
  }

  const value = raw.trim()

  if (value.length === 0) {
    return invalid('env', 'secret-required', index)
  }

  if (value.length > MCP_CUSTOM_SERVER_ENV_VALUE_MAX_LENGTH) {
    return invalid('env', 'too-long', index)
  }

  if (CONTROL_CHARACTER.test(value)) {
    return invalid('env', 'control-character', index)
  }

  return { ok: true, value }
}

/**
 * 環境変数の並び。1つずつの読み方は呼ぶ側が渡す（Renderer からの下書きと、
 * 保存されたファイルとで、秘密の変数の形が違うため）。
 *
 * 名前は大文字小文字を区別せずに重ならないことを見る ── Windows では
 * `Api_Key` と `API_KEY` は同じ変数になる。
 */
export function readMcpEnvVariables<T extends { readonly name: string }>(
  raw: unknown,
  readItem: (item: Record<string, unknown>, name: string, index: number) => FieldRead<T>
): FieldRead<readonly T[]> {
  if (!Array.isArray(raw)) {
    return invalid('env', 'invalid-shape')
  }

  if (raw.length > MCP_CUSTOM_SERVER_ENV_MAX) {
    return invalid('env', 'too-many')
  }

  const seen = new Set<string>()
  const variables: T[] = []

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item) || typeof item.secret !== 'boolean') {
      return invalid('env', 'invalid-shape', index)
    }

    const name = readMcpEnvVariableName(item.name, index)

    if (!name.ok) {
      return name
    }

    const key = name.value.toUpperCase()

    if (seen.has(key)) {
      return invalid('env', 'duplicate-name', index)
    }

    seen.add(key)

    const variable = readItem(item, name.value, index)

    if (!variable.ok) {
      return variable
    }

    variables.push(variable.value)
  }

  return { ok: true, value: variables }
}

function readDraftEnvVariable(
  item: Record<string, unknown>,
  name: string,
  index: number
): FieldRead<McpCustomServerEnvVariableDraft> {
  if (item.secret === false) {
    const value = readMcpEnvVariablePlainValue(item.value, index)
    return value.ok ? { ok: true, value: { name, secret: false, value: value.value } } : value
  }

  // 秘密の変数の null は「今のまま」。値が今あるかは Main が保存先を見て決める。
  if (item.value === null) {
    return { ok: true, value: { name, secret: true, value: null } }
  }

  const value = readMcpEnvVariableSecretValue(item.value, index)
  return value.ok ? { ok: true, value: { name, secret: true, value: value.value } } : value
}

/**
 * Renderer から届いた下書きを確かめ、使う形へ整える（前後の空白・囲みの `"`）。
 *
 * 画面の案内（保存を押す前）と Main の検証（保存の要求）の両方がこれを使う。
 */
export function validateMcpCustomServerDraft(raw: unknown): McpCustomServerDraftCheck {
  if (!isRecord(raw)) {
    return invalid('server', 'invalid-shape')
  }

  const name = readMcpCustomServerName(raw.name)

  if (!name.ok) {
    return name
  }

  if (typeof raw.enabled !== 'boolean') {
    return invalid('enabled', 'invalid-shape')
  }

  const transport = readMcpCustomServerTransport(raw.transport)

  if (!transport.ok) {
    return transport
  }

  const env = readMcpEnvVariables(raw.env, readDraftEnvVariable)

  if (!env.ok) {
    return env
  }

  return {
    ok: true,
    draft: { name: name.value, enabled: raw.enabled, transport: transport.value, env: env.value }
  }
}
