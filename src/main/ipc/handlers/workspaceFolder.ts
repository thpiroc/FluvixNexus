import { dialog } from 'electron'
import {
  IPC_CHANNELS,
  type GetCurrentWorkspaceFolderResponse,
  type OpenWorkspaceFolderResponse
} from '@shared/ipc'
import {
  closeWorkspaceFolder,
  getCurrentWorkspaceFolder,
  getUnavailableRootPath,
  openWorkspaceFolder
} from '../../workspaceFolder/currentWorkspaceFolder'
import { IpcError, invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * workspace-folder ドメインのハンドラ（開いているプロジェクトフォルダ）。
 *
 * レイアウトの workspace ドメインとは別（語の使い分けは shared/workspace/folder.ts）。
 *
 * このファイルが持つのは次の2つだけで、Workspace の状態そのものは
 * workspaceFolder/currentWorkspaceFolder.ts が持つ。
 *   - ネイティブのダイアログを出す（Electron に触れるのはここ）
 *   - ドメインの結末を IPC の失敗分類へ翻訳する
 *
 * **開く対象のパスは Renderer から受け取らない。** 選ぶのはダイアログだけであり、
 * Renderer が言えるのは「ダイアログを出して」までに留める。任意のパスを
 * 受け取れるようにした時点で、Renderer から見て「フォルダを1つ指定できる API」になり、
 * Files / Terminal がそれを基点に動く以上、実質的に任意の場所へ手が届いてしまう。
 */
export function registerWorkspaceFolderHandlers(): void {
  handleIpc(IPC_CHANNELS.WORKSPACE_FOLDER_GET_CURRENT, (): GetCurrentWorkspaceFolderResponse => ({
    workspace: getCurrentWorkspaceFolder(),
    unavailableRootPath: getUnavailableRootPath()
  }))

  handleIpc(
    IPC_CHANNELS.WORKSPACE_FOLDER_OPEN,
    async (_request, context): Promise<OpenWorkspaceFolderResponse> => {
      // 呼び出し元のウィンドウに対してモーダルにする（registry が送信元を検証済み）。
      const selection = await dialog.showOpenDialog(context.window, {
        title: 'Workspace にするフォルダを選択',
        properties: ['openDirectory', 'createDirectory'],
        // 既に開いている Workspace があれば、その場所から選び直せるようにする。
        defaultPath: getCurrentWorkspaceFolder()?.rootPath
      })

      const rootPath = selection.filePaths[0]

      // 取り消しは失敗ではなく通常の結末（契約の OpenWorkspaceFolderResponse を参照）。
      if (selection.canceled || rootPath === undefined) {
        return { status: 'cancelled' }
      }

      const outcome = openWorkspaceFolder(rootPath)

      switch (outcome.status) {
        case 'opened':
          return { status: 'opened', workspace: outcome.workspace }

        case 'not-found':
          // ダイアログが返した直後に消えた場合（＝競合）。利用者に伝える価値があるので失敗にする。
          throw new IpcError('NOT_FOUND', `the selected folder no longer exists: ${rootPath}`)

        case 'invalid-path':
          throw invalidRequest(`the selected path cannot be used as a workspace: ${rootPath}`)
      }
    }
  )

  handleIpc(IPC_CHANNELS.WORKSPACE_FOLDER_CLOSE, (): void => {
    closeWorkspaceFolder()
  })
}
