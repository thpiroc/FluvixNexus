import {
  isDebugEvaluateContext,
  isDebugEvaluateExpressionShape,
  isDebugVariableHandleShape,
  type DebugExecutionControl
} from '@shared/debug'
import {
  IPC_CHANNELS,
  type DebugCallStackResponse,
  type DebugBreakpointsResponse,
  type DebugEvaluateResponse,
  type DebugScopesResponse,
  type DebugStatusResponse,
  type DebugVariablesResponse,
  type EvaluateDebugExpressionRequest,
  type IpcChannel,
  type ListDebugScopesRequest,
  type ListDebugVariablesRequest,
  type ToggleDebugBreakpointRequest
} from '@shared/ipc'
import { listDebugBreakpoints, toggleDebugBreakpoint } from '../../debug/breakpoints'
import { listDebugCallStack } from '../../debug/callStack'
import { controlDebugSession, requestDebugSessionStop } from '../../debug/debugSessionManager'
import { evaluateDebugExpression } from '../../debug/evaluate'
import { getDebugSessionStatus } from '../../debug/sessionStatus'
import { listDebugScopes, listDebugVariables } from '../../debug/variables'
import { IpcError, invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * 実行制御のチャンネルと、Main の中での名前（Session 6-4）。
 *
 * **対応はこの表で閉じている。** 要求から制御の名前を読むことはしない
 * ── 要求はどれも `void` で、どの制御かはチャンネルそのものが決める。
 */
type ExecutionControlChannel = Extract<
  IpcChannel,
  'debug:continue' | 'debug:pause' | 'debug:step-over' | 'debug:step-into' | 'debug:step-out'
>

const EXECUTION_CONTROL_CHANNELS: ReadonlyArray<
  readonly [ExecutionControlChannel, DebugExecutionControl]
> = [
  [IPC_CHANNELS.DEBUG_CONTINUE, 'continue'],
  [IPC_CHANNELS.DEBUG_PAUSE, 'pause'],
  [IPC_CHANNELS.DEBUG_STEP_OVER, 'stepOver'],
  [IPC_CHANNELS.DEBUG_STEP_INTO, 'stepInto'],
  [IPC_CHANNELS.DEBUG_STEP_OUT, 'stepOut']
]

/**
 * debug ドメインのハンドラ（Session 6-3 ── Breakpoint / Session 6-4 ── 実行制御）。
 *
 * このファイルが持つのは2つだけで、adapter との話は main/debug/ に閉じている
 * （lsp / terminal ドメインと同じ分担）。
 *   - 境界の外から来た値（相対位置・行）を確かめる
 *   - ドメインの結末を IPC の失敗分類へ翻訳する
 *
 * ## 確かめるものが2つしかない
 *
 * ```
 * 相対位置 … Workspace の中を指しているか（main/debug/breakpointSource.ts）
 * 行       … 1起点の整数で、上限の中か（shared/debug/breakpoint.ts）
 * ```
 *
 * Session 6-6 / 6-7 で増えたのも同じ性格のもの（`frameId` / `handle` / 式 / 文脈の**形**）で、
 * 「今の停止のものか」は main/debug/ の側が決め、値（`unavailable`）で返る。
 *
 * 実行制御（Session 6-4）は要求そのものが `void` で、確かめる値が1つも無い。
 *
 * **それ以外に受け取る欄が無い。** adapter も、DAP の method 名も、絶対パスも、
 * 要求に載る欄そのものが存在しない（shared/ipc/contracts/debug.ts）。
 * 「弾く」のではなく「欄を作らない」で閉じている部分にあたる
 * （docs/ARCHITECTURE.md §20.9）。
 *
 * ## 相対位置の検証は Files / LSP と同じ関数を通る
 *
 * `normalizeWorkspaceRelativePath` → `resolveWorkspacePath` の2段で、
 * main/debug/breakpointSource.ts が通す。別の検証をここへ書き起こさないのは、
 * 書き起こすと片方だけに穴が空くため。
 */
export function registerDebugHandlers(): void {
  /*
    今の Workspace の breakpoint（Session 6-3）。**要求に欄が1つも無い** ──
    どの Workspace の分かも Renderer は言わず、返るのは常に今開いている分になる
    （`lsp:get-status` と同じ形）。
  */
  handleIpc(IPC_CHANNELS.DEBUG_LIST_BREAKPOINTS, (): DebugBreakpointsResponse => {
    return { breakpoints: listDebugBreakpoints() }
  })

  handleIpc(IPC_CHANNELS.DEBUG_LIST_CALL_STACK, (): DebugCallStackResponse => {
    return { callStack: listDebugCallStack() }
  })

  /*
    Debug の状態（Session 6-9）。**要求を読まない** ── `void` の契約に何が載って届いても、
    それをセッションや adapter を指す値として使う経路は無い。返すのは閉じた集合の1語だけ
    （`lsp:get-status` と同じ形）。
  */
  handleIpc(IPC_CHANNELS.DEBUG_GET_STATUS, (): DebugStatusResponse => {
    return { status: getDebugSessionStatus() }
  })

  /*
    Variables（Session 6-6）。**形だけをここで確かめる** ── frame が今の停止のものか、
    handle が今の表にあるかは main/debug/variables.ts が決め、古いものは値
    （`unavailable`）で返る。ここで断るのは「frameId が正の整数でない」
    「handle が文字列でない（生の `variablesReference` の数値を含む）」の2つだけ。
  */
  handleIpc(
    IPC_CHANNELS.DEBUG_LIST_SCOPES,
    async (request: ListDebugScopesRequest): Promise<DebugScopesResponse> => {
      const frameId: unknown = request?.frameId

      if (typeof frameId !== 'number' || !Number.isSafeInteger(frameId) || frameId <= 0) {
        throw invalidRequest('the frame id must be a positive integer.')
      }

      return { result: await listDebugScopes(frameId) }
    }
  )

  handleIpc(
    IPC_CHANNELS.DEBUG_LIST_VARIABLES,
    async (request: ListDebugVariablesRequest): Promise<DebugVariablesResponse> => {
      const handle: unknown = request?.handle

      if (!isDebugVariableHandleShape(handle)) {
        throw invalidRequest('the variable handle must be a handle issued by the main process.')
      }

      return { result: await listDebugVariables(handle) }
    }
  )

  /*
    Evaluate（Session 6-7）。ここでも見るのは**形だけ**で、frame が今の停止のものかは
    main/debug/evaluate.ts が決める。断るのは3つ ── 式が「文字列で、空白だけでなく、
    上限以内で、NUL を含まない」を満たさない／`frameId` が正の整数でない／
    `context` が閉じた集合の外。

    **式を trim も整形もしない。** 利用者が打った文字列がそのまま adapter へ渡る
    （空白の有無で意味が変わる言語がある）── 空かどうかを見るときだけ trim する。
  */
  handleIpc(
    IPC_CHANNELS.DEBUG_EVALUATE,
    async (request: EvaluateDebugExpressionRequest): Promise<DebugEvaluateResponse> => {
      const expression: unknown = request?.expression
      const frameId: unknown = request?.frameId
      const context: unknown = request?.context

      if (!isDebugEvaluateExpressionShape(expression)) {
        throw invalidRequest('the expression must be a non-empty string within the length limit.')
      }

      if (typeof frameId !== 'number' || !Number.isSafeInteger(frameId) || frameId <= 0) {
        throw invalidRequest('the frame id must be a positive integer.')
      }

      if (!isDebugEvaluateContext(context)) {
        throw invalidRequest('the evaluate context is not one of the supported contexts.')
      }

      return { result: await evaluateDebugExpression(expression, frameId, context) }
    }
  )

  handleIpc(
    IPC_CHANNELS.DEBUG_TOGGLE_BREAKPOINT,
    (request: ToggleDebugBreakpointRequest): DebugBreakpointsResponse => {
      const outcome = toggleDebugBreakpoint(request?.relativePath, request?.line)

      switch (outcome.status) {
        case 'changed':
          return { breakpoints: outcome.breakpoints }

        case 'invalid-line':
          throw invalidRequest('the breakpoint line must be a positive integer.')

        case 'outside-workspace':
          throw outsideWorkspace()

        case 'limit-reached':
          throw new IpcError(
            'INVALID_REQUEST',
            'this workspace already has the maximum number of breakpoints.'
          )

        case 'no-workspace':
          /*
            Workspace が開かれていない。**失敗として返す**（黙って空を返さない）
            ── 押した側から見て「何も起きなかった」と区別が付かなくなる。
          */
          throw new IpcError('NOT_FOUND', 'no workspace folder is open.')
      }
    }
  )

  /*
    実行制御（Session 6-4）。**要求は読まない** ── `void` の契約に何かが載って
    届いても、それを制御の名前や `threadId` として使う経路は無い。
    状態による断りは値として返り（`rejected`）、IPC の失敗にはしない。
  */
  for (const [channel, control] of EXECUTION_CONTROL_CHANNELS) {
    handleIpc(channel, () => controlDebugSession(control))
  }

  /*
    利用者の Stop（Session 6-4）。terminate → disconnect → kill の段を踏み、
    idle へ戻り終えてから答える（main/debug/debugSessionManager.ts）。
  */
  handleIpc(IPC_CHANNELS.DEBUG_STOP, () => requestDebugSessionStop())
}

/**
 * Workspace の外を指していた。
 *
 * Files / LSP ドメインと**同じ分類**にする（PERMISSION_DENIED）。
 * 相対位置として壊れているのか、外を指しているのかを言い分けない ──
 * 言い分けると、外側の構造を1件ずつ問い合わせて調べられる形になる。
 */
function outsideWorkspace(): IpcError {
  return new IpcError(
    'PERMISSION_DENIED',
    'the breakpoint path is not inside the current workspace.'
  )
}
