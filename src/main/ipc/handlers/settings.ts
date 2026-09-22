import { IPC_CHANNELS, IPC_EVENT_CHANNELS, type LoadSettingsResponse } from '@shared/ipc'
import { isSettingsScope } from '@shared/settings'
import {
  readUserSettingsSections,
  readWorkspaceSettingsSnapshot,
  saveUserSettingsSection,
  saveWorkspaceSettingsSection
} from '../../store/settings'
import { isPlainObject, parseSettingsSectionUpdate } from '../../store/settingsSections'
import { onWorkspaceFolderChange } from '../../workspaceFolder/currentWorkspaceFolder'
import { IpcError, invalidRequest } from '../errors'
import { emitIpcEvent } from '../events'
import { handleIpc } from '../registry'

/**
 * settings ドメインのハンドラ（アプリの設定の永続化。Session 4-3A で2本へ集約）。
 *
 * workspace ドメイン（レイアウトの読み書き）と同じ形で、持つのは2つだけ。
 *   - 保存先を Main 側で決める（Renderer からはパスもファイル名も指定できない）
 *   - 届いた要求が**後で読める形か**を確かめてから書く
 *
 * ## section は Main 側でも必ず確かめる
 *
 * 要求の型（`SettingsSectionUpdate`）は判別可能なユニオンだが、**型は入口に
 * すぎない** ── IPC を渡ってくる値は型を名乗っているだけなので、既知の section か・
 * 値が object か・key が読める形かを `parseSettingsSectionUpdate` で確かめる。
 * 通らない要求は保存に進まない（INVALID_REQUEST）。
 *
 * ここで見るのは**形だけ**で、中身の意味（mode として成立するか・上下限）は見ない。
 * それを知っているのは Renderer だけで、二重に解釈すると
 * 「どちらが正しいか」が生まれる（Session 3-5 からの分担）。
 *
 * ## scope も確かめる（feature/settings-scope）
 *
 * `scope` が `user` / `workspace` のどちらかでなければ拒む。ワークスペース設定は
 * 名乗った `workspaceId` が今開いている Workspace と違えば CONFLICT
 * （切り替えの直前に出た保存を、別のプロジェクトへ書かない）、
 * ユーザー設定でしか変えられない section なら INVALID_REQUEST にする。
 *
 * ## 読めなくても失敗にしない
 *
 * 保存が無い / 壊れている場合でも、その分だけ空の section を返す。設定が読めない
 * ことはアプリを使えない理由にならず、Renderer は既定（Auto Save は OFF、Files の
 * 表示方式はパネルの形に任せる、Terminal は 13px / 5000 行）で始まる。
 */
export function registerSettingsHandlers(): void {
  handleIpc(IPC_CHANNELS.SETTINGS_LOAD, (): LoadSettingsResponse => {
    return { user: readUserSettingsSections(), workspace: readWorkspaceSettingsSnapshot() }
  })

  handleIpc(IPC_CHANNELS.SETTINGS_SAVE_SECTION, (request): void => {
    // 型は名乗っているだけなので、素の値として読み直す。
    const raw: unknown = request
    const update = parseSettingsSectionUpdate(raw)
    const scope = isPlainObject(raw) ? raw.scope : undefined

    if (update === null || !isSettingsScope(scope)) {
      throw invalidRequest('the settings section update is not in a storable shape.')
    }

    if (scope === 'user') {
      saveUserSettingsSection(update)
      return
    }

    const workspaceId = isPlainObject(raw) ? raw.workspaceId : undefined

    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw invalidRequest('a workspace settings update must name its workspace.')
    }

    switch (saveWorkspaceSettingsSection(workspaceId, update)) {
      case 'saved':
        return

      case 'not-workspace-scoped':
        throw invalidRequest(
          `the "${update.section}" section can only be changed in user settings.`
        )

      case 'workspace-mismatch':
        throw new IpcError('CONFLICT', 'the workspace changed before the settings were saved.')
    }
  })

  /*
    Workspace が切り替わったら、Renderer の設定の器へ読み直すよう知らせる
    （shared/ipc/events/settings.ts）。購読をここに置くのは、IPC を知っている層が
    ここだけだから ── store/settings.ts は Renderer の存在を知らない。
  */
  onWorkspaceFolderChange((workspace) => {
    emitIpcEvent(IPC_EVENT_CHANNELS.SETTINGS_WORKSPACE_CHANGED, {
      workspaceId: workspace?.id ?? null
    })
  })
}
