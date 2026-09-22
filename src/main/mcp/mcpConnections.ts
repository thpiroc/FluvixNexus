import type { PlatformId } from '@shared/api'
import type { LanguageId } from '@shared/language'
import type {
  McpConfigProblem,
  McpConnectionId,
  McpConnectionStatus,
  McpConnectionTestResult
} from '@shared/mcp'
import type { FileExistsCheck } from '../platform/executablePath'
import {
  connectMcpClient,
  type McpClient,
  type McpClientOptions,
  type McpFailure,
  type McpTransport
} from './mcpClient'
import {
  findMcpOperation,
  McpRequestError,
  type McpOperationDescription,
  type McpOperationResult
} from './mcpOperations'
import { redactSecrets } from './mcpRedaction'
import {
  createMcpServerEnvironment,
  resolveMcpServerCommand,
  type McpServerCommand,
  type McpServerDefinition
} from './mcpServerDefinition'
import type { McpStdioTransportOptions } from './mcpStdioTransport'

/**
 * MCP の接続を束ねる（MCP 共通。Electron 非依存・テスト対象）。
 *
 * ## 持つもの
 *
 * ```
 * 状態    接続ごとの「直近の接続テストの結末」と「テスト中か」
 * 手続き  設定を確かめる → 起動する → 接続する → （一覧を取る / ツールを呼ぶ）→ 切断する
 * 片付け  動いているサーバーを、アプリの終了時にまとめて終わらせる
 * ```
 *
 * 今は**接続を持ち続けない**。テストや操作のたびに立てて畳む。1回ごとに
 * サーバーの起動（数百 ms〜数秒）がかかるが、使っていない間に利用者の PC で
 * サーバーが動き続けることは無い。
 *
 * 操作は接続ごとに**1つずつ**実行する（前の操作が終わるまで次は起動しない）。
 * 続けて呼ばれても、サーバーが何本も並んで立つことは無い。
 *
 * ## 書き込みの確認
 *
 * `write` の操作は、**サーバーを起動する前に** `confirmWrite` を呼ぶ。
 * 断られたら何も起動せずに `declined` を返す。今は書き込みを許可する経路が無いので、
 * mcpService.ts は常に断る（DESIGN.md §6）。
 *
 * ## 設定はそのたびに読む
 *
 * 環境変数を設定し直した後に、アプリを起動し直さなくてよい形にしておく
 * （ただし Windows では、アプリを起動した時点の環境変数を引き継ぐので、
 * `setx` した値はアプリを起動し直すまで見えない）。
 *
 * ## ログに秘密の値も引数も出さない
 *
 * サーバーの stderr と失敗の詳細は、秘密の環境変数の値を伏せてからログへ渡す。
 * 操作の引数（ページの本文など）はログに書かない ── 残すのは操作名と結末だけ。
 */

export interface McpConnectionsLogger {
  readonly debug: (message: string) => void
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
}

/** 書き込みの確認に渡すもの。 */
export interface McpWriteConfirmation extends McpOperationDescription {
  readonly connectionId: McpConnectionId
  readonly operation: string
}

export interface McpConnectionsDependencies {
  /** 呼ばれるたびに今の環境変数を返す。 */
  readonly env: () => Readonly<Record<string, string | undefined>>
  readonly platform: PlatformId
  readonly exists: FileExistsCheck
  /** サーバーの作業ディレクトリ（Workspace ではない場所）。 */
  readonly cwd: () => string
  readonly createTransport: (options: McpStdioTransportOptions) => McpTransport
  readonly clientInfo: McpClientOptions['clientInfo']
  readonly now: () => Date
  readonly log: McpConnectionsLogger
  /** 確認の文に使う言語。 */
  readonly language: () => LanguageId
  /** 書き込みを実行してよいかを確かめる。true で実行する。 */
  readonly confirmWrite: (confirmation: McpWriteConfirmation) => Promise<boolean>
  /**
   * その接続を使ってよいか。全体の元栓（Settings の `mcp.enabled`）と、
   * 登録簿のそのサーバーの栓の両方を見る（mcpService.ts）。
   *
   * ここを関数で受け取るのは、**設定はいつでも変わる**ため ── 起動時に1度
   * 読んだ値を持つと、Settings で有効にした直後に接続テストが
   * 「無効です」と答えることになる。
   */
  readonly isEnabled: (id: McpConnectionId) => boolean
  /**
   * 接続 id から、定義へ。登録簿の行からそのつど作る（mcpCustomServerDefinition.ts）。
   * 無ければ null ── 消されたサーバーの id が届いた（呼び手の不具合）。
   *
   * 関数で受け取るのは、有効 / 無効と同じく**登録簿はいつでも変わる**ため。
   */
  readonly definitionOf: (id: McpConnectionId) => McpServerDefinition | null
  /** 時間切れの上限（テストで縮めるため）。 */
  readonly connectTimeoutMs?: number
  readonly requestTimeoutMs?: number
}

export interface McpConnections {
  /** 設定が揃っているかと直近の結末（起動も通信もしない）。 */
  readonly getStatus: (id: McpConnectionId) => McpConnectionStatus
  /** 接続テスト。テスト中にもう一度呼ばれたら、同じ結末を待つ。 */
  readonly testConnection: (id: McpConnectionId) => Promise<McpConnectionTestResult>
  /**
   * 操作を1つ実行する（Main の中だけの口。Renderer からは呼べない）。
   * 知らない操作名・壊れた引数は `McpRequestError` を投げる（呼び手の不具合）。
   */
  readonly callOperation: (
    id: McpConnectionId,
    operation: string,
    rawArguments: unknown
  ) => Promise<McpOperationResult>
  /**
   * 直近の接続テストの結末を忘れる。
   *
   * **登録の中身（Command・引数・環境変数・秘密の値）を変えたら呼ぶ。** 結末は
   * 「その時点の設定で試した結果」であって、設定が変わればもう今の話ではない
   * ── 秘密の値を入れ替えた後も「接続できました」が残ると、前の資格情報での
   * 結果を、今の資格情報の結果として読むことになる。
   *
   * 有効 / 無効では忘れない。あちらは中身を変えないので、戻したときに
   * 前の結末がそのまま意味を持つ。
   */
  readonly forgetLastTest: (id: McpConnectionId) => void
  /** 動いているサーバーを待たずに終わらせる（アプリの終了時）。 */
  readonly terminateAll: () => void
}

type ResolvedConfig =
  | {
      readonly ok: true
      readonly definition: McpServerDefinition
      readonly command: McpServerCommand
    }
  | { readonly ok: false; readonly problems: readonly McpConfigProblem[] }

/** 立てたサーバーとの1回分のやりとり。 */
interface McpSession {
  readonly client: McpClient
  readonly name: string
  readonly redact: (text: string) => string
}

export function createMcpConnections(deps: McpConnectionsDependencies): McpConnections {
  const lastTests = new Map<McpConnectionId, McpConnectionTestResult>()
  const runningTests = new Map<McpConnectionId, Promise<McpConnectionTestResult>>()
  const operationQueues = new Map<McpConnectionId, Promise<unknown>>()
  const transports = new Set<McpTransport>()

  /** 定義。無い id は呼び手の不具合として断る（IPC なら INVALID_REQUEST）。 */
  function definitionOf(id: McpConnectionId): McpServerDefinition {
    const definition = deps.definitionOf(id)

    if (definition === null) {
      throw new McpRequestError('unknown MCP connection.')
    }

    return definition
  }

  function resolveConfig(id: McpConnectionId, definition: McpServerDefinition): ResolvedConfig {
    const env = deps.env()
    const problems: McpConfigProblem[] = []

    /*
      無効なら、ほかの理由は数えない。「無効です」と「Command が見つかりません」が
      並ぶと、先にそちらを直させることになる ── 利用者の次の一手は1つでよい。
    */
    if (!deps.isEnabled(id)) {
      return { ok: false, problems: ['disabled'] }
    }

    problems.push(...(definition.configProblems ?? []))

    const command = resolveMcpServerCommand(definition, {
      platform: deps.platform,
      env,
      exists: deps.exists
    })

    if (!command.ok) {
      problems.push(command.problem)
    }

    if (!command.ok || problems.length > 0) {
      return { ok: false, problems }
    }

    return { ok: true, definition, command: command.command }
  }

  /**
   * 起動して接続し、`use` を実行して、必ず切断する。
   * 接続できなければ `use` は呼ばずに失敗を返す。
   */
  async function withSession<T>(
    config: Extract<ResolvedConfig, { ok: true }>,
    use: (session: McpSession) => Promise<T>
  ): Promise<{ readonly ok: true; readonly value: T } | McpFailure> {
    const { definition, command } = config
    const redact = (text: string): string => redactSecrets(text, definition.redactions ?? [])

    const transport = deps.createTransport({
      command,
      env: createMcpServerEnvironment(definition, deps.env()),
      cwd: deps.cwd(),
      onStderrLine: (line) => deps.log.debug(`${command.name} stderr: ${redact(line)}`),
      onStderrDropped: (count) =>
        deps.log.debug(`${command.name} stderr: ${count} more line(s) were not logged.`)
    })

    transports.add(transport)

    try {
      const connected = await connectMcpClient(transport, {
        clientInfo: deps.clientInfo,
        connectTimeoutMs: deps.connectTimeoutMs,
        requestTimeoutMs: deps.requestTimeoutMs,
        onWarning: (reason) => deps.log.warn(`${command.name}: ${redact(reason)}`)
      })

      if (!connected.ok) {
        deps.log.warn(
          `${command.name}: could not connect (${connected.failure}): ${redact(connected.detail)}`
        )
        return connected
      }

      try {
        return {
          ok: true,
          value: await use({ client: connected.client, name: command.name, redact })
        }
      } finally {
        await connected.client.close()
      }
    } finally {
      // 失敗の経路でも閉じる（connectMcpClient は失敗時に閉じるが、投げた場合に備える）。
      await transport.close()
      transports.delete(transport)
    }
  }

  async function runTest(id: McpConnectionId): Promise<McpConnectionTestResult> {
    const testedAt = (): string => deps.now().toISOString()
    const config = resolveConfig(id, definitionOf(id))

    if (!config.ok) {
      deps.log.info(`${id}: not configured (${config.problems.join(', ')}).`)
      return { outcome: 'not-configured', testedAt: testedAt(), problems: config.problems }
    }

    const session = await withSession(config, async ({ client, name, redact }) => {
      const listed = await client.listTools()

      if (!listed.ok) {
        deps.log.warn(`${name}: could not list tools (${listed.failure}): ${redact(listed.detail)}`)
        return { outcome: 'failed', testedAt: testedAt(), failure: listed.failure } as const
      }

      deps.log.info(
        `${name}: connected (protocol ${client.protocolVersion}, ${listed.tools.length} tool(s)).`
      )

      return {
        outcome: 'connected',
        testedAt: testedAt(),
        server: client.serverInfo,
        protocolVersion: client.protocolVersion,
        tools: listed.tools
      } as const
    })

    return session.ok
      ? session.value
      : { outcome: 'failed', testedAt: testedAt(), failure: session.failure }
  }

  async function runOperation(
    id: McpConnectionId,
    operationName: string,
    rawArguments: unknown
  ): Promise<McpOperationResult> {
    const definition = definitionOf(id)
    const operation = findMcpOperation(definition.operations, operationName)

    if (operation === null) {
      throw new McpRequestError(`unknown MCP operation for ${id}.`)
    }

    const parsed = operation.parseArguments(rawArguments)

    if (!parsed.ok) {
      throw new McpRequestError(`invalid arguments for ${id}/${operationName}: ${parsed.reason}`)
    }

    const args = parsed.value
    const config = resolveConfig(id, definition)

    if (!config.ok) {
      deps.log.info(`${id}/${operationName}: not configured (${config.problems.join(', ')}).`)
      return { outcome: 'not-configured', operation: operationName, problems: config.problems }
    }

    if (operation.kind === 'write') {
      // defineMcpOperation が、書き込みには describe があることを保証している。
      const description = operation.describe?.(args, deps.language())

      const confirmed =
        description !== undefined &&
        (await deps.confirmWrite({ connectionId: id, operation: operationName, ...description }))

      if (!confirmed) {
        deps.log.info(`${id}/${operationName}: declined by the user.`)
        return { outcome: 'declined', operation: operationName }
      }
    }

    const session = await withSession(
      config,
      async ({ client, name, redact }): Promise<McpOperationResult> => {
        /*
          呼ぶ前に、そのツールが公開されているかを確かめる。サーバーの版が変わって
          名前が消えた・変わったときに、別の意味のツールを呼ばないため。
        */
        const listed = await client.listTools()

        if (!listed.ok) {
          deps.log.warn(
            `${name}: could not list tools (${listed.failure}): ${redact(listed.detail)}`
          )
          return failed(operationName, listed.failure)
        }

        if (!listed.tools.some((tool) => tool.name === operation.tool)) {
          deps.log.warn(`${name}: ${operationName} needs a tool the server does not offer.`)
          return failed(operationName, 'tool-unavailable')
        }

        const called = await client.callTool(operation.tool, operation.toolArguments(args))
        const isWrite = operation.kind === 'write'

        if (!called.ok) {
          /*
            書き込みを送った後に途切れたなら、相手の側では反映されたかもしれない。
            ただの失敗として返すと、呼び手がやり直して二重に書き込む。
            相手が失敗として返した（rejected）なら、反映されていない。
          */
          const unknown = isWrite && called.requestSent === true && called.failure !== 'rejected'
          deps.log.warn(
            `${name}: ${operationName} failed (${called.failure}${unknown ? ', outcome unknown' : ''}): ${redact(called.detail)}`
          )
          return failed(operationName, unknown ? 'outcome-unknown' : called.failure)
        }

        /*
          `isError` が付いていなくても、操作が失敗と読んだものは失敗として扱う
          （API のエラーを普通の結果として返すサーバーがある。mcpOperations.ts）。
        */
        const toolError = operation.readToolError?.(called.result) ?? null

        if (called.result.isError || toolError !== null) {
          deps.log.warn(
            `${name}: ${operationName} returned an error (status ${String(toolError?.status ?? null)}, code ${String(toolError?.code ?? null)}).`
          )
          return { ...failed(operationName, 'tool-error'), toolError }
        }

        const data = operation.readResult(called.result, args)

        if (data === null) {
          // 書き込みの結果が読めないのは、反映されたかどうかが分からないということ。
          deps.log.warn(`${name}: ${operationName} returned a result that could not be read.`)
          return failed(operationName, isWrite ? 'outcome-unknown' : 'invalid-result')
        }

        deps.log.info(`${name}: ${operationName} completed.`)
        return { outcome: 'completed', operation: operationName, data }
      }
    )

    return session.ok ? session.value : failed(operationName, session.failure)
  }

  return {
    getStatus: (id): McpConnectionStatus => {
      const definition = definitionOf(id)
      const config = resolveConfig(id, definition)
      const problems = config.ok ? [] : config.problems

      return {
        connectionId: id,
        configured: problems.length === 0,
        problems,
        enabled: deps.isEnabled(id),
        testing: runningTests.has(id),
        lastTest: lastTests.get(id) ?? null
      }
    },

    testConnection: (id): Promise<McpConnectionTestResult> => {
      const current = runningTests.get(id)

      if (current !== undefined) {
        return current
      }

      const test = runTest(id)
        .then((result) => {
          lastTests.set(id, result)
          return result
        })
        .finally(() => {
          runningTests.delete(id)
        })

      runningTests.set(id, test)

      return test
    },

    callOperation: (id, operation, rawArguments): Promise<McpOperationResult> => {
      const previous = operationQueues.get(id) ?? Promise.resolve()
      // 前の操作の成否に関わらず、終わってから始める。
      const next = previous.then(
        () => runOperation(id, operation, rawArguments),
        () => runOperation(id, operation, rawArguments)
      )
      const settled = next.catch(() => undefined)

      operationQueues.set(id, settled)
      void settled.then(() => {
        if (operationQueues.get(id) === settled) {
          operationQueues.delete(id)
        }
      })

      return next
    },

    forgetLastTest: (id): void => {
      lastTests.delete(id)
    },

    terminateAll: (): void => {
      for (const transport of transports) {
        transport.terminate()
      }

      transports.clear()
    }
  }
}

function failed(
  operation: string,
  failure: Extract<McpOperationResult, { outcome: 'failed' }>['failure']
): Extract<McpOperationResult, { outcome: 'failed' }> {
  return { outcome: 'failed', operation, failure, toolError: null }
}
