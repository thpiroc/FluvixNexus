import type {
  McpCustomServerField,
  McpCustomServerInvalid,
  McpCustomServerInvalidReason,
  McpCustomServerSummary,
  McpCustomServerTransport,
  McpCustomServerTransportKind
} from '@shared/mcp/customServers'
import type { TranslationKey } from '../i18n/messages'

/**
 * 「+ New MCP Server」の入力欄の状態と、保存の要求の形との行き来
 * （§21.10。React 非依存・テスト対象）。
 *
 * 判断をここへ出したのは mcpStatusSummary.ts と同じ理由で、**「どう入れたら
 * 何が送られるか」を画面を起動せずに試せるようにするため**にほかならない。
 * 取り違えると困るのは次の2つ。
 *
 * - 引数の欄（1行に1つ）から配列へ ── 空白で区切り直さない
 * - 秘密の値の「今のまま」（`null`）── 空の欄を「空の値」として送ると、
 *   保存されている値が消える
 */

/** 環境変数の1行。 */
export interface McpEnvRowState {
  /** React の key（名前は書き換わるので使えない）。 */
  readonly key: string
  readonly name: string
  readonly value: string
  readonly secret: boolean
  /**
   * 読み込んだ時点で、この行の秘密の値が保存されていたなら、その名前。
   * 名前を書き換えた・秘密をやめた行は、保存された値を流用しない。
   */
  readonly storedSecretName: string | null
}

export interface McpCustomServerFormState {
  readonly name: string
  readonly transportKind: McpCustomServerTransportKind
  readonly command: string
  /** 引数（1行に1つ）。 */
  readonly argsText: string
  readonly enabled: boolean
  readonly env: readonly McpEnvRowState[]
}

let rowCounter = 0

function nextRowKey(): string {
  rowCounter += 1
  return `env-${rowCounter}`
}

/** 空の1行。 */
export function emptyEnvRow(): McpEnvRowState {
  return { key: nextRowKey(), name: '', value: '', secret: true, storedSecretName: null }
}

/**
 * 入力欄の最初の状態。新規（null）か、保存済みのサーバーか。
 *
 * 新規の「使う」は**切ってある**。組み込みの接続と同じく、外部のサービスへ
 * 利用者の権限で繋ぐものは、何もしていないのに有効になっている状態を作らない
 * （shared/mcp/settings.ts）。秘密にする欄は既定で入れてある ── 環境変数に
 * 入るのは API キーであることが多く、うっかり平文で保存しない側に倒す。
 */
export function formStateFromServer(
  server: McpCustomServerSummary | null
): McpCustomServerFormState {
  if (server === null) {
    return {
      name: '',
      transportKind: 'stdio',
      command: '',
      argsText: '',
      enabled: false,
      env: []
    }
  }

  return {
    name: server.name,
    transportKind: server.transport.kind,
    command: server.transport.command,
    argsText: argsToText(server.transport.args),
    enabled: server.enabled,
    env: server.env.map((variable) => ({
      key: nextRowKey(),
      name: variable.name,
      // 秘密の値は画面に戻ってこない（欄は空で、入れたときだけ送る）。
      value: variable.secret ? '' : variable.value,
      secret: variable.secret,
      storedSecretName: variable.secret && variable.stored ? variable.name : null
    }))
  }
}

/** 引数の配列から、欄の文字列へ（1行に1つ）。 */
export function argsToText(args: readonly string[]): string {
  return args.join('\n')
}

/**
 * 欄の文字列から、引数の配列へ。
 *
 * 1行が1つの引数で、**行の中の空白では区切らない**（`C:\My Files` は1つ）。
 * 行の前後の空白は落とし、空の行は数えない。
 */
export function parseArgsText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * その行が「保存されている秘密の値のまま」を送るか。
 *
 * 秘密のまま・名前を変えていない（大文字小文字は区別しない）・値の欄が空、のときだけ。
 */
export function keepsStoredSecret(row: McpEnvRowState): boolean {
  return (
    row.secret &&
    row.value.trim().length === 0 &&
    row.storedSecretName !== null &&
    row.storedSecretName.toUpperCase() === row.name.trim().toUpperCase()
  )
}

/** 保存の要求に載せる下書き（形の確かめは shared の検証が行う）。 */
export function draftFromFormState(state: McpCustomServerFormState): unknown {
  return {
    name: state.name,
    enabled: state.enabled,
    transport: {
      kind: state.transportKind,
      command: state.command,
      args: parseArgsText(state.argsText)
    },
    env: state.env.map((row) =>
      row.secret
        ? { name: row.name, secret: true, value: keepsStoredSecret(row) ? null : row.value }
        : { name: row.name, secret: false, value: row.value }
    )
  }
}

/**
 * 一覧に出すコマンドの見た目（表示だけ。起動には使わない）。
 *
 * 空白を含む引数だけを `"` で囲む。起動は配列のまま行われる（mcpServerLaunch.ts）。
 */
export function formatCommandLine(transport: McpCustomServerTransport): string {
  const show = (value: string): string => (/\s/.test(value) || value === '' ? `"${value}"` : value)
  return [transport.command, ...transport.args].map(show).join(' ')
}

const FIELD_KEYS: Readonly<Record<McpCustomServerField, TranslationKey>> = {
  server: 'settings.mcp.custom.fields.server',
  name: 'settings.mcp.custom.fields.name',
  enabled: 'settings.mcp.custom.fields.enabled',
  transport: 'settings.mcp.custom.fields.transport',
  command: 'settings.mcp.custom.fields.command',
  args: 'settings.mcp.custom.fields.args',
  env: 'settings.mcp.custom.fields.env'
}

const REASON_KEYS: Readonly<Record<McpCustomServerInvalidReason, TranslationKey>> = {
  required: 'settings.mcp.custom.invalid.required',
  'too-long': 'settings.mcp.custom.invalid.tooLong',
  'too-many': 'settings.mcp.custom.invalid.tooMany',
  'control-character': 'settings.mcp.custom.invalid.controlCharacter',
  'invalid-shape': 'settings.mcp.custom.invalid.invalidShape',
  'command-has-arguments': 'settings.mcp.custom.invalid.commandHasArguments',
  'invalid-command': 'settings.mcp.custom.invalid.invalidCommand',
  'invalid-name': 'settings.mcp.custom.invalid.invalidName',
  'reserved-name': 'settings.mcp.custom.invalid.reservedName',
  'duplicate-name': 'settings.mcp.custom.invalid.duplicateName',
  'unsupported-transport': 'settings.mcp.custom.invalid.unsupportedTransport',
  'secret-required': 'settings.mcp.custom.invalid.secretRequired'
}

/** 通らなかった理由を、画面の1行に出す材料へ。`index` は 1 始まりに直す。 */
export function describeInvalid(invalid: McpCustomServerInvalid): {
  readonly fieldKey: TranslationKey
  readonly reasonKey: TranslationKey
  readonly position: number | null
} {
  return {
    fieldKey: FIELD_KEYS[invalid.field],
    reasonKey: REASON_KEYS[invalid.reason],
    position: invalid.index === null ? null : invalid.index + 1
  }
}
