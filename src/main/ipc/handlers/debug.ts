import {
  IPC_CHANNELS,
  type DebugBreakpointsResponse,
  type ToggleDebugBreakpointRequest
} from '@shared/ipc'
import { listDebugBreakpoints, toggleDebugBreakpoint } from '../../debug/breakpoints'
import { IpcError, invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * debug ドメインのハンドラ（Session 6-3 ── Breakpoint）。
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
