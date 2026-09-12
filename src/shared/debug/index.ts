/**
 * Debug（DAP）契約レイヤーの公開窓口（Session 6-3）。
 *
 * Main / Preload / Renderer はこのモジュール経由で Breakpoint の型と、
 * Debug Session の状態・実行制御の結末（Session 6-4）・Call Stack（6-5）・
 * Variables（6-6）・Evaluate（6-7）を参照する。
 * shared 層のルールどおり、ここに実装（プロセス・DAP の電文・保存先）は置かない
 * ── それらは Main の持ち物で、main/debug/ と main/store/ に閉じている。
 *
 * **`ResolvedLaunchConfiguration` にあたるものはここに現れない**
 * （docs/ARCHITECTURE.md §20.6）。この層に adapter の実行ファイルや絶対パスを
 * 表す欄が生えたら、それは設計に戻る合図になる。
 */
export {
  DEBUG_BREAKPOINT_MAX_LINE,
  DEBUG_BREAKPOINT_MIN_LINE,
  DEBUG_BREAKPOINTS_MAX_PER_WORKSPACE,
  compareDebugBreakpoints,
  filterDebugBreakpointsForPath,
  findDebugBreakpointAt,
  isDebugBreakpointLine,
  isSameDebugBreakpointLocation
} from './breakpoint'

export type { DebugBreakpoint } from './breakpoint'

export { DEBUG_EXECUTION_CONTROLS } from './session'

export type {
  DebugCallStackFrame,
  DebugCallStackSnapshot,
  DebugCallStackSource,
  DebugCallStackSourceUnavailableReason,
  DebugCallStackStatus,
  DebugCallStackThread
} from './callStack'

export { EMPTY_DEBUG_CALL_STACK } from './callStack'

export type {
  DebugEvaluateContext,
  DebugEvaluateResult,
  DebugEvaluateUnavailableReason,
  DebugEvaluateValue
} from './evaluate'

export {
  DEBUG_EVALUATE_CONTEXTS,
  DEBUG_EVALUATE_EXPRESSION_MAX_LENGTH,
  isDebugEvaluateContext,
  isDebugEvaluateExpressionShape
} from './evaluate'

export type {
  DebugScope,
  DebugScopeKind,
  DebugScopesResult,
  DebugVariable,
  DebugVariableHandle,
  DebugVariableKind,
  DebugVariablesResult,
  DebugVariablesUnavailableReason
} from './variables'

export {
  DEBUG_VARIABLE_HANDLE_MAX_LENGTH,
  DEBUG_VARIABLE_HANDLES_MAX_PER_STOP,
  DEBUG_VARIABLE_VALUE_MAX_LENGTH,
  DEBUG_VARIABLES_MAX_PER_RESPONSE,
  isDebugVariableHandleShape
} from './variables'

export type {
  DebugControlFailure,
  DebugControlOutcome,
  DebugControlRejection,
  DebugExecutionControl,
  DebugSessionState
} from './session'

export {
  DEBUG_BREAKPOINTS_DOCUMENT_MAX_BYTES,
  DEBUG_BREAKPOINTS_MAX_WORKSPACES,
  DEBUG_BREAKPOINTS_SCHEMA_VERSION
} from './breakpointDocument'

export type {
  DebugBreakpointsDocument,
  StoredDebugBreakpointEntry,
  StoredDebugBreakpointWorkspace
} from './breakpointDocument'
