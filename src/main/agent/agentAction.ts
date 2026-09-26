/**
 * FN Agent の Action（Security Core v1 の STEP9。Electron にも fs にも依存しない）。
 *
 * AI は「何をしたいか」を**構造化された Action として提案するだけ**で、実行するかどうかは
 * FN（Agent Loop）と Security Core が決める。AI の自由文をそのまま実行する経路は無く、
 * **Security Core を通すかどうかを AI に選ばせる欄も無い。**
 *
 * ```
 * AI の出力（未検査）
 *   ↓ parseAgentTurn          ← ここ。形・種類・長さを確かめる（Runtime Schema Validation）
 * AgentAction（閉じた集合）
 *   ↓ Agent Loop              1ターン1 Action・再試行・停止
 *   ↓ Security Core           Read Tool Gate / File Write Gate / Terminal Command Runner
 * Tool
 * ```
 *
 * ## v1 の Action（閉じた集合）
 *
 * ```
 * workspace_list    { path? }                      フォルダを1階層
 * workspace_status  {}                             Workspace の状態
 * file_read         { path, startLine?, endLine? } テキストファイルを読む
 * file_search       { query }                      文字列で探す
 * file_write        { path, content }              STEP7 File Write Gate（二段階承認）
 * terminal_run      { command, args?, cwd? }       STEP8 Terminal Command Runner（二段階承認）
 * complete          { answer }                     作業を終える
 * ```
 *
 * MCP の書き込み・Git の Commit / Push・binary の書き込み・その他 Gate の無い副作用は
 * **ここに無い。** 知らない種類は実行せず、`invalid-action` として AI へ返す。
 *
 * ## 厳密に読む
 *
 * - 出力は `{ "action": { "type": …, … } }` の1つだけ。JSON の文字列でもよい
 * - **知らない欄が1つでもあれば拒む**（`approved: true` / `safe: true` / `skipSecurity` の
 *   ような欄を「読まない」だけでなく、付けてきたこと自体を壊れた出力として扱う）
 * - 2つ以上の Action（`actions: [...]`）は `parallel-action` で拒む（v1 は1ターン1 Action）
 * - 型・長さが合わないものは拒む。ここで通っても、Gate がもう一度確かめる
 */

/** Action の種類（閉じた集合）。 */
export type AgentActionType =
  | 'workspace_list'
  | 'workspace_status'
  | 'file_read'
  | 'file_search'
  | 'file_write'
  | 'terminal_run'
  | 'complete'

export const AGENT_ACTION_TYPES: readonly AgentActionType[] = Object.freeze([
  'complete',
  'file_read',
  'file_search',
  'file_write',
  'terminal_run',
  'workspace_list',
  'workspace_status'
])

export type AgentAction =
  | { readonly type: 'workspace_list'; readonly path: string }
  | { readonly type: 'workspace_status' }
  | {
      readonly type: 'file_read'
      readonly path: string
      readonly startLine: number | null
      readonly endLine: number | null
    }
  | { readonly type: 'file_search'; readonly query: string }
  | { readonly type: 'file_write'; readonly path: string; readonly content: string }
  | {
      readonly type: 'terminal_run'
      readonly command: string
      readonly args: readonly string[]
      readonly cwd: string
    }
  | { readonly type: 'complete'; readonly answer: string }

/** 副作用のある Action（承認が要る・共有ロックを取る）。 */
export function isSideEffectAction(action: AgentAction): boolean {
  return action.type === 'file_write' || action.type === 'terminal_run'
}

/** Workspace 相対の位置の上限（shared/files の FILES_RELATIVE_PATH_MAX_LENGTH と同じ）。 */
export const AGENT_PATH_MAX_LENGTH = 1024
/** 書き込む本文の上限（STEP6 / STEP7 の APPROVAL_CONTENT_MAX_CHARS と同じ）。 */
export const AGENT_CONTENT_MAX_CHARS = 1_000_000
/** 検索語の上限。 */
export const AGENT_QUERY_MAX_LENGTH = 200
/** コマンドの名前の上限。 */
export const AGENT_COMMAND_MAX_LENGTH = 256
/** 引数の数の上限。 */
export const AGENT_MAX_ARGS = 64
/** 引数1つの上限。 */
export const AGENT_ARG_MAX_LENGTH = 2_000
/** 最終回答の上限。 */
export const AGENT_ANSWER_MAX_LENGTH = 20_000
/** AI の出力として読む文字数の上限（本文 1,000,000 文字 ＋ JSON の分）。 */
export const AGENT_OUTPUT_MAX_CHARS = 1_200_000

export type AgentTurnRejection = 'invalid-action' | 'parallel-action'

export type ParsedAgentTurn =
  | { readonly ok: true; readonly action: AgentAction }
  | {
      readonly ok: false
      readonly reason: AgentTurnRejection
      /** AI へ返す短い説明（固定の文言。AI の出力は含めない）。 */
      readonly problem: string
      /** 分かった範囲の Action の種類（Audit の subject。知らなければ `null`）。 */
      readonly actionType: AgentActionType | null
    }

/** AI の出力1回を、Action 1つとして読む。**例外を投げない。** */
export function parseAgentTurn(raw: unknown): ParsedAgentTurn {
  try {
    return parse(raw)
  } catch {
    return reject('invalid-action', 'The output could not be read.', null)
  }
}

function parse(raw: unknown): ParsedAgentTurn {
  let value = raw

  if (typeof value === 'string') {
    if (value.length > AGENT_OUTPUT_MAX_CHARS) {
      return reject('invalid-action', 'The output is too long.', null)
    }

    try {
      value = JSON.parse(value)
    } catch {
      return reject('invalid-action', 'The output is not valid JSON.', null)
    }
  }

  if (!isRecord(value)) {
    return reject('invalid-action', 'The output must be a JSON object: {"action": {...}}.', null)
  }

  if (Object.hasOwn(value, 'actions')) {
    const actions = value.actions

    return Array.isArray(actions) && actions.length > 1
      ? reject(
          'parallel-action',
          'Only one action per turn is allowed. Return a single "action".',
          null
        )
      : reject('invalid-action', 'Use "action" (a single object), not "actions".', null)
  }

  const keys = Object.keys(value)

  if (keys.length !== 1 || keys[0] !== 'action') {
    return reject('invalid-action', 'The output must have exactly one key: "action".', null)
  }

  const action = value.action

  if (Array.isArray(action)) {
    return action.length > 1
      ? reject('parallel-action', 'Only one action per turn is allowed.', null)
      : reject('invalid-action', '"action" must be an object.', null)
  }

  if (!isRecord(action)) {
    return reject('invalid-action', '"action" must be an object.', null)
  }

  const type = action.type

  if (typeof type !== 'string' || !(AGENT_ACTION_TYPES as readonly string[]).includes(type)) {
    return reject('invalid-action', 'Unknown action type.', null)
  }

  return readAction(type as AgentActionType, action)
}

function readAction(
  type: AgentActionType,
  action: Readonly<Record<string, unknown>>
): ParsedAgentTurn {
  switch (type) {
    case 'workspace_status':
      return onlyKeys(action, []) ?? ok({ type })

    case 'workspace_list': {
      const problem = onlyKeys(action, ['path'])

      if (problem !== null) {
        return problem
      }

      const path = action.path === undefined ? '' : action.path

      return isText(path, 0, AGENT_PATH_MAX_LENGTH)
        ? ok({ type, path })
        : bad(type, '"path" must be a workspace-relative path string.')
    }

    case 'file_read': {
      const problem = onlyKeys(action, ['path', 'startLine', 'endLine'])

      if (problem !== null) {
        return problem
      }

      const { path, startLine, endLine } = action

      if (!isText(path, 1, AGENT_PATH_MAX_LENGTH)) {
        return bad(type, '"path" must be a workspace-relative file path.')
      }

      if (!isOptionalLine(startLine) || !isOptionalLine(endLine)) {
        return bad(type, '"startLine" / "endLine" must be positive integers.')
      }

      const start = startLine ?? null
      const end = endLine ?? null

      if (start !== null && end !== null && end < start) {
        return bad(type, '"endLine" must not be smaller than "startLine".')
      }

      return ok({ type, path, startLine: start, endLine: end })
    }

    case 'file_search': {
      const problem = onlyKeys(action, ['query'])

      if (problem !== null) {
        return problem
      }

      return isText(action.query, 1, AGENT_QUERY_MAX_LENGTH) &&
        (action.query as string).trim().length > 0 &&
        !/[\r\n]/.test(action.query as string)
        ? ok({ type, query: action.query as string })
        : bad(type, '"query" must be a single-line string (1-200 characters).')
    }

    case 'file_write': {
      const problem = onlyKeys(action, ['path', 'content'])

      if (problem !== null) {
        return problem
      }

      const { path, content } = action

      if (!isText(path, 1, AGENT_PATH_MAX_LENGTH)) {
        return bad(type, '"path" must be a workspace-relative file path.')
      }

      if (!isText(content, 0, AGENT_CONTENT_MAX_CHARS)) {
        return bad(type, '"content" must be the whole new text of the file.')
      }

      return ok({ type, path, content })
    }

    case 'terminal_run': {
      const problem = onlyKeys(action, ['command', 'args', 'cwd'])

      if (problem !== null) {
        return problem
      }

      const { command } = action
      const args = action.args === undefined ? [] : action.args
      const cwd = action.cwd === undefined ? '' : action.cwd

      if (!isText(command, 1, AGENT_COMMAND_MAX_LENGTH)) {
        return bad(type, '"command" must be a command name on PATH (for example "npm").')
      }

      if (
        !Array.isArray(args) ||
        args.length > AGENT_MAX_ARGS ||
        !args.every((arg) => isText(arg, 0, AGENT_ARG_MAX_LENGTH))
      ) {
        return bad(type, '"args" must be an array of strings.')
      }

      if (!isText(cwd, 0, AGENT_PATH_MAX_LENGTH)) {
        return bad(type, '"cwd" must be a workspace-relative folder ("" is the root).')
      }

      return ok({ type, command, args: Object.freeze([...(args as string[])]), cwd })
    }

    case 'complete': {
      const problem = onlyKeys(action, ['answer'])

      if (problem !== null) {
        return problem
      }

      return isText(action.answer, 1, AGENT_ANSWER_MAX_LENGTH)
        ? ok({ type, answer: action.answer as string })
        : bad(type, '"answer" must be the final answer text for the user.')
    }
  }
}

/** `type` と、許した欄以外が付いていれば拒む。 */
function onlyKeys(
  action: Readonly<Record<string, unknown>>,
  allowed: readonly string[]
): ParsedAgentTurn | null {
  const extra = Object.keys(action).filter((key) => key !== 'type' && !allowed.includes(key))

  return extra.length === 0
    ? null
    : reject(
        'invalid-action',
        `Unknown field(s) for this action. Allowed: ${allowed.length === 0 ? '(none)' : allowed.join(', ')}.`,
        action.type as AgentActionType
      )
}

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

/**
 * 行の番号（無い ＝ 先頭から / 最後まで）。**`null` も「無い」と読む**（STEP10-6）── Structured
 * Outputs の strict な JSON Schema はすべての欄を必須にするため、指定しない行は `null` で届く。
 * 読んだ後の形は今までどおり `number | null`。
 */
function isOptionalLine(value: unknown): value is number | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1)
  )
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok(action: AgentAction): ParsedAgentTurn {
  return Object.freeze({ ok: true as const, action: Object.freeze(action) })
}

function bad(type: AgentActionType, problem: string): ParsedAgentTurn {
  return reject('invalid-action', problem, type)
}

function reject(
  reason: AgentTurnRejection,
  problem: string,
  actionType: AgentActionType | null
): ParsedAgentTurn {
  return Object.freeze({ ok: false as const, reason, problem, actionType })
}
