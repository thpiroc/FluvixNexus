/**
 * adapter からの逆方向 request `startDebugging` の検証（Session 6-15A。純粋・テスト対象）。
 *
 * DAP の `startDebugging` は、adapter が client に「この構成でもう1本セッションを張ってくれ」と
 * 頼むもの。vscode-js-debug は root セッションから、debug 対象（target）ごとにこれを送り、
 * client は同じ adapter server へ別の接続を張って、その構成を `launch` として渡す。
 *
 * ## 何を通すか
 *
 * **受けてよいのは「Main が既に起動を決めた adapter の、既に起動した対象へ繋ぎに行く」形だけ。**
 * `runInTerminal`（§20.9）と同じく、ここを緩めると adapter が Main に起動させるものを決める経路になる。
 *
 * | 見るもの                   | 通す形                                                               |
 * | -------------------------- | -------------------------------------------------------------------- |
 * | `request`                  | `launch` だけ（`attach` と任意の文字列は断る）                       |
 * | `configuration.type`       | root の launch と同じ `type`（Main の表）                            |
 * | `configuration.request`    | 無いか、`launch`                                                     |
 * | target の id（欄名は表の側） | 必須。短い英数字の文字列                                             |
 * | 実行ファイル / cwd / shell  | どれか1つでも載っていれば断る（下の `FORBIDDEN_CONFIGURATION_KEYS`） |
 * | それ以外の欄               | **捨てる**（子の `launch` に届かない）                               |
 *
 * 子の `launch` へ渡すのは、ここで作り直した `{ type, name, request, <target id> }` の4欄だけ。
 * adapter から来た object をそのまま渡さない。
 */

/**
 * 子セッションを受けるかの Main 内部の決め（catalog の行と resolver から作る）。
 *
 * これが無いセッション（debugpy / netcoredbg）は `startDebugging` を一律に断る。
 */
export interface DebugChildSessionPolicy {
  /** 子の構成の `type` として受け入れる値。root の launch の `type` と同じもの。 */
  readonly launchType: string
  /** adapter が target を見分けるために構成へ入れてくる欄の名前（例: `__pendingTargetId`）。 */
  readonly targetIdKey: string
}

export type DapStartDebuggingRejection =
  | 'malformed'
  | 'attach-not-allowed'
  | 'unknown-request'
  | 'unknown-type'
  | 'forbidden-field'
  | 'invalid-target'

export type DapStartDebuggingValidation =
  | {
      readonly status: 'accepted'
      /** 子の `launch` に渡す構成（作り直したもの）。 */
      readonly configuration: Readonly<Record<string, unknown>>
      readonly targetId: string
      /** ログ用の名前（Renderer へは出さない）。 */
      readonly name: string
      /** 捨てた欄の数（ログ用）。 */
      readonly droppedFieldCount: number
    }
  | { readonly status: 'rejected'; readonly reason: DapStartDebuggingRejection }

/**
 * 載っていたら構成ごと断る欄（大文字小文字を区別しない）。
 *
 * 「何のプログラムが、どこで、どう動くか」を変える欄（§20.1）。捨てるだけにしないのは、
 * 載せてきた時点で adapter が Main の決めていない起動を頼んでいることになるため。
 */
export const FORBIDDEN_CONFIGURATION_KEYS: readonly string[] = [
  'program',
  'args',
  'cwd',
  'env',
  'envFile',
  'runtimeExecutable',
  'runtimeArgs',
  'runtimeVersion',
  'console',
  'shell',
  'preLaunchTask',
  'postDebugTask',
  'processId',
  'port',
  'address',
  'websocketAddress',
  'url',
  'file',
  'python',
  'pythonPath',
  'debugServer',
  'pipeTransport',
  'debuggerPath'
]

const FORBIDDEN = new Set(FORBIDDEN_CONFIGURATION_KEYS.map((key) => key.toLowerCase()))

export const DAP_CHILD_SESSION_NAME_MAX_LENGTH = 200
export const DAP_CHILD_TARGET_ID_MAX_LENGTH = 128

const TARGET_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

export function validateDapStartDebuggingArguments(
  args: unknown,
  policy: DebugChildSessionPolicy
): DapStartDebuggingValidation {
  if (!isPlainObject(args)) {
    return rejected('malformed')
  }

  const request = readOwn(args, 'request')

  if (request === 'attach') {
    return rejected('attach-not-allowed')
  }

  if (request !== 'launch') {
    return rejected(typeof request === 'string' ? 'unknown-request' : 'malformed')
  }

  const configuration = readOwn(args, 'configuration')

  if (!isPlainObject(configuration)) {
    return rejected('malformed')
  }

  const configurationRequest = readOwn(configuration, 'request')

  if (configurationRequest === 'attach') {
    return rejected('attach-not-allowed')
  }

  if (configurationRequest !== undefined && configurationRequest !== 'launch') {
    return rejected('unknown-request')
  }

  if (readOwn(configuration, 'type') !== policy.launchType) {
    return rejected('unknown-type')
  }

  const keys = Object.keys(configuration)

  if (keys.some((key) => FORBIDDEN.has(key.toLowerCase()))) {
    return rejected('forbidden-field')
  }

  const targetId = readOwn(configuration, policy.targetIdKey)

  if (
    typeof targetId !== 'string' ||
    targetId.length === 0 ||
    targetId.length > DAP_CHILD_TARGET_ID_MAX_LENGTH ||
    !TARGET_ID_PATTERN.test(targetId)
  ) {
    return rejected('invalid-target')
  }

  const name = sanitizeName(readOwn(configuration, 'name'))
  const kept = new Set(['type', 'name', 'request', policy.targetIdKey])

  return {
    status: 'accepted',
    configuration: {
      type: policy.launchType,
      name,
      request: 'launch',
      [policy.targetIdKey]: targetId
    },
    targetId,
    name,
    droppedFieldCount: keys.filter((key) => !kept.has(key)).length
  }
}

function rejected(reason: DapStartDebuggingRejection): DapStartDebuggingValidation {
  return { status: 'rejected', reason }
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 自分の欄だけを読む（`__proto__` や prototype の欄を拾わない）。 */
function readOwn(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') {
    return 'child'
  }

  let collapsed = ''

  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0
    collapsed += code < 0x20 || code === 0x7f ? ' ' : character
  }

  collapsed = collapsed.replace(/\s+/g, ' ').trim()

  if (collapsed.length === 0) {
    return 'child'
  }

  return collapsed.length <= DAP_CHILD_SESSION_NAME_MAX_LENGTH
    ? collapsed
    : collapsed.slice(0, DAP_CHILD_SESSION_NAME_MAX_LENGTH)
}
