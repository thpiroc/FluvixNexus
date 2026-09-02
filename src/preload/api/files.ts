import type { FilesApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * files ドメインの Preload API（Workspace の中のファイル / フォルダ）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * fs を触るのはもちろん、パスを組み立てることも名前を検査することもここではしない。
 *
 * どのメソッドも受け取るのが **Workspace root からの相対位置だけ**であることが要点。
 * root を渡す引数がどこにも無いため、この API から Workspace の外は指せない。
 * それは列挙だけでなく、作成 / 改名 / 移動 / コピー / 削除でも同じ
 * （移動とコピーは相対位置を2つ受け取るが、どちらも同じ形の相対位置でしかない）。
 *
 * `onChanged` は Main → Renderer のイベントを公開する最初のもの。
 * Electron の event オブジェクトを Renderer へ渡さないのは subscribe.ts の責務で、
 * ここはチャンネル名を当てはめるだけにする。
 */
export const filesApi: FilesApi = {
  readDirectory: (request) => invokeIpc(IPC_CHANNELS.FILES_READ_DIRECTORY, request),
  readFile: (request) => invokeIpc(IPC_CHANNELS.FILES_READ_FILE, request),
  writeFile: (request) => invokeIpc(IPC_CHANNELS.FILES_WRITE_FILE, request),
  /*
    別名で保存（Session 4-2）。ここも他と同じく IPC を包むだけで、
    **保存先を組み立てる引数が無い**ことがそのまま境界になる。
    行き先を決めるのは Main が出すネイティブの保存ダイアログだけで、
    ここから渡せるのは中身・文字コードと、ダイアログを開く位置の助言（相対位置）に留まる。
  */
  saveAs: (request) => invokeIpc(IPC_CHANNELS.FILES_SAVE_AS, request),
  create: (request) => invokeIpc(IPC_CHANNELS.FILES_CREATE, request),
  rename: (request) => invokeIpc(IPC_CHANNELS.FILES_RENAME, request),
  move: (request) => invokeIpc(IPC_CHANNELS.FILES_MOVE, request),
  copy: (request) => invokeIpc(IPC_CHANNELS.FILES_COPY, request),
  remove: (request) => invokeIpc(IPC_CHANNELS.FILES_DELETE, request),
  /*
    検索も同じ形（Session 3-6-4）。渡すのは検索語と識別子だけで、
    **Workspace を歩くのは Main。** Renderer 側で列挙を繰り返して自前で
    走査する経路を作らないための入口がここになる。
  */
  search: (request) => invokeIpc(IPC_CHANNELS.FILES_SEARCH, request),
  /*
    全文検索も同じ形（Session 3-6-5）。読むのは Main で、Renderer へ渡るのは
    相対位置・行・桁・周辺のテキストだけ ── **ファイルの中身を丸ごと運ぶ経路には
    しない**（それは `readFile` の役目で、上限も Editor に合わせてある）。
  */
  searchContent: (request) => invokeIpc(IPC_CHANNELS.FILES_SEARCH_CONTENT, request),
  cancelSearch: (request) => invokeIpc(IPC_CHANNELS.FILES_CANCEL_SEARCH, request),
  onChanged: (listener) => subscribeIpcEvent(IPC_EVENT_CHANNELS.FILES_CHANGED, listener)
}
